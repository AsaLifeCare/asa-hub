// TIME OFF REQUESTS — the time-off and Request Off asks (sched_flows), new and approved.
// Every row opens the ask whole in the right panel: who, when, where, how it was filed, whom it waits on, what was…
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, CalendarCheck2, Check, ChevronLeft, ChevronRight, FlaskConical, Inbox, Loader2, RefreshCw, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SidePanel from '@/components/shared/SidePanel'
import ApprovedTimeOffPanel, { WaitingPill } from '@/pages/features/timeoff/ApprovedTimeOff'
import type { ApprovedView } from '@/pages/features/timeoff/approvedModel'
import { decisionPress, type DecisionWord } from '@/components/shared/DecisionPanel'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import { askSteps, type Board, type InboxItem } from './schedulingModel'
import { readTimeOffList, useSchedulingRead, type AskSeat, type TimeOffAsk } from './schedulingLane'
import { TEST_MODE_ITEM, useItemAnswers } from './FlowCards'
import { Muted, OUTLINE_BTN, PRIMARY_BTN, StepBar } from './SchedulingParts'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

const CARD = 'overflow-hidden rounded-[16px] border border-border bg-surface shadow-1'
const HEAD = 'hidden gap-x-3 border-b border-border bg-surface-2/60 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3 lg:grid'
const NEW_GRID = 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.45fr)_minmax(0,1.7fr)_minmax(0,0.8fr)_auto]'
const DONE_GRID = 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.45fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_auto]'
const ROW = 'grid cursor-pointer grid-cols-2 items-center gap-x-3 gap-y-1.5 px-4 py-3 text-[13px] text-text-1 outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
const ARMED_BTN = 'flex h-9 items-center justify-center gap-1.5 rounded-md bg-danger px-3 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

/** "Oct 27, 2026" for an ISO day or timestamp. */
export function dateWords(v: string): string {
  if (!v) return '—'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
}

export const askLabel = (a: Pick<TimeOffAsk, 'kind'>) => (a.kind === 'request_off' ? 'Request off' : 'Time off')

const daysWords = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** Where an ask stands, as one pill: Waiting, Approved, or Past once its last day has gone. */
export function askStatus(a: Pick<TimeOffAsk, 'state' | 'ended'>): { label: string; tint: string } {
  if (a.state === 'waiting') return { label: 'Waiting', tint: 'amber' }
  if (a.ended) return { label: 'Past', tint: 'slate' }
  if (a.state === 'approved_future') return { label: 'Approved · later days pending', tint: 'mint' }
  return { label: 'Approved', tint: 'mint' }
}

const SEAT_WORDS: Record<string, string> = { director: 'Director', house_manager: 'House manager', staff: 'Staff' }
const seatWord = (seat: string) => SEAT_WORDS[seat] ?? seat

/** One seat in words: whom it waits on, or who answered and how. */
export function seatLine(s: AskSeat): string {
  const label = seatWord(s.seat)
  const asked = s.asked ?? []
  if (s.state === 'approved') return `${label}: ${s.by || 'somebody'} · Approved${s.why ? ` (${s.why})` : ''}`
  if (s.state === 'declined') return `${label}: ${s.by || 'somebody'} · Declined`
  if (s.state === 'waiting') {
    return `${label}: Waiting${asked.length ? ` on ${asked.slice(0, 3).join(', ')}${asked.length > 3 ? '…' : ''}` : ''}`
  }
  if (s.state === 'skipped') return `${label}: Not needed${s.why ? ` — ${s.why}` : ''}`
  return `${label}: —`
}

/** The seats in words; an ask read before its seats travelled says the director's half from its own state. */
export function seatLines(a: Pick<TimeOffAsk, 'seats' | 'state' | 'decided_by'>): string[] {
  if (a.seats?.length) return a.seats.map(seatLine)
  if (a.state === 'waiting') return ['Director: Waiting']
  return [`Director: ${a.decided_by || 'somebody'} · Approved`]
}

