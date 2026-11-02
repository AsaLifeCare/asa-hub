// VACATION REQUESTS — the person's own time off requests, grouped Pending, On now, Approved and Concluded, under…
// Add is always drawn, greyed with its reason when it may not be pressed.
import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ohioDayYear } from '@/lib/ohio'
import {
  CONCLUDED_SHOWN, GROUP_LABEL, addFor, dayHead, figureLine, groupsOf, onRecordNote, pillClass, rangeWords, rowActs, waitingWords,
  type Allowed, type MyCalendarView, type PanelAsk, type RequestRow,
} from './myCalendarModel'
import { useVacationRoute, type RouteState } from './useMyCalendar'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
// the column template is a whole literal so the stylesheet keeps it
const COLS = 'sm:grid-cols-[minmax(110px,1fr)_minmax(120px,1.2fr)_minmax(120px,1.2fr)_minmax(48px,0.5fr)]'
const EDIT_BUTTON = 'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--success)] text-primary transition-colors ' +
  'hover:bg-primary/5 disabled:cursor-not-allowed disabled:border-border disabled:text-text-3 disabled:opacity-60'
const TRASH_BUTTON = 'inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-[var(--danger)] transition-colors ' +
  'hover:bg-tint-danger disabled:cursor-not-allowed disabled:text-text-3 disabled:opacity-60'
export const ADD_BUTTON = 'inline-flex h-10 items-center gap-2 rounded-full bg-[var(--success)] px-4 text-[13px] font-semibold text-white ' +
  'transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

