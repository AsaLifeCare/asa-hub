// Shift Board seed (shifts-suite wave) — residential house roster data: 8 houses, per-person shift summary cards…
// All fictional.
import { addDays, format, startOfWeek } from 'date-fns'
import type { TintName } from '@/engine/types'
import { withTenant } from '@/lib/tenancy'
import { people } from '@/lib/seed'

const pad = (n: number) => String(n).padStart(2, '0')

/** Saturday-start roster week (reference system runs SAT → SUN). */
export const ROSTER_WEEK_START = startOfWeek(new Date(), { weekStartsOn: 6 })
export const ROSTER_DAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'] as const
export type RosterDay = (typeof ROSTER_DAYS)[number]

export const rosterDate = (dayIndex: number): Date => addDays(ROSTER_WEEK_START, dayIndex)
export const rosterDayISO = (dayIndex: number): string => format(rosterDate(dayIndex), 'yyyy-MM-dd')

/* ---------------- shift kinds & codes ---------------- */

export type ShiftKind =
  | 'day'
  | 'afternoon'
  | 'morning'
  | 'evening'
  | 'overnight'
  | 'ro'
  | 'off'
  | 'alias'

/** Legend labels (reference calendar legend, same order). */
export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = {
  day: 'Day 11–23h',
  afternoon: 'Afternoon',
  morning: 'Morning',
  evening: 'Evening O/N',
  overnight: 'Long O/N',
  ro: 'R/O · C/O',
  alias: 'Same token',
  off: 'OFF / alias',
}

const KIND_CODES: Record<Exclude<ShiftKind, 'alias'>, string[]> = {
  day: ['8A-8P', '7A-7P', '9A-9P'],
  morning: ['7A-3P', '6A-2P'],
  afternoon: ['*2P-10P', '3P-11P', '2P-10P'],
  evening: ['4P-12A', '5P-1A'],
  overnight: ['11P-7A', '10P-6A', '9P-9A'],
  ro: ['R/O', 'C/O'],
  off: ['OFF'],
}

/** Street-token aliases ("47TH" = a shift logged under the 47th St house token). */
const ALIAS_CODES = ['47TH', '38TH', '12TH', '48TH', '9TH', 'MKT', 'OAK', 'ELM']

/** Hour ranges per kind, used by the timeline generator [startHour, endHour]. */
const KIND_HOURS: Record<ShiftKind, [number, number]> = {
  day: [8, 20],
  morning: [7, 15],
  afternoon: [14, 22],
  evening: [16, 24],
  overnight: [22, 31], // crosses midnight — rendered clamped to 24
  ro: [9, 17],
  off: [0, 0],
  alias: [10, 18],
}

/* ---------------- houses (8) ---------------- */

export type ShiftHouse = {
  id: string
  code: string // CAN-38TH-ABD2005 style
  name: string
  address: string
  residents: string[] // client names (care client pool)
  capacity: number
  colorTint: TintName
}

/** Resident names reuse the care client pool (src/lib/seed-care.ts CLIENT_NAMES). */
const CLIENT_POOL = [
  'Danny Whitaker', 'Rosa Delgado', 'Kenny Marsh', 'Beth Ann Sutter', 'Tyrone Fields',
  'Maggie Oconnell', 'Sam Petrakis', 'Joyce Linden', 'Carl Draper', 'Tonya Reeves',
  'Billy Harmon', 'Annette Kowal', 'Doug Fenwick', 'Pam Sorrell', 'Reggie Booth',
  'Cora Lindsey', 'Miles Prescott', 'Darlene Yu', 'Gary Ostrander', 'Fern Calloway', 'Leon Tibbs',
]

const HOUSE_ROWS: Array<[string, string, string, number, TintName]> = [
  // [street token, name, address, capacity, tint]
  ['38TH', '38th Street Home', '3805 38th St NW, Canton, OH', 4, 'blue'],
  ['47TH', '47th Street Home', '4712 47th St NW, Canton, OH', 3, 'mint'],
  ['12TH', '12th Street Home', '1224 12th St NE, Canton, OH', 4, 'lavender'],
  ['48TH', '48th Street Home', '4820 48th St NW, Canton, OH', 3, 'peach'],
  ['9TH', '9th Street Home', '915 9th St SW, Canton, OH', 2, 'pink'],
  ['MKT', 'Market Ave Home', '2301 Market Ave N, Canton, OH', 4, 'amber'],
  ['OAK', 'Oakwood Home', '77 Oakwood Dr, North Canton, OH', 3, 'green'],
  ['ELM', 'Elmcrest Home', '452 Elmcrest Ave, Massillon, OH', 4, 'blue'],
]

export const houses: ShiftHouse[] = withTenant(
  HOUSE_ROWS.map(([token, name, address, capacity, colorTint], i) => ({
    id: `house-${pad(i + 1)}`,
    code: `CAN-${token}-ABD${2005 + i * 2}`,
    name,
    address,
    residents: Array.from(
      { length: 2 + (i % 3) },
      (_, k) => CLIENT_POOL[(i * 3 + k * 5) % CLIENT_POOL.length],
    ).filter((v, k, a) => a.indexOf(v) === k),
    capacity,
    colorTint,
  })),
)

export const houseById = (id: string): ShiftHouse | undefined => houses.find((h) => h.id === id)