/** What happened to an ask, in order: asked, each answer, and what still waits on a later period. */
export function askHistory(a: TimeOffAsk): { at: string; text: string }[] {
  const out = [{
    at: a.requested_at,
    text: `Asked${a.filed_by ? ` by ${a.filed_by}` : ''}${a.filed_via ? ` · ${a.filed_via}` : ''}`,
  }]
  const answered = (a.seats ?? []).filter((s) => s.state === 'approved' || s.state === 'declined')
  answered.forEach((s) => out.push({
    at: s.at,
    text: `${seatWord(s.seat)}: ${s.state === 'approved' ? 'approved' : 'declined'} by ${s.by || 'somebody'}${s.note ? ` — “${s.note}”` : ''}`,
  }))
  if (!answered.length && a.state !== 'waiting') {
    out.push({ at: a.decided_at, text: `Approved${a.decided_by ? ` by ${a.decided_by}` : ''}` })
  }
  if (a.state === 'approved_future') {
    out.push({ at: '', text: `${a.future_days ? daysWords(a.future_days) : 'The days'} after the last period apply when that period is made` })
  }
  return out
}

/** The ask as the My Work item it is answered through: only its id travels to the door. */
function asItem(a: TimeOffAsk): InboxItem | null {
  if (!a.item) return null
  return {
    id: a.item.id, flow_id: a.id, box: 'work', kind: 'approval', seat: 'director', title: a.item.title, body: a.item.body,
    house_code: a.house_code, house_label: a.house_label, date: a.from, shift_text: a.shift_text, state: 'waiting', link: '',
    test_mode: a.item.test_mode, created_at: a.item.created_at,
  }
}

const testModeOn = (v: string | boolean | undefined) => v === true || ['yes', 'on', 'true'].includes(String(v ?? '').toLowerCase())

type Focus = '' | DecisionWord
type Opened = { id: string; focus: Focus }

