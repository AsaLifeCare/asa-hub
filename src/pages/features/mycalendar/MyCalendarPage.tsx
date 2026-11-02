// MY CALENDAR · Week — the person's week of shifts, then their own time off requests.
// Whose calendar this is is the relay's decision (/hub-lanes/my-calendar): the signed-in account's own, or any…
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { RefreshCw } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import SidePanel from '@/components/shared/SidePanel'
import { useAuthStore } from '@/auth/useAuthStore'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { ReadStamp } from '@/components/FreshnessStamp'
import {
  choiceAfter, choiceLabel, sentence, testModeLine, weekAfter, type MyCalendarView, type PanelAsk,
} from './myCalendarModel'
import { chooserOf, useMyCalendar, type Chooser, type MyCalendarState } from './useMyCalendar'
import WeekCard from './WeekCard'
import RequestsCard from './RequestsCard'
import ShiftBody, { shiftPanelTitle } from './ShiftPanel'
import { AddForm, ApprovedRequest, EditForm, RequestDetail, WithdrawForm, requestPanelTitle } from './RequestPanel'
import { FamilyCalendarPage } from './FamilyWeek'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

export const VISIT_SENTENCE = "My Calendar shows the signed-in account's own calendar — close the visit to see it."

const query = (person: string, week: string) => {
  const parts = [...(person ? [`person=${encodeURIComponent(person)}`] : []), ...(week ? [`week=${encodeURIComponent(week)}`] : [])]
  return parts.length ? `?${parts.join('&')}` : ''
}

/** Everything the page holds. An open member visit reads nothing: the door answers the session's own account. */
export function useMyCalendarPage(person: string, week: string, onPerson: (key: string) => void, onWeek: (week: string) => void) {
  const signedIn = useAuthStore((s) => !!s.user)
  const acting = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const eff = useEffectiveUser()
  const visiting = !!eff?.visiting
  const { state, refresh, chooser, backdrop } = useMyCalendar(signedIn && !visiting, person, week)
  // a person the door refuses as out of scope or as no roster row, or a week it cannot read, is let go
  const kept = choiceAfter(state, person)
  const keptWeek = weekAfter(state, week)
  useEffect(() => {
    if (kept !== person) onPerson(kept)
  }, [kept, person, onPerson])
  useEffect(() => {
    if (keptWeek !== week) onWeek(keptWeek)
  }, [keptWeek, week, onWeek])
  return { visiting, acting, state, refresh, chooser, backdrop }
}

/** A client-role account (a client or a guardian) reads its client's week; everyone else, the staff calendar. */
export default function MyCalendarPage() {
  const eff = useEffectiveUser()
  if (eff?.visiting) return <VisitNotice />
  return eff?.role === 'client' ? <FamilyCalendarPage /> : <StaffCalendarPage />
}

function StaffCalendarPage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(search)
  const person = params.get('person') ?? ''
  const week = params.get('week') ?? ''
  const onPerson = useCallback((key: string) => navigate(`${pathname}${query(key, week)}`, { replace: true }), [navigate, pathname, week])
  const onWeek = useCallback((w: string) => navigate(`${pathname}${query(person, w)}`, { replace: true }), [navigate, pathname, person])
  const { visiting, acting, state, refresh, chooser, backdrop } = useMyCalendarPage(person, week, onPerson, onWeek)
  // the panel belongs to the person and week it was opened on
  const here = `${person}|${week}`
  const [slot, setSlot] = useState<{ here: string; ask: PanelAsk | null }>({ here, ask: null })
  const ask = slot.here === here ? slot.ask : null
  const onAsk = useCallback((next: PanelAsk | null) => setSlot({ here, ask: next }), [here])
  if (visiting) return <VisitNotice />
  return (
    <>
      <MyCalendarScreen state={state} backdrop={backdrop} person={person} week={week} chooser={chooser} acting={acting}
        onPerson={onPerson} onWeek={onWeek} onRetry={() => void refresh()} onOpen={onAsk} />
      <CalendarPanel ask={ask} view={state.data ?? backdrop} acting={acting} onAsk={onAsk} onClose={() => onAsk(null)}
        onChanged={() => void refresh()} />
    </>
  )
}

