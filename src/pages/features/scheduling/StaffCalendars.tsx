// STAFF CALENDARS — one person's shifts across every house (or every open shift), soonest first, from the current…
// The master, a director and a house manager choose anybody among the active staff; anyone else chooses themselves or
// Open. A shift's location opens that house's House Calendar in Locations, for a viewer Locations opens it to.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, Check, ChevronDown, RefreshCw } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { useMediaQuery } from '@/hooks/use-mobile'
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { LOCATIONS_APP_ID, LOCATIONS_PAGE_ID } from '@/registry/apps-locations'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { houseTint } from '@/pages/features/calendarbuilder/calendarScreen'
import { codeIn } from '@/pages/features/houses/houseModel'
import { locationHref, type LocationScope } from '@/pages/features/locations/locationModel'
import { useLocationScope } from '@/pages/features/locations/useLocation'
import { hhmm, nameKey } from '@/pages/features/shifts/houseCalTypes'
import { DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import {
  CALENDAR_EDITION, cellMarks, cellMinutes, holdsEdition, houseLabel, phonesOf, withdrawable, type Board, type Cell, type MarkId,
  type Person,
} from './schedulingModel'
import { readStaffShifts, useSchedulingRead, type StaffShift } from './schedulingLane'
import { Muted, OUTLINE_BTN } from './SchedulingParts'

export const OPEN_WHO = 'open'

export const PILL = {
  danger: 'bg-tint-danger text-tint-fg-danger',
  amber: 'bg-tint-amber text-tint-fg-amber',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
  mint: 'bg-tint-mint text-tint-fg-mint',
  slate: 'bg-tint-slate text-tint-fg-slate',
} as const

const MARK_PILL: Partial<Record<MarkId, { label: string; tone: keyof typeof PILL }>> = {
  'open': { label: 'Open', tone: 'danger' },
  'taken': { label: 'Taken from open', tone: 'mint' },
  'training': { label: 'Training', tone: 'lavender' },
  'training-waiting': { label: 'Training pending', tone: 'amber' },
  'called-off': { label: 'Called off', tone: 'danger' },
  'request-waiting': { label: 'Request off pending', tone: 'amber' },
  'swap-waiting': { label: 'Swap pending', tone: 'amber' },
  'time-off-asked': { label: 'Time off asked', tone: 'amber' },
  'time-off': { label: 'Time off', tone: 'slate' },
}

/** The state pills a shift carries: the grid's own marks, a waiting take, and an R/O written in the cell. */
export function shiftPills(s: StaffShift): { id: string; label: string; tone: keyof typeof PILL }[] {
  const cell: Cell = { text: s.text, kind: s.kind, state: s.state, start: s.start, end: s.end, flow: s.flow, time_off: s.time_off }
  const marks = cellMarks({ kind: s.row_id.startsWith('OPEN:') ? 'open' : 'person' }, cell)
  const out: { id: string; label: string; tone: keyof typeof PILL }[] =
    marks.flatMap((m) => (MARK_PILL[m] ? [{ id: m, ...MARK_PILL[m] }] : []))
  if (s.flow && s.flow.kind === 'take' && withdrawable(s.flow)) out.push({ id: 'take-waiting', label: 'Take pending', tone: 'amber' })
  if (s.kind === 'ro' && !marks.includes('called-off') && !marks.includes('time-off')) out.push({ id: 'ro', label: s.text, tone: 'slate' })
  return out
}

/** "Fri, Oct 2" for an ISO day. */
export function dayWords(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export const shiftKey = (s: Pick<StaffShift, 'house_code' | 'row_id' | 'date'>) => `${s.house_code}|${s.row_id}|${s.date}`

/** Who this viewer may choose besides Open: anybody for the master, a director, a house manager or the calendar edition. */
export function mayChooseAnyone(board: Pick<Board, 'viewer'>): boolean {
  const v = board.viewer
  return v.is_master || v.is_director || v.editor_of.length > 0 || holdsEdition(board, CALENDAR_EDITION)
}

/** The choice drawn: the one asked for when the viewer may make it, else Open. */
export function whoOf(board: Pick<Board, 'viewer'>, asked: string): string {
  if (!asked || asked === OPEN_WHO) return OPEN_WHO
  return mayChooseAnyone(board) || asked === board.viewer.key ? asked : OPEN_WHO
}

/** Everyone else the viewer may choose, by name: the people the read says are active staff; nobody while it has not
 *  answered; everyone on the calendars when the staff list could not be read (null). None for a viewer who chooses
 *  only themselves. */
export function othersFor(board: Pick<Board, 'viewer' | 'people'>, active: string[] | null | undefined): Person[] {
  if (!mayChooseAnyone(board) || active === undefined) return []
  const keep = active === null ? null : new Set(active)
  return board.people.filter((p) => p.key !== board.viewer.key && (!keep || keep.has(p.key)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type Choice = { key: string; name: string; chip: string; phone: string }

/** The dropdown's list: Open, the viewer, then everyone else othersFor lets them choose. */
export function choicesFor(board: Pick<Board, 'viewer' | 'people'>, active: string[] | null | undefined): Choice[] {
  const me = board.viewer.key
  const phones = phonesOf(board.people)
  const nameOf = (key: string) => board.people.find((p) => p.key === key)?.name || (key === me ? board.viewer.name : key)
  return [
    { key: OPEN_WHO, name: 'Open', chip: 'Open shifts', phone: '' },
    ...(me ? [{ key: me, name: nameOf(me), chip: 'You', phone: phones[me] ?? '' }] : []),
    ...othersFor(board, active).map((p) => ({ key: p.key, name: p.name, chip: '', phone: phones[p.key] ?? '' })),
  ]
}

/** Locations › House Calendar for a shift's house, or '' (the location drawn as plain text): when the house has no code,
 *  Locations does not open to the viewer, or their scope does not hold the house or shows no House Calendar. */
export function houseCalendarHref(house: string, opens: boolean, scope: Pick<LocationScope, 'cut' | 'houses'> | null): string {
  const code = codeIn(house)
  if (!code || !opens || !scope || scope.cut) return ''
  if (scope.houses !== null && !scope.houses.some((h) => h.code === code)) return ''
  return locationHref(code, 'calendar')
}

/** The House Calendar link of each house, as Locations' own gates answer for this viewer. */
function useHouseCalendarHref(): (house: string) => string {
  const apps = useRegistryStore((s) => s.apps)
  const role = useEffectiveRole()
  useBadgeRulesVersion()
  const opens = isAllowedWith(apps, role, LOCATIONS_APP_ID, LOCATIONS_PAGE_ID)
  const { scope } = useLocationScope(opens)
  return (house) => houseCalendarHref(house, opens, scope)
}

export const STAFF_COLUMNS = ['Date', 'Location', 'Start time', 'End time'] as const

const GRID = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.75fr)_minmax(0,0.75fr)]'

export default function StaffCalendars({ board, who, onWho, tick, openKey, onOpen }: {
  board: Board
  who: string
  onWho: (who: string) => void
  /** moves after a write here, so the list is read again at once */
  tick: number
  openKey: string
  onOpen: (s: StaffShift) => void
}) {
  const shown = whoOf(board, who)
  const read = useSchedulingRead(`staff|${shown}`, () => readStaffShifts(shown), tick)
  const [earlier, setEarlier] = useState(false)
  const data = read.data
  const today = data?.today || board.today
  const shifts = data?.shifts ?? []
  const upcoming = shifts.filter((s) => s.date >= today)
  const past = shifts.filter((s) => s.date < today)
  const houses = new Set(upcoming.map((s) => s.house_code)).size
  const open = shown === OPEN_WHO
  const calendarHref = useHouseCalendarHref()
  // an answer without the list (a server from before it) lists everyone, as before
  const active = data ? (data.active_staff === undefined ? null : data.active_staff) : undefined

  return (
    <div className="grid gap-4" data-staff-calendars="">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4">
        <PersonDropdown board={board} who={shown} onPick={onWho} active={active} activeWhy={data?.active_staff_why ?? ''} />
        {data && (
          <p className="text-[12.5px] text-text-3" data-staff-count="">
            {upcoming.length === 0 ? 'Nothing coming up'
              : `${upcoming.length} ${open ? 'open ' : ''}shift${upcoming.length === 1 ? '' : 's'} coming up · ${houses} house${houses === 1 ? '' : 's'}`}
          </p>
        )}
      </div>

      {read.status === 'failed' && (
        <div className={cn('flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-[12.5px] text-danger', DANGER_NOTE)}>
          <span className="flex-1">The shifts could not be read — {read.error || 'the server did not answer'}.</span>
          <button type="button" className={OUTLINE_BTN} onClick={read.reload}><RefreshCw size={13} /> Try again</button>
        </div>
      )}
      {read.status === 'ready' && read.error && (
        <p className="text-[12px] text-warning">It could not be read again just now — {read.error}. What is drawn is from before.</p>
      )}

      <section className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1" aria-label="Shifts" data-staff-shifts="">
        <div className={cn('hidden gap-x-3 border-b border-border bg-surface-2/60 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3 sm:grid', GRID)}>
          {STAFF_COLUMNS.map((c) => <span key={c}>{c}</span>)}
        </div>
        {read.status === 'loading' && !data && <p className="px-4 py-6 text-[13px] text-text-3">Reading the houses…</p>}
        {data && upcoming.length === 0 && (
          <div className="grid place-items-center gap-1 px-4 py-12 text-center" data-staff-empty="">
            <CalendarClock size={26} className="text-text-3" />
            <p className="text-[14px] font-semibold text-text-1">{open ? 'No open shifts' : 'No shifts coming up'}</p>
            <Muted>{open ? 'Every shift from today on has somebody on it.' : 'Nothing is on the calendar for this person from today on.'}</Muted>
          </div>
        )}
        <ShiftRows board={board} shifts={upcoming} today={today} openKey={openKey} onOpen={onOpen} calendarHref={calendarHref} />
        {!open && past.length > 0 && (
          <div className="border-t border-border">
            <button type="button" onClick={() => setEarlier(!earlier)} aria-expanded={earlier} data-act="earlier"
              className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-[12.5px] font-semibold text-text-2 hover:bg-surface-2">
              <ChevronDown size={14} className={cn('transition-transform', earlier && 'rotate-180')} />
              {earlier ? 'Hide' : 'Show'} earlier shifts in this period ({past.length})
            </button>
            {earlier && <ShiftRows board={board} shifts={[...past].reverse()} today={today} openKey={openKey} onOpen={onOpen}
              calendarHref={calendarHref} muted />}
          </div>
        )}
      </section>
    </div>
  )
}

export function ShiftRows({ board, shifts, today, openKey, onOpen, calendarHref, muted = false }: {
  board: Board
  shifts: StaffShift[]
  today: string
  openKey: string
  onOpen: (s: StaffShift) => void
  /** the location's House Calendar link, '' for plain text */
  calendarHref: (house: string) => string
  muted?: boolean
}) {
  if (!shifts.length) return null
  return (
    <ul className="divide-y divide-border">
      {shifts.map((s) => {
        const span = cellMinutes(s)
        const house = board.houses.find((h) => h.code === s.house_code)
        const label = houseLabel(board, s.house_code)
        const href = calendarHref(s.house_code)
        const on = openKey === shiftKey(s)
        return (
          <li key={shiftKey(s)} data-shift-row={shiftKey(s)}
            className={cn('relative grid grid-cols-2 items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] text-text-1 transition-colors hover:bg-surface-2 sm:py-2.5',
              GRID, on && 'bg-tint-primary hover:bg-tint-primary', muted && 'text-text-2')}>
            {/* the whole row opens the shift; the location's link is drawn above it, never inside the button */}
            <button type="button" onClick={() => onOpen(s)} data-shift={shiftKey(s)} aria-current={on || undefined}
              aria-label={`${dayWords(s.date)} at ${label}`}
              className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" />
            <span className="flex items-center gap-1.5" data-col="date">
              {dayWords(s.date)}
              {s.date === today && <span className="rounded-full bg-tint-primary px-1.5 text-[10.5px] font-semibold text-primary">Today</span>}
            </span>
            <span className="flex min-w-0 items-center justify-end gap-2 font-semibold sm:justify-start" data-col="location">
              <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TINT_BG[houseTint(house?.location || s.house_code)])} />
              {href ? (
                <Link to={href} data-house-calendar={s.house_code} title={`${label} — House Calendar`}
                  className="relative truncate text-primary hover:underline">{label}</Link>
              ) : (
                <span className="truncate">{label}</span>
              )}
            </span>
            {span ? (
              <>
                <span className="font-mono text-[12.5px]" data-col="start">{hhmm(span[0] / 60)}</span>
                <span className="text-right font-mono text-[12.5px] sm:text-left" data-col="end">{hhmm(span[1] / 60)}</span>
              </>
            ) : (
              <>
                <span className="font-mono text-[12.5px]" data-col="start">{s.text}</span>
                <span className="text-right text-text-3 sm:text-left" data-col="end">—</span>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function PersonDropdown({ board, who, onPick, active, activeWhy }: {
  board: Board
  who: string
  onPick: (who: string) => void
  /** the active staff by key, as the read answered (undefined until it has) */
  active: string[] | null | undefined
  activeWhy: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const phone = useMediaQuery('(max-width: 639px)')
  const box = useRef<HTMLDivElement | null>(null)
  const close = () => setOpen(false)
  usePanelEscape(open && !phone, close)

  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, phone])

  const anyone = mayChooseAnyone(board)
  const choices = choicesFor(board, active)
  // the one drawn may be somebody the list leaves out (a link to a person no longer active): still named
  const nameOf = (key: string) => board.people.find((p) => p.key === key)?.name || (key === board.viewer.key ? board.viewer.name : key)
  const phones = phonesOf(board.people)
  const q = nameKey(query)
  const rows = choices.filter((c) => !q || nameKey(c.name).includes(q))
  const current = choices.find((c) => c.key === who) ?? { key: who, name: nameOf(who), chip: '', phone: phones[who] ?? '' }
  const pick = (key: string) => { setOpen(false); setQuery(''); onPick(key) }

  const list = (
    <div className="grid gap-3 pt-1" data-person-list="">
      {choices.length > 6 && <SearchInput value={query} onChange={setQuery} placeholder="Search staff…" />}
      <ul role="listbox" aria-label="Staff" className="scroll-thin grid max-h-[360px] gap-1 overflow-y-auto">
        {rows.map((c) => {
          const on = c.key === who
          return (
            <li key={c.key} role="option" aria-selected={on} data-person={c.key}>
              <button type="button" onClick={() => pick(c.key)}
                className={cn('flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors', on ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
                <Who choice={c} />
                <Check size={15} className={cn('shrink-0 text-[var(--success)]', !on && 'invisible')} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-[12.5px] text-text-3">Nobody matches.</li>}
      </ul>
      {!anyone && <Muted className="px-1">You see your own shifts and the open ones.</Muted>}
      {anyone && active === undefined && <Muted className="px-1">Reading the staff list…</Muted>}
      {anyone && active === null && (
        <Muted className="px-1">Everyone on the calendars is listed — {activeWhy || 'the staff list was not in the answer'}.</Muted>
      )}
      {anyone && active && activeWhy && <Muted className="px-1">Active staff only — {activeWhy}.</Muted>}
    </div>
  )

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} data-person-dropdown=""
        className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3 text-left text-text-1 transition-colors hover:bg-surface-3 sm:w-[320px]">
        <Who choice={current} small />
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Staff" title="Choose a person">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[360px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}

function Who({ choice, small = false }: { choice: { key: string; name: string; chip: string; phone?: string }; small?: boolean }) {
  const open = choice.key === OPEN_WHO
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      {open ? (
        <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full bg-tint-danger text-tint-fg-danger', small ? 'h-7 w-7' : 'h-8 w-8')}>
          <CalendarClock size={small ? 14 : 15} />
        </span>
      ) : (
        <Avatar name={choice.name} size={small ? 'xs' : 'sm'} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-semibold', small ? 'text-[14px]' : 'text-[13.5px]')}>{choice.name}</span>
        {choice.phone && (
          <span className="block truncate text-[11px] font-normal leading-[14px] text-text-3 tabular-nums" data-phone={choice.key}>{choice.phone}</span>
        )}
      </span>
      {choice.chip && (
        <span className={cn('shrink-0 rounded-full px-2 text-[11px] font-medium', open ? PILL.amber : PILL.slate)}>{choice.chip}</span>
      )}
    </span>
  )
}