export default function TimeOffRequests({ board, tick, onBoardReload, onOpenOwn }: {
  board: Board
  /** moves after a write here, so the lists are read again at once */
  tick: number
  onBoardReload: () => void
  /** one of the viewer's own asks, opened in the panel that can withdraw it */
  onOpenOwn: (flowId: string) => void
}) {
  const [past, setPast] = useState(false)
  const read = useSchedulingRead(`timeoff|${past ? 'past' : 'now'}`, () => readTimeOffList(past), tick)
  const answers = useItemAnswers(() => { read.reload(); onBoardReload() })
  const [opened, setOpened] = useState<Opened | null>(null)
  const data = read.data
  const pending = (data?.pending ?? []).filter((a) => !(a.item && answers.gone.has(a.item.id)))
  const approved = data?.approved ?? []
  // an ask approved here stays open: answered (no answers left) until the next read draws it approved
  const answered = opened ? (data?.pending ?? []).find((a) => a.id === opened.id) : undefined
  const ask = opened ? [...approved, ...pending].find((a) => a.id === opened.id)
    ?? (answered ? { ...answered, item: undefined } : null) : null
  const scope = !data || data.sees_all ? ''
    : board.viewer.editor_of.length ? 'You see your own requests and those of the people at the houses you manage; the directors decide them.'
      : 'You see your own requests; the directors decide them.'
  const open = (a: TimeOffAsk, focus: Focus = '') => setOpened({ id: a.id, focus: a.item ? focus : '' })
  const ownFlow = ask && ask.own && ask.state === 'waiting' && board.mine.some((f) => f.id === ask.id) ? ask.id : ''

  return (
    <div className="grid gap-4" data-time-off-requests="">
      {read.status === 'failed' && (
        <div className={cn('flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-[12.5px] text-danger', DANGER_NOTE)}>
          <span className="flex-1">The requests could not be read — {read.error || 'the server did not answer'}.</span>
          <button type="button" className={OUTLINE_BTN} onClick={read.reload}><RefreshCw size={13} /> Try again</button>
        </div>
      )}
      {read.status === 'ready' && read.error && (
        <p className="text-[12px] text-warning">It could not be read again just now — {read.error}. What is drawn is from before.</p>
      )}
      {scope && <Muted>{scope}</Muted>}

      <section className={CARD} aria-label="New requests" data-new-requests="">
        <header className="flex items-center gap-2 px-4 py-3">
          <Inbox size={16} className="text-text-2" />
          <h2 className="text-[14px] font-semibold text-text-1">New requests</h2>
          {pending.length > 0 && <span className="rounded-full bg-tint-amber px-2 text-[11px] font-semibold text-tint-fg-amber">{pending.length}</span>}
        </header>
        <div className={cn(HEAD, NEW_GRID)}>
          <span>Staff</span><span>From</span><span>To</span><span>Days</span><span>Status</span><span>Requested</span><span className="text-right">Actions</span>
        </div>
        {!data && read.status === 'loading' && <p className="border-t border-border px-4 py-6 text-[13px] text-text-3">Reading the requests…</p>}
        {data && pending.length === 0 && <Empty title="No new requests" body="Nothing is waiting on a director." />}
        <ul className="divide-y divide-border border-t border-border lg:border-t-0">
          {pending.map((a) => (
            <AskRow key={a.id} ask={a} grid={NEW_GRID} selected={opened?.id === a.id} onOpen={() => open(a)}>
              <span className="text-[12px] text-text-3 lg:text-[12.5px]"><span className="lg:hidden">Requested </span>{dateWords(a.requested_at)}</span>
              <span className="col-span-2 flex flex-wrap items-center justify-end gap-2 lg:col-span-1"
                onKeyDown={(e) => e.stopPropagation()}>
                {a.item ? (
                  <>
                    <button type="button" data-act="approve" onClick={(e) => { e.stopPropagation(); open(a, 'approve') }}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-semibold text-on-primary hover:opacity-90">
                      <Check size={13} /> Approve
                    </button>
                    <button type="button" data-act="decline" onClick={(e) => { e.stopPropagation(); open(a, 'decline') }}
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 hover:bg-surface-2">
                      <X size={13} /> Decline
                    </button>
                  </>
                ) : (
                  <Details own={a.own} />
                )}
              </span>
            </AskRow>
          ))}
        </ul>
      </section>

      <section className={CARD} aria-label="Approved requests" data-approved-requests="">
        <header className="flex flex-wrap items-center gap-2 px-4 py-3">
          <CalendarCheck2 size={16} className="text-text-2" />
          <h2 className="text-[14px] font-semibold text-text-1">Approved requests</h2>
          {approved.length > 0 && <span className="rounded-full bg-tint-mint px-2 text-[11px] font-semibold text-tint-fg-mint">{approved.length}</span>}
          <button type="button" role="switch" aria-checked={past} onClick={() => setPast(!past)} data-act="show-past"
            className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-text-2 hover:text-text-1">
            <span aria-hidden className={cn('relative h-5 w-9 rounded-full transition-colors', past ? 'bg-primary' : 'bg-surface-3')}>
              <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-1 transition-all', past ? 'left-[18px]' : 'left-0.5')} />
            </span>
            Show past approved requests
          </button>
        </header>
        <div className={cn(HEAD, DONE_GRID)}>
          <span>Staff</span><span>From</span><span>To</span><span>Days</span><span>Status</span><span>Approved</span><span className="sr-only">Open</span>
        </div>
        {!data && read.status === 'loading' && <p className="border-t border-border px-4 py-6 text-[13px] text-text-3">Reading the requests…</p>}
        {data && approved.length === 0 && (
          <Empty title="No approved requests" body={!past && data.past_hidden
            ? `${data.past_hidden} past approved request${data.past_hidden === 1 ? ' is' : 's are'} hidden.` : 'Nothing approved is coming up.'} />
        )}
        <ul className="divide-y divide-border border-t border-border lg:border-t-0">
          {approved.map((a) => (
            <AskRow key={a.id} ask={a} grid={DONE_GRID} selected={opened?.id === a.id} onOpen={() => open(a)}>
              <span className="text-[12px] text-text-3 lg:text-[12.5px]">
                {a.decided_by ? `${a.decided_by} · ` : ''}{dateWords(a.decided_at)}
              </span>
              <span className="flex justify-end"><Details own={a.own} /></span>
            </AskRow>
          ))}
        </ul>
      </section>

      <AskPanel ask={ask} focus={opened?.focus ?? ''} onClose={() => setOpened(null)}
        busy={Boolean(ask?.item && answers.busy === ask.item.id)}
        refusal={ask?.item ? answers.refused[ask.item.id] ?? '' : ''}
        onAnswer={(word, note) => {
          const item = ask ? asItem(ask) : null
          if (!item) return
          // approved, the approver stays on the panel and sees it approved, as the person does; declined, it closes
          void answers.answer(item, word, note).then((ok) => { if (ok && word !== 'approve') setOpened(null) })
        }}
        onWithdraw={ownFlow ? () => { setOpened(null); onOpenOwn(ownFlow) } : undefined} />
    </div>
  )
}

