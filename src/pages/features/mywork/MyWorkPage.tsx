// MY WORK · Actions & Requests — what is asked of the person, and what they have asked.
// Whose rows these are is the relay's decision (/hub-lanes/my-work): the signed-in account's own, or everyone's for…
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Loader2, RefreshCw, Send } from 'lucide-react'
import AppHero from '@/components/shared/AppHero'
import DecisionPanel from '@/components/shared/DecisionPanel'
import EmptyState from '@/components/shared/EmptyState'
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import type { HeroRead } from '@/lib/appHero'
import { badgeAllowsApp, roleWordCounts, useBadgeAccessStore } from '@/lib/badgeAccess'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { useFeatureAllowed } from '@/lib/featureAccess'
import { ohioTime } from '@/lib/ohio'
import { keptWords } from '@/components/FreshnessStamp'
import { useStampsHidden } from '@/lib/stamps'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import {
  DUE_TONE_CLASS, STATUS_PILL, actionCell, choiceAfter, dayWords, decidePayload, decideToast, decisionView, emptyWords,
  forUsersLine, heroFiguresOf, hiddenOf, hiddenResolved, landed, personWords, readHeaderHidden, readShowResolved,
  refWords, saveHeaderHidden, saveShowResolved, seatRefOf, sentenceCase, shownRequests, statusLabel, timeOffRefOf,
  timeOffRequestRef, unanswered,
  visibleActions, visibleRequests, visibleSourceLines, TIME_OFF_MESSAGE_FEATURE, timeOffMessageRef, timeOffMessageToast,
  type ActionCell, type ActionRow, type DecideAction, type DecideAnswer, type DecideWord, type Detail, type HideParts, type MyWorkView,
  type RequestRow, type SourceHead, type TimeOffMessageAnswer, type TimeOffOutcome,
} from './myWorkModel'
import SeatPanel from '@/pages/features/supportdesk/SeatPanel'
import { act as timeOffAct } from '@/pages/features/timeoff/useTimeOff'
import TimeOffPanel from '@/pages/features/timeoff/TimeOffPanel'
import { STATUS_LABEL as TIME_OFF_STATUS } from '@/pages/features/timeoff/timeOffModel'
import UploadAssetSheet, { type UploadAsk } from './UploadAssetSheet'
import IstBookPanel from './IstBookPanel'
import { FamilyWorkPage } from './FamilyWork'
import { useMyWork, type MyWorkState } from './useMyWork'
import { useShellHides } from '@/lib/myWorkHides'

export const VISIT_SENTENCE = "My Work shows the signed-in account's own work — close the visit to see it."

const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const MOBILE_LABEL = 'mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3 sm:hidden'
const PILL_BUTTON = 'inline-flex h-8 items-center whitespace-nowrap rounded-full border border-primary px-3.5 text-[12.5px] font-medium text-text-1 transition-colors hover:bg-primary/5'
// the column templates are whole literals so the stylesheet keeps them
const ACTION_COLS = 'sm:grid-cols-[112px_minmax(180px,2fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(150px,1.1fr)_32px]'
const ACTION_COLS_MASS = 'sm:grid-cols-[minmax(120px,1fr)_112px_minmax(180px,2fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(150px,1.1fr)_32px]'
const REQUEST_COLS = 'sm:grid-cols-[96px_150px_minmax(200px,2fr)_120px_32px]'
const REQUEST_COLS_MASS = 'sm:grid-cols-[minmax(120px,1fr)_96px_150px_minmax(200px,2fr)_120px_32px]'
const LINE_TONE = { danger: 'text-[var(--danger)]', warning: 'text-[var(--warning)]', muted: 'text-text-3' } as const
const SEND_APPROVED = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const SEND_NOT_APPROVED = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-danger px-3 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

/** Everything the page holds. An open member visit reads nothing: the door answers the session's own account. */
export function useMyWorkPage() {
  const signedIn = useAuthStore((s) => !!s.user)
  // the session's own account: what the header remembers is kept under it
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  const eff = useEffectiveUser()
  const visiting = !!eff?.visiting
  const [person, setPerson] = useState('')
  const { state, refresh } = useMyWork(signedIn && !visiting, person)
  // a person the door now refuses as out of scope is let go, and the change reads the door again
  const kept = choiceAfter(state, person)
  useEffect(() => {
    if (kept !== person) setPerson(kept)
  }, [kept, person])
  const rules = useBadgeAccessStore((s) => s.rules)
  const opens = useCallback((appId: string) => !!appId && badgeAllowsApp(appId, eff, rules), [eff, rules])
  return { visiting, person, setPerson, state, refresh, opens, accountId }
}

