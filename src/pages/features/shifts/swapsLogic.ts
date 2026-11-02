// THE SWAPS SCREEN'S OWN ARITHMETIC — and only the part that is the screen's.
// NOTHING HERE DECIDES ANYTHING, for the same reason requestsLogic.ts decides nothing: who may open a swap, who may…
import { ohioDateTime, ohioTime } from '@/lib/ohio'
import { ABOVE_ONE, waitingOn, type HandoffView, type MyShift, type TransferCandidate } from './requestsLogic'

// The directors list as the Time Off house's settings answer it.
export type DirectorsList = { readable: boolean; names: string[]; why: string }

// The director seat of the form: whether a swap can be asked, the name to show, and the sentence.
export function directorSeat(d: DirectorsList): { askable: boolean; name: string; why: string } {
  if (!d.readable) return { askable: false, name: '', why: `${d.why} — nobody can be asked until it can be read.` }
  if (!d.names.length) {
    return { askable: true, name: '',
             why: `${d.why} — the swap still opens, and its director's approval waits until a name is saved on Settings → Time Off.` }
  }
  return { askable: true, name: d.names.join(' or '),
           why: 'From the Time Off house\'s settings — never a name in the code.' }
}

/** The warning under "Waiting on" while the list names nobody or did not land, or ''. */
export function directorsWarning(d: DirectorsList): string {
  if (!d.readable) return `${d.why} — no swap can be opened until it can be read, because the director has to approve it.`
  if (!d.names.length) {
    return `${d.why} — a swap still opens, and its director's approval waits until a name is saved there.`
  }
  return ''
}

/** One house the reader may open a swap for, by phone, as time off is taken. */
export type SwapHouse = { location: string; house: string; code: string }

/** Everything the Swaps tab draws (server/shift_handoff.swaps_feed). */
export type SwapsFeed = {
  me: string
  directors: DirectorsList
  /** the reader's own upcoming shifts */
  my_shifts: MyShift[]
  my_shifts_why: string
  /** the upcoming shifts of the houses this reader manages */
  house_shifts: MyShift[]
  house_shifts_why: string
  houses: SwapHouse[]
  /** the whole company's swaps, newest first, cut to what this badge allows */
  history: HandoffView[]
  whole_company: boolean
  at: string
}

/** The four people on a swap, each with the door their answer came through. */
export type SeatRole = 'to' | 'manager' | 'director' | 'from'
export type Seat = {
  role: SeatRole
  name: string
  /** what they are on this swap, in the company's words */
  part: string
  /** waiting · agreed · refused · asked · none (never asked, or never answered before the swap closed) */
  state: 'waiting' | 'agreed' | 'refused' | 'asked' | 'none'
  /** the state with its door and time: 'agreed by text · 18:41' */
  line: string
}

/** A door in the words the screen uses; 'app' is the platform itself. */
export function doorWords(via: string | undefined): string {
  const word = String(via ?? '').trim().toLowerCase()
  if (word === 'sms' || word === 'text') return 'by text'
  if (word === 'email' || word === 'mail') return 'by e-mail'
  if (word === 'app' || word === 'hub' || word === 'platform') return 'in the platform'
  return word ? `by ${word}` : ''
}

/** 'agreed by text · 18:41' — the state, the door it came through, and when. */
export function seatLine(state: Seat['state'], via: string | undefined, at: string): string {
  if (state === 'waiting') return 'waiting'
  if (state === 'none') return 'not asked'
  const said = state === 'agreed' ? 'agreed' : state === 'refused' ? 'said no' : 'asked it'
  return [said, doorWords(via), ohioTime(at)].filter(Boolean).join(' · ').replace(' · · ', ' · ')
}

function answered(raw: string | undefined, yes: string): Seat['state'] {
  const word = String(raw ?? 'pending')
  if (word === 'pending') return 'waiting'
  // the relay's word for a swap that closed before this seat existed
  if (word === 'not_asked') return 'none'
  return word === yes ? 'agreed' : 'refused'
}