/* ---------------- shift cards (48 — one per staff member) ---------------- */

export type ShiftDayChip = {
  day: RosterDay
  code: string
  kind: ShiftKind
  /** set by the relay only on a day it laid from a publish (server/effective_roster.py) */
  published?: { at: string; by: string; via: string; state: string; location?: string }
}

export type ShiftCard = {
  id: string
  personId: string
  personName: string
  initials: string
  avatar: string
  totalShifts: number
  houseCount: number
  week: ShiftDayChip[] // 7 chips, SAT → SUN
  next: { date: string; code: string; houseCode: string }
}

const initialsOf = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join('')

/** Deterministic kind for a person/day slot — every week mixes work + ro/off. */
function chipFor(personIdx: number, dayIdx: number): ShiftDayChip {
  const roll = (personIdx * 7 + dayIdx * 3 + personIdx * dayIdx) % 12
  let kind: ShiftKind
  if (roll <= 3) kind = 'day'
  else if (roll === 4) kind = 'morning'
  else if (roll <= 6) kind = 'afternoon'
  else if (roll === 7) kind = 'evening'
  else if (roll === 8) kind = 'overnight'
  else if (roll === 9) kind = 'ro'
  else if (roll === 10) kind = 'off'
  else kind = 'alias'
  const code =
    kind === 'alias'
      ? ALIAS_CODES[(personIdx + dayIdx) % ALIAS_CODES.length]
      : KIND_CODES[kind][(personIdx + dayIdx) % KIND_CODES[kind].length]
  return { day: ROSTER_DAYS[dayIdx], code, kind }
}

export const shiftCards: ShiftCard[] = withTenant(
  people.map((p, i) => {
    const week = ROSTER_DAYS.map((_, d) => chipFor(i, d))
    const houseCount = 1 + ((i * 5 + 2) % 8)
    const nextDayIdx = (i + 3) % 7
    const nextChip = week[nextDayIdx]
    return {
      id: `shiftcard-${pad(i + 1)}`,
      personId: p.id,
      personName: p.name,
      initials: initialsOf(p.name),
      avatar: p.avatar, // the person's `animal:` icon from seed.ts
      totalShifts: 24 + ((i * 37 + 11) % 300),
      houseCount,
      week,
      next: {
        date: format(rosterDate(nextDayIdx), 'MMM d'),
        code: nextChip.kind === 'off' || nextChip.kind === 'ro' ? '8A-8P' : nextChip.code,
        houseCode: houses[(i * 3 + 1) % houses.length].code.split('-').slice(1).join('-'),
      },
    }
  }),
)

/* ---------------- shift matrix (8 houses × 10 staff × 7 days) ---------------- */

export type ShiftMatrixCell = {
  id: string
  houseId: string
  staffName: string
  dayIndex: number // 0 = SAT … 6 = SUN
  code: string
  kind: ShiftKind
}

/** Staff roster per house — deterministic slice of the 48-person directory. */
export function houseStaff(houseIdx: number): string[] {
  return Array.from({ length: 10 }, (_, k) => people[(houseIdx * 5 + k * 4) % people.length].name)
}

export const shiftMatrix: ShiftMatrixCell[] = withTenant(
  houses.flatMap((house, h) =>
    houseStaff(h).flatMap((staffName, k) =>
      ROSTER_DAYS.map((_, d) => {
        // reuse the card chip when the staff member's own card covers this day, otherwise derive a house-local…
        const personIdx = people.findIndex((p) => p.name === staffName)
        const chip = chipFor(personIdx >= 0 ? personIdx : k, (d + h) % 7)
        return {
          id: `sm-${pad(h + 1)}-${pad(k + 1)}-${d}`,
          houseId: house.id,
          staffName,
          dayIndex: d,
          code: chip.code,
          kind: chip.kind,
        }
      }),
    ),
  ),
)

/* ---------------- shift timeline (~64 gantt entries, this week) ---------------- */

export type ShiftTimelineEntry = {
  id: string
  houseId: string
  houseCode: string
  staffName: string
  clientName: string
  date: string // yyyy-mm-dd, this roster week
  startHour: number // 0–23 float
  endHour: number // may exceed 24 (crosses midnight)
  kind: ShiftKind
}

const TIMELINE_KINDS: ShiftKind[] = ['day', 'morning', 'afternoon', 'evening', 'overnight']

export const shiftTimeline: ShiftTimelineEntry[] = withTenant(
  Array.from({ length: 64 }, (_, i) => {
    const house = houses[i % houses.length]
    const staffPool = houseStaff(i % houses.length)
    const staffName = staffPool[(i * 3 + 1) % staffPool.length]
    const kind = TIMELINE_KINDS[(i * 2 + Math.floor(i / 8)) % TIMELINE_KINDS.length]
    const [s, e] = KIND_HOURS[kind]
    const startHour = s + ((i * 7) % 3) * 0.5 // half-hour stagger
    const endHour = e - ((i * 5) % 2) * 0.5
    const dayIdx = (i * 5 + Math.floor(i / 8)) % 7
    return {
      id: `stl-${pad(i + 1)}`,
      houseId: house.id,
      houseCode: house.code,
      staffName,
      clientName: house.residents[i % house.residents.length],
      date: rosterDayISO(dayIdx),
      startHour,
      endHour,
      kind,
    }
  }),
)