/** A client-role account, and an SSA or a FAMILY whatever its role says (roleWordCounts), reads its own client's
 *  view; everyone else, the staff board. */
export default function MyWorkPage() {
  const eff = useEffectiveUser()
  if (eff?.visiting) return <VisitNotice />
  return eff?.role === 'client' || !roleWordCounts(eff) ? <FamilyWorkPage /> : <StaffWorkPage />
}

function StaffWorkPage() {
  const { visiting, person, setPerson, state, refresh, opens, accountId } = useMyWorkPage()
  const [ask, setAsk] = useState<UploadAsk | null>(null)
  if (visiting) return <VisitNotice />
  return (
    <>
      <MyWorkScreen state={state} person={person} onPerson={setPerson} onRetry={() => void refresh()}
        opens={opens} onUpload={setAsk} accountId={accountId} />
      <UploadAssetSheet ask={ask} onClose={() => setAsk(null)} />
    </>
  )
}

export function VisitNotice() {
  return (
    <div className="w-full pb-16">
      <EmptyState title="My Work" body={VISIT_SENTENCE} />
    </div>
  )
}

function heroRead(state: MyWorkState): HeroRead {
  if (state.data) return { state: 'ready' }
  if (state.status === 'failed') return { state: 'failed', reason: state.error }
  return { state: 'loading' }
}

export function MyWorkScreen({ state, person, onPerson, onRetry, opens, onUpload, accountId = '' }: {
  state: MyWorkState
  person: string
  onPerson: (key: string) => void
  onRetry: () => void
  opens: (appId: string) => boolean
  onUpload: (ask: UploadAsk) => void
  /** the session's own account; no account, nothing remembered */
  accountId?: string
}) {
  const view = state.data
  const mass = view?.scope.mode === 'mass'
  const hidden = hiddenOf(view)
  // before the first read the header follows this account's last one, so a hidden header does not flash
  const headerHiddenBefore = useMemo(() => readHeaderHidden(accountId), [accountId])
  const stampsHidden = useStampsHidden()
  const headerHidden = view ? hidden.header : headerHiddenBefore
  useEffect(() => {
    if (view) saveHeaderHidden(accountId, hidden.header)
  }, [view, hidden.header, accountId])
  const chosen = mass && view?.scope.person
    ? (view.scope.people ?? []).find((p) => p.key === view.scope.person)?.name || view.scope.person : ''
  if (state.status === 'refused') {
    return (
      <div className="w-full pb-16">
        <EmptyState title={state.reason === 'visit' ? 'My Work' : 'My Work is not open here'} body={state.error} />
      </div>
    )
  }
  const sentence = view ? [view.scope.why, sentenceCase(view.me.key_why), ...(view.me.notes ?? []).map(sentenceCase),
    state.kept ? keptWords(state.readAt) : state.readAt && !stampsHidden ? `Read ${ohioTime(new Date(state.readAt))}` : '',
  ].filter(Boolean).join(' · ') : ''
  const forUsers = forUsersLine(view)
  return (
    <div className="w-full pb-16">
      {headerHidden ? (
        <HeaderlessRead state={state} onRetry={onRetry} />
      ) : (
        <AppHero
          eyebrow={`My Work · Actions & Requests${mass ? ` · ${chosen || 'Everyone'}` : ''}`}
          label="My Work"
          read={heroRead(state)}
          figures={heroFiguresOf(view)}
          reading="Reading your actions and requests…"
          failed="My Work could not be read, so these figures are unknown."
          sentence={sentence || undefined}
          onRetry={onRetry}
        />
      )}

      {forUsers && <p className="mb-4 text-[12px] leading-[1.5] text-text-3" data-for-users>{forUsers}</p>}

      {view && state.status === 'failed' && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--warning)]">
          The last refresh failed: {state.error || 'no answer'}. The rows below are from the read before.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      )}

      {mass && view && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="text-[12.5px] font-semibold text-text-2" htmlFor="my-work-person">Person</label>
          <select id="my-work-person" value={person} onChange={(e) => onPerson(e.target.value)}
            className="h-9 max-w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary">
            <option value="">All people</option>
            {(view.scope.people ?? []).map((p) => (
              <option key={p.key} value={p.key}>{p.name} · {p.open_actions} actions · {p.open_requests} open</option>
            ))}
          </select>
          <RetryButton onRetry={onRetry} busy={state.refreshing} label="Refresh" />
        </div>
      )}

      {view && (
        <>
          <ActionsCard view={view} mass={mass} opens={opens} onUpload={onUpload} />
          <RequestsCard view={view} mass={mass} opens={opens} />
        </>
      )}
    </div>
  )
}