/** The relay's words for a swap that is over: done, or ended without moving the shift. */
const CLOSED_SWAP = new Set(['done', 'dead'])

/** The line of a seat still 'pending' on a swap that closed: nobody is waiting on it any more. */
export function unansweredLine(swapState: string): string {
  return swapState === 'dead' ? 'never answered — the swap ended' : 'never answered — the swap closed'
}

// One consent, read from its own field; a seat still pending on a CLOSED swap is not waiting — the swap is not…
function seatOf(swapState: string, raw: string | undefined, yes: string, via: string | undefined,
                at: string): Pick<Seat, 'state' | 'line'> {
  const state = answered(raw, yes)
  if (state === 'waiting' && CLOSED_SWAP.has(swapState)) return { state: 'none', line: unansweredLine(swapState) }
  return { state, line: seatLine(state, via, at) }
}

// THE FOUR SEATS OF A SWAP, in the order the card draws them.
export function seatsOf(h: HandoffView): Seat[] {
  const directors = h.directors?.length ? h.directors.join(' or ') : ''
  const manager = h.approval?.names?.length ? h.approval.names.join(' or ')
    : h.house_manager || (h.approval?.mode === 'above' ? ABOVE_ONE : '')
  const swap = String(h.state ?? '')
  const rows: Seat[] = [
    {
      role: 'to', name: h.to_staff, part: 'takes the shift',
      ...seatOf(swap, h.staff_state, 'accepted', h.staff_via, h.staff_at),
    },
    {
      role: 'manager', name: manager || 'the house manager', part: 'house manager',
      ...seatOf(swap, h.manager_state, 'approved', h.manager_via, h.manager_at),
    },
    {
      role: 'director', name: h.director_by || directors || 'the director', part: 'director',
      ...seatOf(swap, h.director_state, 'approved', h.director_via, h.director_at ?? ''),
    },
    {
      role: 'from', name: h.from_staff, part: 'hands it over',
      // the one who hands it over does not answer; the row says when it was opened
      state: 'asked', line: seatLine('asked', '', h.created_at),
    },
  ]
  return rows
}

/** The sentence under the "Waiting on" card — one place, so it never drifts. */
export const EACH_DOOR_LINE = 'The shift moves the moment the last one answers. Each of them can '
  + 'answer by text or here — whichever comes first is the one recorded, and it says which.'

/** What a swap is still owed, in one line, for the card's header. */
export function stillOwed(h: HandoffView): string {
  const want = waitingOn(h)
  return want.length ? `Waiting on ${want.join(' and ')}` : 'All three have answered'
}

/** One of the three refusals the relay runs BEFORE anybody is asked. */
export type Check = { key: string; label: string; ok: boolean | null; why: string }

/** How the relay refused the shift itself (its `reason` word), or ''. */
export const POOL_REFUSALS = new Set(['open_shift', 'called_off', 'not_a_shift', 'no_shift'])

// THE LINE OF CHECKS — the relay's own three refusals, never decided here.
export function checksFor(c: TransferCandidate | null | undefined,
                          ist: { readable: boolean; why: string } | undefined,
                          shiftWhy = ''): Check[] {
  const pooled = POOL_REFUSALS.has(shiftWhy)
  const pool: Check = {
    key: 'pool', label: 'not an open shift',
    ok: shiftWhy ? !pooled : c ? true : null,
    why: pooled ? 'this shift is in the open pool — it is applied for, never handed over'
      : shiftWhy ? '' : c ? '' : 'pick a shift and who takes it',
  }
  if (!c) {
    return [
      { key: 'overlap', label: 'no overlap', ok: null, why: 'pick who takes it' },
      pool,
      { key: 'ist', label: 'trained for this house', ok: null, why: 'pick who takes it' },
    ]
  }
  const clash = c.code === 'overlap' || c.code === 'time_off' || c.code === 'cell_taken'
  const istReadable = ist?.readable !== false
  return [
    { key: 'overlap', label: 'no overlap', ok: !clash, why: clash ? c.why : '' },
    pool,
    {
      key: 'ist', label: 'trained for this house',
      ok: istReadable ? !c.needs_training : null,
      why: !istReadable ? (ist?.why || 'the IST record could not be read — it counts as missing')
        : c.needs_training ? 'a first shift here — the house manager approves the training' : '',
    },
  ]
}