export function VisitNotice() {
  return (
    <div className="w-full pb-16">
      <EmptyState title="My Calendar" body={VISIT_SENTENCE} />
    </div>
  )
}

export function MyCalendarScreen({ state, backdrop = null, person, week, chooser = null, acting, onPerson, onWeek, onRetry, onOpen }: {
  state: MyCalendarState
  /** the same person's last answer, standing behind a week still being read */
  backdrop?: MyCalendarView | null
  person: string
  week: string
  /** the person list to draw while no answer is held (the session's last mass answer's) */
  chooser?: Chooser | null
  acting: boolean
  onPerson: (key: string) => void
  onWeek: (week: string) => void
  onRetry: () => void
  onOpen: (ask: PanelAsk) => void
}) {
  // Settings › My Work hides every test mode warning from anyone but the master
  const noTest = useTestWarningsHidden()
  if (state.status === 'refused') {
    return (
      <div className="w-full pb-16">
        <EmptyState title={state.reason === 'visit' ? 'My Calendar' : 'My Calendar is not open here'} body={state.error} />
        <div className="flex justify-center"><RetryButton onRetry={onRetry} busy={state.refreshing} /></div>
      </div>
    )
  }
  const view = state.data ?? backdrop
  // an answer decides whether the chooser is drawn; with none yet, the session's last mass answer does
  const bar: Chooser | null = view ? chooserOf(view) : chooser
  const testLine = view && !noTest ? testModeLine(view.test_mode) : ''
  const refs = new Set((view?.requests.rows ?? []).map((r) => r.ref))
  const own = view?.person.own ?? true
  const name = view?.person.name || 'this person'
  return (
    <div className="w-full pb-16">
      {bar && <PersonBar chooser={bar} person={person} onPerson={onPerson} onRetry={onRetry} busy={state.refreshing}
        edition={view?.scope.edition ?? ''} />}
      {view?.scope.why && <p className="mb-3 text-[12px] text-text-3">{view.scope.why}</p>}
      {view && !own && (
        <p className="mb-3 text-[12.5px] text-text-2" data-chosen="">
          {`Showing ${name}'s calendar and requests. A request you add here is filed for ${name}, by you.`}
        </p>
      )}
      {testLine && (
        <p role="status" className="mb-4 rounded-lg bg-tint-amber px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber" data-test-strip="">
          {testLine}
        </p>
      )}
      {!view && <ReadLine state={state} person={person} onRetry={onRetry} />}
      {state.data && state.status === 'failed' && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--warning)]">
          The last refresh failed: {state.error || 'no answer'}. What is shown is from the read before.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      )}
      {view && (
        <div className="grid gap-5">
          <WeekCard week={state.data?.week ?? null} title={own ? 'My Week' : `Week · ${name}`} asked={week} today={view.today}
            reading={state.refreshing} failed={!state.data && state.status === 'failed' ? state.error || 'no answer' : ''}
            refs={refs} onWeek={onWeek} onOpen={onOpen} onRetry={onRetry} />
          <RequestsCard view={view} acting={acting} onOpen={onOpen} />
        </div>
      )}
      {state.data && (state.readAt > 0 || state.kept) && (
        <ReadStamp at={state.readAt} kept={state.kept} />
      )}
    </div>
  )
}

export function ReadLine({ state, person, onRetry }: { state: MyCalendarState; person: string; onRetry: () => void }) {
  if (state.status === 'failed') {
    return (
      <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]">
          My Calendar could not be read: {state.error || 'no answer'}. Nothing is shown rather than an empty week.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <p className="text-[12.5px] text-text-3">{person ? 'Reading this person’s calendar…' : 'Reading your calendar…'}</p>
    </section>
  )
}