/** With the header hidden, the read in flight or the read that failed is still said — plainly, without figures. */
function HeaderlessRead({ state, onRetry }: { state: MyWorkState; onRetry: () => void }) {
  if (state.data) return null
  if (state.status === 'failed') {
    return (
      <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]">
        My Work could not be read: {state.error || 'no answer'}.
        <RetryButton onRetry={onRetry} busy={state.refreshing} />
      </p>
    )
  }
  return (
    <p className="mb-4 flex items-center gap-2 text-[12.5px] text-text-3">
      <Loader2 size={14} className="animate-spin" /> Reading your actions and requests…
    </p>
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

function Card({ title, extra, sources, hidden, note, empty, children }: {
  title: string
  extra?: ReactNode
  sources: SourceHead[]
  hidden: HideParts
  note: string
  empty: string
  children: ReactNode
}) {
  const lines = visibleSourceLines(sources, hidden)
  return (
    <section aria-label={title} className="mb-5 rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
        {extra}
      </div>
      {lines.length > 0 && (
        <ul className="mb-3 space-y-1">
          {lines.map((l) => <li key={l.key} className={cn('text-[12px] leading-[1.5]', LINE_TONE[l.tone])}>{l.text}</li>)}
        </ul>
      )}
      {note && <p className="mb-3 text-[12px] text-[var(--warning)]">{note}</p>}
      <div className="overflow-x-auto">{children}</div>
      {empty && <p className="py-6 text-center text-[13px] text-text-3">{empty}</p>}
    </section>
  )
}

function Chevron({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
      <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
  )
}

export function DetailsPanel({ details, extra }: { details: Detail[]; extra?: ReactNode }) {
  return (
    <div className="col-span-full mt-2 rounded-md bg-surface-2 px-4 py-3">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {details.map((d, i) => (
          <div key={`${d.label}-${i}`} className="min-w-0">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{d.label}</dt>
            <dd className="break-words text-[12.5px] leading-[1.5] text-text-1">{d.value}</dd>
          </div>
        ))}
      </dl>
      {extra}
    </div>
  )
}

function useOpenRows() {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  return { open, toggle }
}

function PersonCell({ row }: { row: { person?: { key: string; name: string } } }) {
  const p = personWords(row.person)
  return (
    <div className="min-w-0">
      <span className={MOBILE_LABEL}>Person</span>
      <span className="text-[13px] font-medium text-text-1" title={p.why || undefined}>{p.text}</span>
      {p.why && <span className="block text-[11.5px] text-text-3">{p.why}</span>}
    </div>
  )
}

/** A time off half decided through Time Off's own door: the server picks the half and refuses in words (a "not
 * approved" with no note is refused, since the words go to the person). */
async function timeOffAnswer(ref: string, word: DecideWord, note: string): Promise<DecideAnswer> {
  const row = await timeOffAct(word === 'approve' ? 'approve' : 'deny', ref, { note })
  return { ok: true, changed: true, said: `${ref} — ${TIME_OFF_STATUS[String(row?.status ?? '')] ?? String(row?.status ?? '')}` }
}

// Approve / Decline on an item answered in the page (Scheduling's): the row leaves at once, the server's sentence…
export function useDecide() {
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({})
  const decide = useCallback(async (rowId: string, itemId: string, word: DecideWord, note: string,
    action: DecideAction = 'schedulingAnswer'): Promise<boolean> => {
    setAnswered((s) => new Set(s).add(rowId))
    setRefused((r) => {
      if (!(rowId in r)) return r
      const n = { ...r }
      delete n[rowId]
      return n
    })
    try {
      // a write: never re-sent on a garbled answer, or a second "Already answered" would read as somebody else's…
      const payload = decidePayload(itemId, word, note)
      const got = action === 'timeOffDecide'
        ? await timeOffAnswer(itemId, word, payload.note)
        : action === 'vehicleCalendarAnswer'
          ? await gasAction<DecideAnswer>('vehicleCalendarAnswer', payload, { retry: false })
          : action === 'employeeLoanAnswer'
            ? await gasAction<DecideAnswer>('employeeLoanAnswer', payload, { retry: false })
            : action === 'myWorkIstApprove'
              ? await gasAction<DecideAnswer>('myWorkIstApprove', payload, { retry: false })
              : await gasAction<DecideAnswer>('schedulingAnswer', payload, { retry: false })
      toast(decideToast(word, got))
      return true
    } catch (e) {
      const said = e instanceof Error && e.message ? e.message : 'Try again.'
      setAnswered((s) => {
        const n = new Set(s)
        n.delete(rowId)
        return n
      })
      setRefused((r) => ({ ...r, [rowId]: said }))
      toast({ type: 'danger', title: 'Not answered', body: said })
      return false
    }
  }, [])
  /** a row answered in its own panel (a redirected support request) leaves the list the same way */
  const settle = useCallback((rowId: string) => setAnswered((s) => new Set(s).add(rowId)), [])
  return { answered, refused, decide, settle }
}

/** A decision is never made in the row: the row says so and opens the right panel, where Approve and Decline are. */
export function DecideCell({ cell, onOpen }: {
  cell: Extract<ActionCell, { kind: 'decide' }>
  onOpen: () => void
}) {
  return (
    <button type="button" className={PILL_BUTTON} data-decide-open={cell.itemId}
      onClick={(e) => { e.stopPropagation(); onOpen() }}>
      Open
    </button>
  )
}

/** The decision panel of one My Work row: its facts, then Approve / Decline (Decline pressed twice). */
export function DecideRowPanel({ row, onClose, busy, refusal, opens, onAnswer }: {
  row: ActionRow | null
  onClose: () => void
  busy: boolean
  refusal: string
  opens: (appId: string) => boolean
  onAnswer: (row: ActionRow, word: DecideWord, note: string) => void
}) {
  const cell = row ? actionCell(row, opens) : null
  const v = row ? decisionView(row) : null
  const link = row?.action?.href && opens(row.action.app) ? row.action.href : ''
  return (
    <DecisionPanel open={Boolean(row && cell?.kind === 'decide')} onClose={onClose} itemKey={row?.id}
      label="Approval" title={v?.title ?? ''} whoLine={v?.phase}
      facts={v?.facts ?? []} body={v?.body} testMode={v?.testMode} busy={busy} refusal={refusal}
      approveLabel={cell?.kind === 'decide' ? cell.approve : 'Approve'} declineLabel={cell?.kind === 'decide' ? cell.decline : 'Decline'}
      extra={link ? <Link to={link} className={cn(PILL_BUTTON, 'mt-3')} data-href={link}>
        {row?.action?.app === 'vehicle-calendar' ? 'Open in Transportation' : 'Open in Scheduling'}</Link> : null}
      onAnswer={(word, note) => { if (row) onAnswer(row, word, note) }} />
  )
}

export function ActionsCard({ view, mass, opens, onUpload, initiallyOpen, initiallyDeciding }: {
  view: MyWorkView
  mass: boolean
  opens: (appId: string) => boolean
  onUpload: (ask: UploadAsk) => void
  initiallyOpen?: string[]
  /** a decide row whose panel is open on the first draw */
  initiallyDeciding?: string
}) {
  const { open, toggle } = useOpenRows()
  const { answered, refused, decide, settle } = useDecide()
  const [deciding, setDeciding] = useState<ActionRow | null>(
    () => (initiallyDeciding ? view.actions.rows.find((r) => r.id === initiallyDeciding) ?? null : null))
  const [sending, setSending] = useState(false)
  // a Client training (IST) row booked in its panel: the row says it was sent until the next read redraws it
  const [booking, setBooking] = useState<ActionRow | null>(null)
  const [booked, setBooked] = useState<Readonly<Record<string, string>>>({})
  const bookCell = booking ? actionCell(booking, opens) : null
  const hidden = hiddenOf(view)
  const rows = unanswered(visibleActions(view.actions.rows, hidden), answered)
  const isOpen = (id: string) => open.has(id) || !!initiallyOpen?.includes(id)
  const cols = mass ? ACTION_COLS_MASS : ACTION_COLS
  // a redirected support request opens Support Requests' own panel, with its four answers
  const seatRef = seatRefOf(deciding, deciding ? actionCell(deciding, opens) : null)
  // a time off opens here in the operator's layout, decided in its footer and drawn approved once it is — never a
  // visit to Time Off
  const timeOffRef = timeOffRefOf(deciding, deciding ? actionCell(deciding, opens) : null)
  const answer = (row: ActionRow, word: DecideWord, note: string) => {
    const cell = actionCell(row, opens)
    if (cell.kind !== 'decide' || cell.action === 'supportDeskDecide' || sending) return
    setSending(true)
    void decide(row.id, cell.itemId, word, note, cell.action).then((ok) => {
      setSending(false)
      if (ok) setDeciding(null)
    })
  }
  return (
    <Card title={mass ? 'Actions' : 'My Actions'} sources={view.actions.sources} hidden={hidden} note={view.actions.note}
      empty={rows.length ? '' : emptyWords('actions', view.actions.sources, mass)}>
      {rows.length > 0 && (
        <div className="min-w-0">
          <div className={cn('hidden gap-4 border-b border-border pb-2 sm:grid', cols, HEAD)}>
            {mass && <span>Person</span>}
            <span>Due date</span><span>Condition</span><span>Flow</span><span>Phase</span><span>Action</span><span />
          </div>
          {rows.map((r) => (
            <ActionLine key={r.id} row={r} mass={mass} cols={cols} opens={opens} onUpload={onUpload}
              onDecide={() => setDeciding(r)} deciding={deciding?.id === r.id}
              onBook={() => setBooking(r)} booked={booked[r.id]}
              open={isOpen(r.id)} onToggle={() => toggle(r.id)} />
          ))}
        </div>
      )}
      <IstBookPanel item={bookCell?.kind === 'book' ? bookCell.item : null} onClose={() => setBooking(null)}
        onSent={(said) => {
          if (booking) setBooked((b) => ({ ...b, [booking.id]: said }))
          setBooking(null)
        }} />
      <DecideRowPanel row={seatRef || timeOffRef ? null : deciding} onClose={() => setDeciding(null)} busy={sending} opens={opens}
        refusal={deciding ? refused[deciding.id] ?? '' : ''} onAnswer={answer} />
      {timeOffRef && (
        <TimeOffPanel key={timeOffRef} refId={timeOffRef} focus="" onClose={() => setDeciding(null)}
          onChanged={() => { if (deciding) settle(deciding.id) }} />
      )}
      <SeatPanel open={Boolean(seatRef)} requestRef={seatRef} title={deciding?.condition ?? ''} onClose={() => setDeciding(null)}
        onAnswered={() => { if (deciding) settle(deciding.id); setDeciding(null) }} />
    </Card>
  )
}

// A Time off approval row tells its person the outcome through Smart Comms; nothing is decided in Time Off.
export function TimeOffMessage({ row }: { row: ActionRow }) {
  const allowed = useFeatureAllowed(TIME_OFF_MESSAGE_FEATURE)
  // Settings › My Work keeps the two buttons to the master's own session unless its switch shows them
  const hidden = useShellHides().time_off_messages
  const ref = timeOffMessageRef(row)
  const [busy, setBusy] = useState<TimeOffOutcome | ''>('')
  const [said, setSaid] = useState('')
  if (!allowed || hidden || !ref) return null
  const send = async (outcome: TimeOffOutcome) => {
    if (busy) return
    setBusy(outcome)
    try {
      // a write: never re-sent on a garbled answer, or the person could be told twice
      const got = await gasAction<TimeOffMessageAnswer>('myWorkTimeOffMessage', { ref, outcome }, { retry: false })
      setSaid(got.said)
      toast(timeOffMessageToast(got))
    } catch (e) {
      const why = e instanceof Error && e.message ? e.message : 'Try again.'
      setSaid(why)
      toast({ type: 'danger', title: 'Message not sent', body: why })
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3" data-time-off-message={ref}>
      <button type="button" className={SEND_APPROVED} disabled={Boolean(busy)} data-outcome="approved"
        onClick={() => void send('approved')}>
        {busy === 'approved' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send Message Approved
      </button>
      <button type="button" className={SEND_NOT_APPROVED} disabled={Boolean(busy)} data-outcome="not_approved"
        onClick={() => void send('not_approved')}>
        {busy === 'not_approved' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send Message Not Approved
      </button>
      {said && <p role="status" className="w-full text-[12px] leading-5 text-text-2" data-time-off-said="">{said}</p>}
    </div>
  )
}

function ActionLine({ row, mass, cols, opens, onUpload, onDecide, deciding, onBook, booked, open, onToggle }: {
  row: ActionRow
  mass: boolean
  cols: string
  opens: (appId: string) => boolean
  onUpload: (ask: UploadAsk) => void
  /** a decide row: opens its decision panel */
  onDecide: () => void
  deciding: boolean
  /** a Client training row: opens its booking panel */
  onBook?: () => void
  /** what a Send in that panel said, until the next read */
  booked?: string
  open: boolean
  onToggle: () => void
}) {
  const sent = actionCell(row, opens)
  const cell: ActionCell = sent.kind === 'book' && booked ? { kind: 'words', text: booked } : sent
  const decides = cell.kind === 'decide'
  return (
    <div className={cn('grid grid-cols-1 gap-2 border-b border-border py-3 sm:items-center sm:gap-4', cols,
      decides && 'cursor-pointer hover:bg-surface-2', deciding && 'bg-surface-2')}
      data-row={row.id} onClick={decides ? onDecide : undefined}>
      {mass && <PersonCell row={row} />}
      <div>
        <span className={MOBILE_LABEL}>Due date</span>
        {row.due ? (
          <span className={cn('text-[12.5px] font-medium', row.due_tone ? DUE_TONE_CLASS[row.due_tone] : 'text-text-2')}>
            {dayWords(row.due)}
          </span>
        ) : (
          <span className="text-[12.5px] text-text-2" title={row.due_why}>
            —<span className="block text-[11px] leading-[1.4] text-text-3">{row.due_why}</span>
          </span>
        )}
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Condition</span>
        <span className="text-[13px] font-medium text-text-1">{row.condition}</span>
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Flow</span>
        <span className="text-[12.5px] text-text-2">{row.flow}</span>
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Phase</span>
        <span className="text-[12.5px] text-text-2">{row.phase}</span>
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Action</span>
        {cell.kind === 'link' && <Link to={cell.href} className={PILL_BUTTON} data-href={cell.href}>{cell.label}</Link>}
        {cell.kind === 'upload' && (
          <button type="button" className={PILL_BUTTON} data-upload={cell.certs.join('|')}
            onClick={() => onUpload({ certs: cell.certs, uploadFor: cell.uploadFor })}>
            {cell.label}
          </button>
        )}
        {cell.kind === 'decide' && <DecideCell cell={cell} onOpen={onDecide} />}
        {cell.kind === 'book' && (
          <button type="button" className={PILL_BUTTON} data-ist-open={cell.item.id} onClick={() => onBook?.()}>
            {cell.label}
          </button>
        )}
        {cell.kind === 'words' && <span className="text-[12px] leading-[1.45] text-text-3">{cell.text}</span>}
      </div>
      <div className="flex justify-end" onClick={decides ? (e) => e.stopPropagation() : undefined}>
        <Chevron open={open} onToggle={onToggle} />
      </div>
      {open && <DetailsPanel details={row.details} extra={<TimeOffMessage row={row} />} />}
    </div>
  )
}

export function RequestsCard({ view, mass, opens, initiallyOpen, initiallyShowResolved }: {
  view: MyWorkView
  mass: boolean
  opens: (appId: string) => boolean
  initiallyOpen?: string[]
  initiallyShowResolved?: boolean
}) {
  const { open, toggle } = useOpenRows()
  const [showResolved, setShowResolved] = useState<boolean>(() => initiallyShowResolved ?? readShowResolved())
  // a time off opens here, in the operator's layout
  const [timeOffRef, setTimeOffRef] = useState('')
  const hidden = hiddenOf(view)
  // with concluded requests hidden there is nothing to show on request, and no control to ask with
  const all = visibleRequests(view.requests.rows, hidden)
  const rows = hidden.completed ? all : shownRequests(all, showResolved)
  const resolved = hiddenResolved(all)
  const isOpen = (id: string) => open.has(id) || !!initiallyOpen?.includes(id)
  const cols = mass ? REQUEST_COLS_MASS : REQUEST_COLS
  const flip = (on: boolean) => {
    setShowResolved(on)
    saveShowResolved(on)
  }
  const empty = rows.length ? '' : (all.length ? '' : emptyWords('requests', view.requests.sources, mass, hidden.completed))
  return (
    <Card
      title={mass ? 'Requests' : 'My Requests'}
      sources={view.requests.sources}
      hidden={hidden}
      note={view.requests.note}
      empty={empty}
      extra={hidden.completed ? undefined : (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-text-2">
          <input type="checkbox" checked={showResolved} onChange={(e) => flip(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary" />
          Show resolved ({resolved})
        </label>
      )}
    >
      {rows.length > 0 && (
        <div className="min-w-0">
          <div className={cn('hidden gap-4 border-b border-border pb-2 sm:grid', cols, HEAD)}>
            {mass && <span>Person</span>}
            <span>Status</span><span>Request ID</span><span>Request</span><span>Submitted</span><span />
          </div>
          {rows.map((r) => (
            <RequestLine key={r.id} row={r} mass={mass} cols={cols} opens={opens} open={isOpen(r.id)}
              onToggle={() => toggle(r.id)} onOpenTimeOff={setTimeOffRef} />
          ))}
        </div>
      )}
      {timeOffRef && (
        <TimeOffPanel key={timeOffRef} refId={timeOffRef} focus="" onClose={() => setTimeOffRef('')} onChanged={() => {}} />
      )}
      {!rows.length && all.length > 0 && (
        <p className="py-6 text-center text-[13px] text-text-3">
          {view.requests.sources.every(landed) ? 'Every request on record is resolved' : 'Every request that could be read is resolved'}
          {' '}— tick Show resolved to see {all.length === 1 ? 'it' : 'them'}.
        </p>
      )}
    </Card>
  )
}

function RequestLine({ row, mass, cols, opens, open, onToggle, onOpenTimeOff }: {
  row: RequestRow
  mass: boolean
  cols: string
  opens: (appId: string) => boolean
  open: boolean
  onToggle: () => void
  /** a time off row opens its panel here, never in Time Off */
  onOpenTimeOff?: (ref: string) => void
}) {
  const timeOff = onOpenTimeOff ? timeOffRequestRef(row) : ''
  // a time off row never links into Time Off: it opens here, or not at all
  const link = row.link && row.link.app !== 'timeoff' && opens(row.link.app) ? row.link : null
  const word = row.status.class === 'open' && row.status.word && row.status.word !== 'Open' ? row.status.word : ''
  const ref = refWords(row)
  return (
    <div className={cn('grid grid-cols-1 gap-2 border-b border-border py-3 sm:items-center sm:gap-4', cols)} data-row={row.id}>
      {mass && <PersonCell row={row} />}
      <div>
        <span className={MOBILE_LABEL}>Status</span>
        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_PILL[row.status.class])}
          data-status={row.status.class}>
          {statusLabel(row.status)}
        </span>
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Request ID</span>
        {ref.why ? (
          <span className="text-[12.5px] text-text-2" title={ref.why}>
            —<span className="block text-[11px] leading-[1.4] text-text-3">{ref.why}</span>
          </span>
        ) : (
          <span className="break-all font-mono text-[12.5px] text-text-1">{ref.text}</span>
        )}
      </div>
      <div className="min-w-0">
        <span className={MOBILE_LABEL}>Request</span>
        <span className="text-[13px] font-medium text-text-1">{row.request}</span>
        {word && <span className="block text-[11.5px] text-text-3">{word}</span>}
      </div>
      <div>
        <span className={MOBILE_LABEL}>Submitted</span>
        {row.submitted ? (
          <span className="text-[12.5px] text-text-2">{dayWords(row.submitted)}</span>
        ) : (
          <span className="text-[12.5px] text-text-2" title={row.submitted_why}>
            —<span className="block text-[11px] leading-[1.4] text-text-3">{row.submitted_why}</span>
          </span>
        )}
      </div>
      <div className="flex justify-end">
        <Chevron open={open} onToggle={onToggle} />
      </div>
      {open && (
        <DetailsPanel details={row.details} extra={timeOff ? (
          <button type="button" className={cn(PILL_BUTTON, 'mt-3')} data-time-off-open={timeOff}
            onClick={() => onOpenTimeOff?.(timeOff)}>Open</button>
        ) : link ? (
          <Link to={link.href} className={cn(PILL_BUTTON, 'mt-3')}>{link.label}</Link>
        ) : null} />
      )}
    </div>
  )
}