/** A swap's day and shift in one line: '48th (A) · Sat 27 Sep'. */
export function shiftLabel(s: Pick<MyShift, 'value' | 'col_iso' | 'house'>, today: string): string {
  return [s.value, s.house, dayWords(s.col_iso, today)].filter(Boolean).join(' · ')
}

/** 'YYYY-MM-DD' → 'Ddd D Mon', and 'Today' when it is. */
export function dayWords(iso: string, today: string): string {
  if (iso === today) return 'Today'
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

export type SwapCuts = { q?: string; house?: string; person?: string; state?: string }

/** The history's cuts; narrowing only, and never a row the relay did not send. */
export function filterSwaps(rows: HandoffView[], cuts: SwapCuts): HandoffView[] {
  const q = (cuts.q ?? '').trim().toLowerCase()
  return rows.filter((h) => {
    if (cuts.house && cuts.house !== 'all' && h.house !== cuts.house) return false
    if (cuts.person && cuts.person !== 'all'
        && ![h.from_staff, h.to_staff, h.house_manager, ...(h.directors ?? [])]
          .includes(cuts.person)) return false
    if (cuts.state && cuts.state !== 'all' && h.state !== cuts.state) return false
    if (!q) return true
    return [h.from_staff, h.to_staff, h.house, h.value, h.col_iso, h.house_manager, h.id, h.why,
            ...(h.directors ?? [])]
      .some((v) => String(v ?? '').toLowerCase().includes(q))
  })
}

/** The houses, people and states actually on the history — read off the rows. */
export function swapCutsFrom(rows: HandoffView[]): {
  houses: string[]; people: string[]; states: string[]
} {
  const houses = new Set<string>()
  const people = new Set<string>()
  const states = new Set<string>()
  for (const h of rows) {
    if (h.house) houses.add(h.house)
    for (const p of [h.from_staff, h.to_staff, h.house_manager, ...(h.directors ?? [])]) {
      if (p) people.add(p)
    }
    if (h.state) states.add(h.state)
  }
  return {
    houses: [...houses].sort(),
    people: [...people].sort((a, b) => a.localeCompare(b)),
    states: [...states].sort(),
  }
}

/** The history's export, share and print columns. */
export const SWAP_EXPORT_COLUMNS = [
  { key: 'created_at', label: 'Opened' },
  { key: 'house', label: 'House' },
  { key: 'col_iso', label: 'Shift day' },
  { key: 'value', label: 'Shift' },
  { key: 'from_staff', label: 'Hands it over' },
  { key: 'to_staff', label: 'Takes it' },
  { key: 'staff', label: 'Taker' },
  { key: 'manager', label: 'House manager' },
  { key: 'director', label: 'Director' },
  { key: 'state', label: 'State' },
  { key: 'why', label: 'Note' },
  { key: 'id', label: 'Ref' },
]

export function swapExportRows(rows: HandoffView[]): Record<string, unknown>[] {
  return rows.map((h) => {
    const seats = seatsOf(h)
    const of = (role: SeatRole) => {
      const s = seats.find((x) => x.role === role)
      return s ? `${s.name}: ${s.line}` : ''
    }
    return {
      ...h, created_at: ohioDateTime(h.created_at) || h.created_at,
      staff: of('to'), manager: of('manager'), director: of('director'),
    }
  })
}