/** One ask as a row: the whole row opens it, by pointer or by Enter and Space. */
function AskRow({ ask, grid, selected, onOpen, children }: {
  ask: TimeOffAsk
  grid: string
  selected: boolean
  onOpen: () => void
  children: ReactNode
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onOpen()
  }
  return (
    <li data-ask={ask.id}>
      <div role="button" tabIndex={0} aria-label={`${askLabel(ask)} — ${ask.person}, ${dateWords(ask.from)} to ${dateWords(ask.to)}`}
        onClick={onOpen} onKeyDown={onKey} data-open-ask=""
        className={cn(ROW, grid, ask.ended && 'text-text-2', selected && 'bg-tint-primary hover:bg-tint-primary')}>
        <Staff ask={ask} />
        <Dates ask={ask} />
        <Status ask={ask} />
        {children}
      </div>
    </li>
  )
}

function Details({ own }: { own: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary">
      {own ? 'Yours' : 'Details'} <ChevronRight size={14} />
    </span>
  )
}

const housesOf = (ask: TimeOffAsk) => (ask.houses ?? []).map((h) => h.label || h.code).filter(Boolean)

function Staff({ ask }: { ask: TimeOffAsk }) {
  const where = ask.kind === 'request_off'
    ? [ask.house_label, ask.shift_text].filter(Boolean).join(' · ')
    : housesOf(ask).join(', ')
  return (
    <span className="col-span-2 flex min-w-0 items-center gap-2.5 lg:col-span-1">
      <Avatar name={ask.person} size="sm" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{ask.person}</span>
        <span className="block truncate text-[11.5px] text-text-3">
          {askLabel(ask)}{where ? ` · ${where}` : ''}{ask.own ? ' · yours' : ''}
        </span>
      </span>
    </span>
  )
}

function Dates({ ask }: { ask: TimeOffAsk }) {
  return (
    <>
      <span><span className="text-text-3 lg:hidden">From </span>{dateWords(ask.from)}</span>
      <span className="text-right lg:text-left"><span className="text-text-3 lg:hidden">To </span>{dateWords(ask.to)}</span>
      <span className="hidden lg:inline">{ask.days}</span>
    </>
  )
}

function Pill({ ask }: { ask: Pick<TimeOffAsk, 'state' | 'ended'> }) {
  const s = askStatus(ask)
  return (
    <span className={cn('inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold', `bg-tint-${s.tint} text-tint-fg-${s.tint}`)}
      data-status={s.label}>
      {s.label}
    </span>
  )
}