/** The chooser: their own calendar, or any staff roster row's. Drawn from the master's answer or an edition holder's. */
export function PersonBar({ chooser, person, onPerson, onRetry, busy, edition = '' }: {
  chooser: Chooser
  person: string
  onPerson: (key: string) => void
  onRetry: () => void
  busy: boolean
  /** the edition that drew it for a session beside the master's ('' for the master) */
  edition?: string
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-chooser={edition || 'master'}>
      <label className="text-[12.5px] font-semibold text-text-2" htmlFor="my-calendar-person">Person</label>
      <select id="my-calendar-person" value={person} onChange={(e) => onPerson(e.target.value)}
        className="h-9 max-w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary">
        <option value="">Your own calendar</option>
        {chooser.people.map((p) => <option key={p.key} value={p.key}>{choiceLabel(p)}</option>)}
      </select>
      <RetryButton onRetry={onRetry} busy={busy} label="Refresh" />
      {chooser.people_why && (
        <span className="w-full text-[12px] text-[var(--warning)]">No staff member can be chosen: {sentence(chooser.people_why)}</span>
      )}
    </div>
  )
}

function RetryButton({ onRetry, busy, label = 'Try again' }: { onRetry: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" onClick={onRetry} disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {label}
    </button>
  )
}

/** The one right panel: a shift, a request in one of its modes, or a new request. */
export function CalendarPanel({ ask, view, acting, onAsk, onClose, onChanged }: {
  ask: PanelAsk | null
  view: MyCalendarView | null
  acting: boolean
  onAsk: (ask: PanelAsk | null) => void
  onClose: () => void
  onChanged: () => void
}) {
  const row = ask?.kind === 'request' ? view?.requests.rows.find((r) => r.ref === ask.ref) ?? null : null
  const label = ask?.kind === 'shift' ? 'Shift' : 'Time off'
  const title = !ask ? '' : ask.kind === 'shift' ? shiftPanelTitle(ask.card) : requestPanelTitle(ask)
  const done = () => { onClose(); onChanged() }
  if (ask?.kind === 'request' && row && view && ask.mode === 'detail' && row.status === 'scheduled') {
    return <ApprovedRequest key={row.ref} row={row} person={view.person.name} view={view} acting={acting} onAsk={onAsk}
      onClose={onClose} />
  }
  return (
    <SidePanel open={!!ask} onClose={onClose} label={label} title={title}>
      {ask?.kind === 'shift' && <ShiftBody card={ask.card} head={view?.week.head ?? null} />}
      {ask?.kind === 'add' && view && (
        <AddForm key={`add|${ask.start ?? ''}|${ask.note ?? ''}`} view={view} acting={acting} prefill={ask} onFiled={done} onCancel={onClose} />
      )}
      {ask?.kind === 'request' && !row && (
        <p className="pt-2 text-[12.5px] text-text-3">This request is no longer listed here.</p>
      )}
      {ask?.kind === 'request' && row && view && ask.mode === 'detail' && (
        <RequestDetail row={row} view={view} acting={acting} onAsk={onAsk} />
      )}
      {ask?.kind === 'request' && row && view && ask.mode === 'edit' && (
        <EditForm key={`edit|${row.ref}`} view={view} row={row} acting={acting} onDone={done}
          onOrphan={(next) => { onAsk(next); onChanged() }}
          onCancel={() => onAsk({ kind: 'request', mode: 'detail', ref: row.ref })} />
      )}
      {ask?.kind === 'request' && row && ask.mode === 'withdraw' && (
        <WithdrawForm key={`withdraw|${row.ref}`} row={row} acting={acting} onDone={done}
          onCancel={() => onAsk({ kind: 'request', mode: 'detail', ref: row.ref })} />
      )}
    </SidePanel>
  )
}