export default function RequestsCard({ view, acting, onOpen, route }: {
  view: MyCalendarView
  acting: boolean
  onOpen: (ask: PanelAsk) => void
  /** what you filed into Scheduling; read here for your own calendar when not handed in */
  route?: RouteState
}) {
  const [allConcluded, setAllConcluded] = useState(false)
  const r = view.requests
  const own = view.person.own
  const read = useVacationRoute(route === undefined && own && !acting)
  const routed = own ? (route ?? read) : null
  const add = addFor(view, acting)
  const figure = figureLine(r.figure)
  const waiting = waitingWords(r.figure)
  const onRecord = onRecordNote(r.figure)
  const title = own ? 'Vacation Requests' : `Vacation Requests · ${view.person.name || 'this person'}`
  return (
    <section aria-label="Vacation Requests" className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {figure && (
            <p className="text-[13px] text-text-2" data-figure="">
              {figure}{waiting && <span className="text-text-3">{` ${waiting}`}</span>}
            </p>
          )}
          <span title={add.allowed ? undefined : add.why}>
            <button type="button" className={ADD_BUTTON} disabled={!add.allowed} data-add=""
              aria-describedby={add.allowed ? undefined : 'my-calendar-add-why'}
              onClick={() => add.allowed && onOpen({ kind: 'add' })}>
              <Plus size={16} /> Add Time Off Request
            </button>
          </span>
        </div>
      </div>
      {!add.allowed && add.why && (
        <p id="my-calendar-add-why" className="mb-2 text-[12px] text-text-3 sm:text-right" data-add-why="">{add.why}</p>
      )}
      {onRecord && <p className="mb-2 text-[11.5px] text-text-3" data-on-record="">{onRecord}</p>}

      {r.state !== 'ready' && (
        <p role="alert" className="py-4 text-[12.5px] text-[var(--danger)]" data-requests-why="">
          {r.why || 'The time off requests could not be read.'} No request is listed rather than an empty list.
        </p>
      )}
      {r.state === 'ready' && r.rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-text-3">
          {own ? 'You have no time off requests yet.' : 'This person has no time off requests.'}
        </p>
      )}
      {r.state === 'ready' && r.rows.length > 0 && (
        <div className="min-w-0">
          <div className="hidden grid-cols-[minmax(0,1fr)_88px] items-center gap-4 border-b border-border pb-2 sm:grid">
            <div className={cn('grid gap-4', COLS, HEAD)}>
              <span>Status</span><span>Start date</span><span>End date</span><span>Days</span>
            </div>
            <span />
          </div>
          {groupsOf(r.rows).map((g) => {
            const hidden = g.group === 'concluded' && !allConcluded ? Math.max(0, g.rows.length - CONCLUDED_SHOWN) : 0
            const rows = hidden ? g.rows.slice(0, CONCLUDED_SHOWN) : g.rows
            return (
              <div key={g.group} data-group={g.group}>
                <p className={cn('pb-1 pt-4', HEAD)}>{GROUP_LABEL[g.group]}</p>
                {rows.map((row) => <RequestLine key={row.ref} row={row} view={view} acting={acting} onOpen={onOpen} />)}
                {g.group === 'concluded' && g.rows.length > CONCLUDED_SHOWN && (
                  <button type="button" onClick={() => setAllConcluded(!allConcluded)} data-more=""
                    className="mt-2 text-[12.5px] font-medium text-primary hover:underline">
                    {hidden ? `Show ${hidden} more concluded` : 'Show fewer'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {routed && <RoutedRequests state={routed} />}
    </section>
  )
}

const ROUTED_PILL: Record<string, string> = {
  waiting: 'bg-tint-amber text-tint-fg-amber',
  approved: 'bg-tint-mint text-tint-fg-mint',
  approved_future: 'bg-tint-mint text-tint-fg-mint',
  declined: 'bg-tint-pink text-danger',
}

/** Your own requests filed into Scheduling from here; nothing when the switch is off and none was ever filed. */
export function RoutedRequests({ state }: { state: RouteState }) {
  if (state.status === 'failed') {
    return <p className="mt-3 text-[12px] text-text-3" data-routed-why="">The requests you asked of Scheduling could not be read just now.</p>
  }
  const mine = state.route?.mine ?? []
  if (!mine.length) return null
  return (
    <div className="mt-4 border-t border-border pt-3" data-routed-list="">
      <p className={HEAD}>Asked in Scheduling</p>
      <ul className="mt-1 divide-y divide-border">
        {mine.map((m) => (
          <li key={m.flow_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5" data-routed-request={m.flow_id}>
            <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
              ROUTED_PILL[m.state] ?? 'bg-surface-2 text-text-2')}>{m.word || m.state}</span>
            <span className="text-[13px] text-text-1">{rangeWords(m.from, m.to)}</span>
            {m.decided_by && <span className="text-[12px] text-text-3">by {m.decided_by}{m.decided_at ? ` · ${ohioDayYear(m.decided_at) || m.decided_at}` : ''}</span>}
            {m.note && <span className="w-full text-[12px] text-text-2">{m.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RequestLine({ row, view, acting, onOpen }: {
  row: RequestRow
  view?: Pick<MyCalendarView, 'person' | 'form'>
  acting: boolean
  onOpen: (ask: PanelAsk) => void
}) {
  const acts = rowActs(row, acting, view)
  const noTest = useTestWarningsHidden()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-4 border-b border-border py-3" data-request={row.ref}>
      <button type="button" onClick={() => onOpen({ kind: 'request', mode: 'detail', ref: row.ref })}
        aria-label={`${row.word}: ${rangeWords(row.start, row.end)} — open the request`}
        className={cn('grid grid-cols-2 items-center gap-x-4 gap-y-1 rounded-md text-left hover:bg-surface-2/60 sm:gap-4', COLS)}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span data-status={row.status}
            className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold', pillClass(row))}>
            {row.word}
          </span>
          {row.test_mode && !noTest && (
            <span className="rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-amber">Test</span>
          )}
        </span>
        <span className="text-[13px] text-text-1" data-start="">{dayHead(row.start) || row.start}</span>
        <span className="text-[13px] text-text-1" data-end="">{dayHead(row.end) || row.end}</span>
        <span className="text-[13px] text-text-2" data-days="">{row.days}</span>
      </button>
      <div className="flex items-center justify-end gap-2">
        <IconAct id={`my-calendar-edit-${row.ref}`} act="edit" gate={acts.edit} label={`Change the dates of ${row.ref}`}
          className={EDIT_BUTTON} onPress={() => onOpen({ kind: 'request', mode: 'edit', ref: row.ref })}>
          <Pencil size={14} strokeWidth={1.8} />
        </IconAct>
        <IconAct id={`my-calendar-withdraw-${row.ref}`} act="withdraw" gate={acts.withdraw} label={`Withdraw ${row.ref}`}
          className={TRASH_BUTTON} onPress={() => onOpen({ kind: 'request', mode: 'withdraw', ref: row.ref })}>
          <Trash2 size={14} strokeWidth={1.8} />
        </IconAct>
      </div>
    </div>
  )
}

/** An icon button the relay may refuse: greyed, with its reason on hover and read out with it. */
export function IconAct({ id, act, gate, label, className, onPress, children }: {
  id: string
  act: string
  gate: Allowed
  label: string
  className: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <span title={gate.allowed ? label : gate.why} className="inline-flex">
      <button type="button" className={className} disabled={!gate.allowed} data-act={act} aria-label={label}
        aria-describedby={gate.allowed ? undefined : `${id}-why`} onClick={() => gate.allowed && onPress()}>
        {children}
      </button>
      {!gate.allowed && <span id={`${id}-why`} className="sr-only">{gate.why}</span>}
    </span>
  )
}