function Status({ ask }: { ask: TimeOffAsk }) {
  return (
    <span className="col-span-2 grid min-w-0 gap-1 lg:col-span-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <Pill ask={ask} />
        <span className="text-[12px] text-text-3 lg:hidden">{daysWords(ask.days)}</span>
      </span>
      {seatLines(ask).map((l) => <span key={l} className="truncate text-[11.5px] text-text-3" title={l}>{l}</span>)}
    </span>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center gap-1 border-t border-border px-4 py-10 text-center lg:border-t-0">
      <p className="text-[14px] font-semibold text-text-1">{title}</p>
      <Muted>{body}</Muted>
    </div>
  )
}

/* ---------- the right panel: one ask, whole ---------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h3>
      <div className="grid gap-1 text-[12.5px] leading-[1.55] text-text-2">{children}</div>
    </section>
  )
}

/** Where it stands, in one sentence. */
function standsLine(ask: TimeOffAsk): string {
  if (ask.state === 'waiting') return ask.item ? 'It waits on your answer; the first director to answer decides.' : 'Waiting on a director; the first answer decides.'
  const by = `${ask.decided_by ? ` by ${ask.decided_by}` : ''}${ask.decided_at ? ` on ${dateWords(ask.decided_at)}` : ''}`
  if (ask.ended) return `Approved${by}; its last day has passed.`
  if (ask.state === 'approved_future') return `Approved${by}. The days after the last period apply when that period is made.`
  return `Approved${by}.`
}

/** Every ask, waiting or approved, opens in the operator's layout; Edit, its approvers' alone, opens the whole ask. */
export const approvedAsk = (a: Pick<TimeOffAsk, 'state'> | null) => Boolean(a && a.state !== 'waiting')
export const laidAsk = (a: Pick<TimeOffAsk, 'kind'> | null) => Boolean(a)

export function askApprovedView(a: TimeOffAsk): ApprovedView {
  return {
    person: a.person, start: a.from, end: a.to, requested: a.requested_at, days: a.days,
    reason: a.reason === undefined ? null : a.reason,
    facts: a.approved ?? null, factsWhy: a.approved ? '' : 'this server does not say yet',
  }
}

export function AskPanel({ ask, focus, onClose, busy, refusal, onAnswer, onWithdraw, edit = false }: {
  ask: TimeOffAsk | null
  /** opened from Approve or Decline: that answer is ready to press */
  focus: Focus
  onClose: () => void
  busy: boolean
  refusal: string
  onAnswer: (word: DecisionWord, note: string) => void
  /** the viewer's own waiting ask: opens the panel that withdraws it */
  onWithdraw?: () => void
  /** opened straight into an approved ask's whole record (its approvers only) */
  edit?: boolean
}) {
  // the ask whose whole record Edit opened; the server's `may_edit` decides, never this state
  const [managing, setManaging] = useState(edit && ask ? ask.id : '')
  const whole = Boolean(ask && managing === ask.id && ask.may_edit)
  if (ask && laidAsk(ask) && !whole) {
    // waiting: its approver answers in the footer; the person on it withdraws there
    const waiting = !approvedAsk(ask)
    const footer = waiting && (ask.item || onWithdraw) ? (
      <div className="grid gap-2">
        {ask.item && (
          <Decide key={`${ask.id}|${focus}`} bare focus={focus} busy={busy} refusal={refusal} onAnswer={onAnswer}
            testMode={testModeOn(ask.item.test_mode) ? TEST_MODE_ITEM : ''} />
        )}
        {onWithdraw && <button type="button" onClick={onWithdraw} className={OUTLINE_BTN} data-act="withdraw">Withdraw…</button>}
      </div>
    ) : undefined
    return <ApprovedTimeOffPanel open view={askApprovedView(ask)} mayEdit={Boolean(ask.may_edit)}
      badge={waiting ? <WaitingPill /> : undefined} footer={footer}
      onEdit={() => setManaging(ask.id)} onClose={onClose} />
  }
  return (
    <SidePanel open={Boolean(ask)} onClose={onClose} label={ask ? askLabel(ask) : 'Time off'}
      title={ask ? `${askLabel(ask)} — ${ask.person}` : ''}
      footer={(
        <div className="flex gap-2">
          {onWithdraw && <button type="button" onClick={onWithdraw} className={cn(OUTLINE_BTN, 'flex-1')} data-act="withdraw">Withdraw…</button>}
          <button type="button" onClick={onClose} className={cn(OUTLINE_BTN, 'flex-1')}>Close</button>
        </div>
      )}>
      {ask && whole && (
        <button type="button" onClick={() => setManaging('')} data-act="back"
          className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary hover:underline">
          <ChevronLeft size={14} /> Back to the request
        </button>
      )}
      {ask && <AskBody key={`${ask.id}|${focus}`} ask={ask} focus={focus} busy={busy} refusal={refusal} onAnswer={onAnswer} />}
    </SidePanel>
  )
}

