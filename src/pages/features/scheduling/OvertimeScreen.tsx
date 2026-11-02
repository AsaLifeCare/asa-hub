// SCHEDULING › OVERTIME — planned hours (Scheduling's calendars) beside worked hours (PsiAnywhere's record) per employee
// per Sunday→Saturday week of a PsiAnywhere pay period, summed across every house, against the 40 h line. A scheduler
// sees who is planned past it (amber) and who worked past it (red); a row opens that person's days in the right panel.
// Read from GET /hub-lanes/scheduling/overtime (app/overtime_lanes.py), which answers to App Control's own
// scheduling.overtime row — the master's alone until he releases it. Its address keeps the dates as ot_from / ot_to, so
// it never collides with the calendars' own view, period, week, range, house, who and day.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw, Timer, Users } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import Skeleton from '@/components/shared/Skeleton'
import { useMediaQuery } from '@/hooks/use-mobile'
import { relayLane } from '@/lib/noticesApi'
import { cn } from '@/lib/utils'
import { rangeLabel, withParams } from '@/pages/features/calendarbuilder/calendarScreen'
import { nameKey } from '@/pages/features/shifts/houseCalTypes'
import { DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import {
  CUSTOM_CHOICE, OT_FROM, OT_TO, OVERTIME_THRESHOLD, cutsWeeks, hoursText, isPsiPeriod, overtimeFrom, overtimePath, periodChoices,
  personWeek, pickedWords, pickerEmployees, plannedSourceLine, psiLabel, psiPeriodOf, rangeProblem, shownPeople, summaryOf, weekDays,
  type OtEmployee, type OtPerson, type OtPicked, type OvertimeData,
} from './overtimeModel'
import { useSchedulingRead } from './schedulingLane'
import { dayWords } from './StaffCalendars'
import { FIELD, LABEL, Muted, OUTLINE_BTN } from './SchedulingParts'

const CARD = 'overflow-hidden rounded-[16px] border border-border bg-surface shadow-1'
const WORKED_LINE = 'Worked hours are PsiAnywhere’s entries — Pending, Awaiting approval, Submitted and Imported; ' +
  'Rejected and Duplicate are left out. Weeks run Sunday to Saturday, every house together.'
/** Commit typed custom dates after this pause, so a date typed digit by digit is read once. */
const TYPING_MS = 400

export default function OvertimeScreen({ anchor, tick }: {
  /** the day Scheduling stands on (overtimeModel.psiAnchorDay): the pay period holding it opens first */
  anchor: string
  /** moves after a Scheduling write, so the planned hours are read again at once */
  tick: number
}) {
  const [params, setParams] = useSearchParams()
  const set = (s: Record<string, string | null>) => setParams(withParams(params, s), { replace: true })
  const askedFrom = params.get(OT_FROM) ?? ''
  const askedTo = params.get(OT_TO) ?? ''
  // the dates in the address when they can be asked for; else the pay period holding Scheduling's day
  const span = !rangeProblem(askedFrom, askedTo) ? { from: askedFrom, to: askedTo } : psiPeriodOf(anchor)
  const from = span?.from ?? ''
  const to = span?.to ?? ''

  // "Custom dates" picked over a span that is still a pay period; any other span is custom by itself
  const [customAsked, setCustomAsked] = useState(false)
  // custom dates being typed; null = the fields show the span on screen
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)
  const [picked, setPicked] = useState<OtPicked>(() => new Map())
  const [onlyOver, setOnlyOver] = useState(true)
  const [open, setOpen] = useState('')

  const custom = customAsked || (Boolean(span) && !isPsiPeriod(from, to))
  const typed = draft ?? { from, to }
  // typed dates stay custom even when they land on a pay period, so the fields never vanish under the cursor
  const type = (next: { from: string; to: string }) => {
    setCustomAsked(true)
    setDraft(next)
  }
  const problem = custom ? rangeProblem(typed.from, typed.to) : ''
  useEffect(() => {
    if (!draft || problem) return
    const t = window.setTimeout(() => {
      setDraft(null)
      if (draft.from !== from || draft.to !== to) set({ [OT_FROM]: draft.from, [OT_TO]: draft.to })
    }, TYPING_MS)
    return () => window.clearTimeout(t)
  }, [draft, problem, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  // no day to stand on (never, once the board is read): the lane's own default, the current pay period
  const path = span ? overtimePath(from, to) : '/hub-lanes/scheduling/overtime'
  const read = useSchedulingRead(`overtime|${from}|${to}`, () => relayLane<unknown>(path), tick)
  const data = useMemo(() => (read.data ? overtimeFrom(read.data) : null), [read.data])
  const shownFrom = from || data?.from || ''
  const shownTo = to || data?.to || ''

  const choices = periodChoices(data?.periods ?? [], shownFrom, shownTo)
  const choice = custom ? CUSTOM_CHOICE : choices.find((c) => c.from === shownFrom && c.to === shownTo)?.id ?? CUSTOM_CHOICE
  const onChoice = (id: string) => {
    if (id === CUSTOM_CHOICE) { setCustomAsked(true); return }
    const c = choices.find((x) => x.id === id)
    if (!c) return
    setCustomAsked(false)
    setDraft(null)
    set({ [OT_FROM]: c.from, [OT_TO]: c.to })
  }

  const rows = useMemo(() => (data ? shownPeople(data.people, picked, onlyOver) : []), [data, picked, onlyOver])
  const sum = summaryOf(rows)
  const threshold = data?.threshold ?? OVERTIME_THRESHOLD
  const person = open ? data?.people.find((p) => p.key === open) ?? null : null

  return (
    <div className="grid gap-4" data-overtime="">
      <div className="flex flex-wrap items-end gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4" data-ot-bar="">
        <label className={cn(LABEL, 'w-full sm:w-[230px]')}>
          Pay period
          <select value={choice} onChange={(e) => onChoice(e.target.value)} className={FIELD} data-ot-period="">
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            <option value={CUSTOM_CHOICE}>Custom dates</option>
          </select>
        </label>
        {custom && (
          <>
            <label className={cn(LABEL, 'w-[calc(50%-6px)] sm:w-[150px]')}>
              From
              <input type="date" value={typed.from} max={typed.to || undefined} onChange={(e) => type({ ...typed, from: e.target.value })}
                className={FIELD} data-ot-from="" />
            </label>
            <label className={cn(LABEL, 'w-[calc(50%-6px)] sm:w-[150px]')}>
              To
              <input type="date" value={typed.to} min={typed.from || undefined} onChange={(e) => type({ ...typed, to: e.target.value })}
                className={FIELD} data-ot-to="" />
            </label>
          </>
        )}
        <EmployeePicker employees={data?.employees ?? null} picked={picked} onPicked={setPicked} />
        <button type="button" role="switch" aria-checked={onlyOver} onClick={() => setOnlyOver(!onlyOver)} data-act="only-over"
          className="inline-flex h-9 items-center gap-2 text-[12.5px] font-semibold text-text-2 hover:text-text-1">
          <span aria-hidden className={cn('relative h-5 w-9 rounded-full transition-colors', onlyOver ? 'bg-primary' : 'bg-surface-3')}>
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-1 transition-all', onlyOver ? 'left-[18px]' : 'left-0.5')} />
          </span>
          Only over {hoursText(threshold)} h
        </button>
        {data && read.status === 'loading' && <Loader2 size={15} className="mb-2.5 animate-spin text-text-3" aria-label="Reading" />}
      </div>
      {problem && <p className="-mt-2 text-[12px] text-warning" data-ot-problem="">{problem}</p>}

      {read.status === 'failed' && (
        <div className={cn('flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-[12.5px] text-danger', DANGER_NOTE)} data-ot-failed="">
          <span className="flex-1">Overtime could not be read — {read.error || 'the server did not answer'}.</span>
          <button type="button" className={OUTLINE_BTN} onClick={read.reload}><RefreshCw size={13} /> Try again</button>
        </div>
      )}
      {read.status === 'ready' && read.error && (
        <p className="text-[12px] text-warning">It could not be read again just now — {read.error}. What is drawn is from before.</p>
      )}

      <section className={CARD} aria-label="Overtime" data-ot-table="">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <Timer size={16} className="text-text-2" />
          <h2 className="text-[14px] font-semibold text-text-1">
            {shownFrom && shownTo ? psiLabel(shownFrom, shownTo) : 'Overtime'}
          </h2>
          {data && (
            <span className="text-[12.5px] text-text-3" data-ot-summary="">
              {sum.people} {sum.people === 1 ? 'person' : 'people'} · {sum.workedOver} worked over {hoursText(threshold)} h
              · {hoursText(sum.overtime)} h overtime
            </span>
          )}
        </header>
        {!data && read.status === 'loading' && (
          <div className="grid gap-2 border-t border-border px-4 py-4" data-ot-loading="">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}
        {data && rows.length === 0 && (
          <div className="border-t border-border">
            {data.people.length === 0 ? (
              <EmptyState title="No hours in these weeks"
                body="Nobody has planned or worked hours in the weeks of these dates." />
            ) : onlyOver ? (
              <EmptyState title={`Nobody over ${hoursText(threshold)} h`}
                body={`No one ${picked.size ? 'picked ' : ''}is planned or worked over ${hoursText(threshold)} h in a week of these dates.`}
                action={{ label: 'Show everyone', onClick: () => setOnlyOver(false) }} />
            ) : (
              <EmptyState title="Nobody picked has hours here" body="The employees picked have no hours in the weeks of these dates."
                action={{ label: 'Show all employees', onClick: () => setPicked(new Map()) }} />
            )}
          </div>
        )}
        {data && rows.length > 0 && (
          <div className="scroll-thin overflow-x-auto border-t border-border" data-ot-scroll="">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  <th className="sticky left-0 z-[1] bg-surface-2 px-4 py-2.5 text-left">Employee</th>
                  {data.weeks.map((w) => (
                    <th key={w.from} className="whitespace-nowrap px-3 py-2 text-right" title={`Sunday to Saturday · ${w.label}`} data-ot-week={w.from}>
                      <span className="block">{rangeLabel(w)}</span>
                      <span className="block font-medium normal-case tracking-normal">Planned · Worked</span>
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-4 py-2.5 text-right">Overtime (worked)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => (
                  <PersonRow key={p.key} person={p} data={data} on={open === p.key} onOpen={() => setOpen(p.key)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data && (
        <div className="grid gap-1" data-ot-notes="">
          {plannedSourceLine(data.plannedSource) && <Muted>{plannedSourceLine(data.plannedSource)}</Muted>}
          <Muted>{WORKED_LINE}</Muted>
          {cutsWeeks(data) && <Muted>Each week counts all seven of its days, also those outside the dates picked.</Muted>}
        </div>
      )}

      <SidePanel open={Boolean(person)} onClose={() => setOpen('')} label="Overtime" title={person?.employeeName ?? ''}>
        {person && data && <PersonDays person={person} data={data} />}
      </SidePanel>
    </div>
  )
}

/** One employee: planned · worked per week, planned past the line amber, worked past it red; the row opens their days. */
function PersonRow({ person, data, on, onOpen }: { person: OtPerson; data: OvertimeData; on: boolean; onOpen: () => void }) {
  return (
    <tr onClick={onOpen} data-ot-person={person.key} data-on={on ? '' : undefined}
      className={cn('group cursor-pointer text-text-1', on ? 'bg-tint-primary' : 'hover:bg-surface-2')}>
      <td className={cn('sticky left-0 z-[1] px-4 py-2.5', on ? 'bg-tint-primary' : 'bg-surface group-hover:bg-surface-2')}>
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen() }}
          className="flex max-w-[240px] items-center gap-1 text-left font-semibold outline-none focus-visible:underline">
          <span className="truncate">{person.employeeName}</span>
          <ChevronRight size={14} className="shrink-0 text-text-3" />
        </button>
      </td>
      {data.weeks.map((w) => {
        const pw = personWeek(person, w.from)
        return (
          <td key={w.from} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" data-ot-cell={w.from}>
            <span className={cn(pw.plannedOver ? 'font-semibold text-warning' : 'text-text-2')} title="Planned"
              data-planned-over={pw.plannedOver ? '' : undefined}>{hoursText(pw.planned)}</span>
            <span className="text-text-3"> · </span>
            <span className={cn(pw.over ? 'font-semibold text-danger' : 'text-text-1')} title="Worked"
              data-worked-over={pw.over ? '' : undefined}>{hoursText(pw.actual)}</span>
          </td>
        )
      })}
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
        {person.overtime > 0 ? <span className="font-semibold text-danger">{hoursText(person.overtime)} h</span> : <span className="text-text-3">—</span>}
      </td>
    </tr>
  )
}

/** The right panel: each week's seven days, planned against worked, the days outside the dates picked greyed. */
export function PersonDays({ person, data }: { person: OtPerson; data: OvertimeData }) {
  return (
    <div className="mt-3 grid gap-4" data-ot-panel={person.key}>
      <dl className="grid grid-cols-3 gap-2">
        {([['Planned', person.planned, false], ['Worked', person.actual, false], ['Overtime', person.overtime, person.overtime > 0]] as const)
          .map(([label, n, red]) => (
            <div key={label} className="rounded-md border border-border bg-surface px-2.5 py-2">
              <dt className={LABEL}>{label}</dt>
              <dd className={cn('mt-0.5 text-[15px] font-semibold tabular-nums', red ? 'text-danger' : 'text-text-1')}>{hoursText(n)} h</dd>
            </div>
          ))}
      </dl>
      {data.weeks.map((w) => {
        const pw = personWeek(person, w.from)
        return (
          <section key={w.from} aria-label={`Week ${w.label}`} data-ot-panel-week={w.from}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-border pb-1">
              <h3 className="text-[12.5px] font-semibold text-text-1">{rangeLabel(w)}</h3>
              <span className="text-[11.5px] tabular-nums text-text-3">
                <span className={cn(pw.plannedOver && 'font-semibold text-warning')}>{hoursText(pw.planned)} planned</span>
                {' · '}
                <span className={cn(pw.over && 'font-semibold text-danger')}>{hoursText(pw.actual)} worked</span>
                {pw.overtime > 0 && <span className="font-semibold text-danger"> · {hoursText(pw.overtime)} over</span>}
              </span>
            </header>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.08em] text-text-3">
                  <th className="py-1.5 text-left font-semibold">Day</th>
                  <th className="py-1.5 text-right font-semibold">Planned</th>
                  <th className="py-1.5 text-right font-semibold">Worked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {weekDays(w.from).map((d) => {
                  const v = person.days[d] ?? { planned: 0, actual: 0 }
                  const outside = d < data.from || d > data.to
                  return (
                    <tr key={d} className={outside ? 'text-text-3' : 'text-text-1'} data-ot-day={d}>
                      <td className="py-1.5">{dayWords(d)}{outside && <span className="ml-1 text-[11px]">· outside the dates</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">{v.planned ? hoursText(v.planned) : '—'}</td>
                      <td className={cn('py-1.5 text-right tabular-nums', v.actual > v.planned && v.planned > 0 && 'font-semibold')}>
                        {v.actual ? hoursText(v.actual) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}
      <Muted>{plannedSourceLine(data.plannedSource)} {WORKED_LINE}</Muted>
    </div>
  )
}

/** The employees drawn: everybody (none picked), or those ticked; searched by name. A popover, a bottom panel on a phone.
 * Somebody picked whom the dates on screen do not list stays in the list by name, so they can be unticked here. */
export function EmployeePicker({ employees, picked, onPicked, initialOpen = false }: {
  /** the answer's employees; null while no answer is drawn yet */
  employees: OtEmployee[] | null
  picked: OtPicked
  onPicked: (next: OtPicked) => void
  /** drawn open (the tests draw the list with it) */
  initialOpen?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
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

  const sorted = useMemo(() => pickerEmployees(employees ?? [], picked), [employees, picked])
  const q = nameKey(query)
  const shown = sorted.filter((e) => !q || nameKey(e.name).includes(q))
  const words = pickedWords(picked)
  const toggle = (e: OtEmployee) => {
    const next = new Map(picked)
    if (next.has(e.key)) next.delete(e.key)
    else next.set(e.key, e.name)
    onPicked(next)
  }

  const list = (
    <div className="grid gap-3 pt-1" data-ot-employee-list="">
      <SearchInput value={query} onChange={setQuery} placeholder="Search employees…" />
      <ul role="listbox" aria-label="Employees" aria-multiselectable="true" className="scroll-thin grid max-h-[360px] gap-0.5 overflow-y-auto">
        <li role="option" aria-selected={picked.size === 0}>
          <button type="button" onClick={() => onPicked(new Map())} data-ot-employee=""
            className={cn('flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-semibold text-text-1 transition-colors',
              picked.size === 0 ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
            <Users size={15} className="shrink-0 text-text-3" />
            <span className="flex-1">All employees</span>
            <Check size={15} className={cn('shrink-0 text-[var(--success)]', picked.size !== 0 && 'invisible')} />
          </button>
        </li>
        {shown.map((e) => {
          const on = picked.has(e.key)
          return (
            <li key={e.key} role="option" aria-selected={on}>
              <button type="button" onClick={() => toggle(e)} data-ot-employee={e.key}
                data-ot-absent={e.absent && employees ? '' : undefined}
                className={cn('flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-text-1 transition-colors',
                  on ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
                <span aria-hidden className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border',
                  on ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface')}>
                  {on && <Check size={11} />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {e.name}
                  {e.absent && employees && <span className="text-[11.5px] text-text-3"> · no hours in these dates</span>}
                </span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="px-2.5 py-3 text-[12.5px] text-text-3">
            {sorted.length ? 'Nobody matches.' : employees ? 'Nobody has hours in these weeks.' : 'Reading the employees…'}
          </li>
        )}
      </ul>
    </div>
  )

  return (
    <div ref={box} className="relative w-full sm:w-[260px]">
      <span className={LABEL}>Employees</span>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} data-ot-employees=""
        aria-label={`Employees: ${words}`} className={cn(FIELD, 'flex items-center gap-2 text-left')}>
        <span className="min-w-0 flex-1 truncate">{words}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Employees" title="Choose employees">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[320px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}