function AskBody({ ask, focus, busy, refusal, onAnswer }: {
  ask: TimeOffAsk
  focus: Focus
  busy: boolean
  refusal: string
  onAnswer: (word: DecisionWord, note: string) => void
}) {
  const houses = housesOf(ask)
  const facts = [
    { label: 'From', value: dateWords(ask.from) }, { label: 'To', value: dateWords(ask.to) },
    { label: 'Days', value: String(ask.days) },
    { label: ask.kind === 'request_off' ? 'House' : houses.length === 1 ? 'House' : 'Houses',
      value: ask.kind === 'request_off' ? ask.house_label || ask.house_code : houses.join(', ') },
    ...(ask.kind === 'request_off' ? [{ label: 'Shift', value: ask.shift_text }] : []),
    { label: 'Requested', value: dateWords(ask.requested_at) },
    { label: 'Filed', value: [ask.filed_by, ask.filed_via].filter(Boolean).join(' · ') },
  ].filter((f) => f.value)

  return (
    <div data-ask-panel={ask.id}>
      <div className="mt-2 flex items-center gap-2.5">
        <Avatar name={ask.person} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text-1">{ask.person}</p>
          <p className="truncate text-[12px] text-text-3">
            {dateWords(ask.from)}{ask.to !== ask.from ? ` – ${dateWords(ask.to)}` : ''} · {daysWords(ask.days)}
          </p>
        </div>
        <Pill ask={ask} />
      </div>
      <div className="mt-3"><StepBar steps={askSteps({ kind: ask.kind, state: ask.state })} /></div>
      <p className="mt-2 text-[12.5px] text-text-2" data-stands="">{standsLine(ask)}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2 p-3" data-ask-facts="">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{f.label}</dt>
            <dd className="break-words text-[12.5px] leading-[1.5] text-text-1">{f.value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Reason">
        {ask.reason === undefined
          ? <p className="text-text-3">Only the directors and the person who asked read it.</p>
          : <p className="whitespace-pre-line text-text-1">{ask.reason || 'No reason was given.'}</p>}
      </Section>

      {ask.item && (
        <Decide focus={focus} busy={busy} refusal={refusal} onAnswer={onAnswer}
          testMode={testModeOn(ask.item.test_mode) ? TEST_MODE_ITEM : ''} />
      )}

      <Section title="Who approves">
        {seatLines(ask).map((l) => <p key={l}>{l}</p>)}
      </Section>

      <Section title="History">
        {askHistory(ask).map((e, i) => (
          <p key={`${e.text}-${i}`}><span className="text-text-3">{stamp(e.at)}</span> · {e.text}</p>
        ))}
      </Section>

      <Shifts ask={ask} />
    </div>
  )
}

/** A moment as the Ohio clock reads it; a bare day stays a day. */
const stamp = (at: string) => (!at ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(at) ? dateWords(at) : ohioDateTime(at) || at)

const shiftLine = (s: { date: string; house_label: string; text?: string }) =>
  [dateWords(s.date), s.house_label, s.text].filter(Boolean).join(' · ')

/** The shifts on those days: what approving opens, or what approval opened and what is still theirs. */
function Shifts({ ask }: { ask: TimeOffAsk }) {
  const holds = ask.holds ?? []
  const applied = ask.applied ?? []
  if (ask.state === 'waiting') {
    return (
      <Section title={ask.kind === 'request_off' ? 'Their shifts that day' : 'If approved, these go up as open shifts'}>
        {holds.length ? holds.map((s) => <p key={`${s.house_code}|${s.date}|${s.text}`} className="text-text-1">{shiftLine(s)}</p>)
          : <p>None of their shifts on the calendar fall in those days.</p>}
      </Section>
    )
  }
  return (
    <Section title="Shifts on those days">
      {ask.kind === 'request_off'
        ? <p>The shift went up as an open shift when it was approved.</p>
        : applied.length
          ? applied.map((s) => <p key={`${s.house_label}|${s.date}`}>Put up as an open shift: {shiftLine(s)}</p>)
          : <p>No shift of theirs was put up as open when it was approved.</p>}
      {(ask.future_days ?? 0) > 0 && <p>{daysWords(ask.future_days ?? 0)} after the last period apply when that period is made.</p>}
      {holds.map((s) => (
        <p key={`h|${s.house_code}|${s.date}|${s.text}`} className="text-text-1">Still theirs on the calendar: {shiftLine(s)}</p>
      ))}
    </Section>
  )
}

/** Approve sends at once; Decline arms first. Opened from a row's button, that answer is ready and in view. */
function Decide({ focus, busy, refusal, testMode, onAnswer, bare = false }: {
  focus: Focus
  busy: boolean
  refusal: string
  testMode: string
  onAnswer: (word: DecisionWord, note: string) => void
  /** in the operator's layout's footer: no box of its own */
  bare?: boolean
}) {
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState(focus === 'decline')
  const approveBtn = useRef<HTMLButtonElement | null>(null)
  const noTest = useTestWarningsHidden()
  const declineBtn = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!focus) return
    // after the panel has taken focus for its heading
    const t = window.setTimeout(() => {
      const btn = focus === 'approve' ? approveBtn.current : declineBtn.current
      btn?.scrollIntoView?.({ block: 'center' })
      btn?.focus()
    }, 80)
    return () => window.clearTimeout(t)
  }, [focus])

  const press = (word: DecisionWord) => {
    const p = decisionPress(armed, word)
    setArmed(p.armed)
    if (p.send) onAnswer(p.send, note)
  }
  const ring = (word: DecisionWord) => focus === word && 'ring-2 ring-primary ring-offset-1 ring-offset-surface'

  return (
    <section className={bare ? 'grid gap-2' : 'mt-4 grid gap-2 rounded-lg border border-border bg-surface p-3'} data-ask-decide="">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">Your answer</h3>
      {testMode && !noTest && (
        <p className="flex items-start gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning px-2 py-1.5 text-[12px] leading-5 text-text-1">
          <FlaskConical size={13} className="mt-0.5 shrink-0" /> <span>{testMode}</span>
        </p>
      )}
      <textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={2}
        placeholder="Optional — the requester reads it" aria-label="Note with the answer"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
      <div className="flex flex-wrap items-center gap-2">
        <button ref={approveBtn} type="button" className={cn(PRIMARY_BTN, ring('approve'))} disabled={busy} data-press="approve"
          onClick={() => press('approve')}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
        </button>
        <button ref={declineBtn} type="button" className={cn(armed ? ARMED_BTN : OUTLINE_BTN, ring('decline'))} disabled={busy}
          data-press="decline" data-armed={armed ? '' : undefined} onClick={() => press('decline')}>
          <X size={13} /> {armed ? 'Decline — press again' : 'Decline'}
        </button>
        {armed && !busy && (
          <button type="button" onClick={() => setArmed(false)} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>
        )}
      </div>
      {refusal && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-5 text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{refusal}</span>
        </p>
      )}
    </section>
  )
}
