// One calendar cell and its consequences, on House Calendars (`operations`, "Shift · live") and the Builder…
// Writes nothing itself; who may act is the relay's answer (`mayEdit`, openAction).
import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRightLeft, CalendarCog, Clock, GraduationCap, Hand, Inbox, Lock, MapPin,
  Moon, PhoneOff, Undo2, X,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import ConfirmDialog from '@/features/ops-flows/ConfirmDialog'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { ohioTime } from '@/lib/ohio'
import { callOffConfirmBody } from '@/pages/features/calendarbuilder/builderLogic'
import { dayWords } from '@/pages/features/timeoff/timeOffModel'
import type { CalledOff, CellFact, Computed, OpenShift } from './houseCalTypes'
import {
  KIND_LABEL, conflictsFor, handoffAt, hhmm, houseShort, notAPerson, openAction, sameName, weekKeyOf,
} from './houseCalTypes'
import { timeOffMarkOf, type TimeOffFeed } from './timeOffMarks'
import { useClockTimes } from './clockPref'
import { clockText } from './cellClock'
import { ABOVE_ALL, ABOVE_ONE, approveBlockedBy, countdown, shiftStateLabel, type HandoffView } from './requestsLogic'
import type { PublishedMark } from './publishedMark'
import PublishedNote from './PublishedNote'
import RehearsalMark from './RehearsalMark'
import TrainingNote from './TrainingNote'
import TransferPicker from './TransferPicker'
import HandoffCard from './HandoffCard'

/** `ref` lets the panel follow a pooled shift across re-reads. */
export type PanelTarget = { employee: string; colIso: string; label: string; ref?: string }

export default function ShiftCellPanel({
  target, house, text, fact, computed, saving, openShift, staff,
  mayEdit, openRow, me, calledOff, callOffLine,
  onClaim, onOpenRequests, onClose,
  onApplyFor = () => {}, onWithdraw = () => {}, onShowRef = () => {},
  handoffs, onTransferred = () => {}, onHandoffAct = () => {},
  mode = 'operations', editor, onEditInBuilder, onOpenLive, estateWeek, timeOff, onOpenTimeOff,
  published, publishedWhy, onCallOff, callOffSaid, testMode, drafted, transferWaiting, transfersWhy,
}: {
  target: PanelTarget | null
  house: string
  /** the cell exactly as it reads now */
  text: string
  fact: CellFact | undefined
  computed: Computed | null
  saving: boolean
  /** set when this cell is a shift nobody is working */
  openShift?: OpenShift
  /** the PEOPLE on this grid — the desk may place any of them (never an OPEN row) */
  staff: string[]
  /** the relay's answer: may this reader change this house's calendar */
  mayEdit: boolean
  /** is the clicked row an OPEN row — the relay's word, not the name's */
  openRow: boolean
  /** this reader's own roster name, so their own shift can be offered */
  me: string
  /** the caller's own cell, only for readers told who called off */
  calledOff?: CalledOff
  /** the clicked row is the relay's drawn 'OPEN · call-off' line */
  callOffLine?: boolean
  onClaim: (shift: OpenShift, forWhom?: string) => void
  onOpenRequests: () => void
  onClose: () => void
  /** a member of staff applies for the open shift (posts its handle) */
  onApplyFor?: (shift: OpenShift) => void
  /** they take their application back */
  onWithdraw?: (requestId: string) => void
  /** move the panel to the pooled shift a handle names (the red cell) */
  onShowRef?: (ref: string) => void
  /** grid.handoffs */
  handoffs?: HandoffView[]
  /** a transfer was offered from this panel */
  onTransferred?: (offer: HandoffView) => void
  /** accept / pass / approve / not approve (yes|no), or withdraw, a transfer */
  onHandoffAct?: (h: HandoffView, act: 'yes' | 'no' | 'withdraw') => void
  /** which screen the panel is on — see the header */
  mode?: 'operations' | 'builder'
  /** the Builder's editor block, drawn where the cell is changed */
  editor?: ReactNode
  /** House Calendars: open this house and day in Calendar Builder */
  onEditInBuilder?: () => void
  /** the Builder: open this shift in Live, where it is given or answered (the view switch, keeping the ref) */
  onOpenLive?: () => void
  /** the Builder: this person's hours this week at EVERY house, drafts on */
  estateWeek?: number
  /** time off over this cell's day, as the relay laid it on the grid */
  timeOff?: TimeOffFeed
  /** open that request in the Time Off app */
  onOpenTimeOff?: (ref: string) => void
  /** how the cell got here: its last publish, as the relay marks it */
  published?: PublishedMark
  /** set when the marks could not be read, so a missing one is not read as "never published" */
  publishedWhy?: string
  /** the house's editor, either view: Mark call-off, a live act that happens on confirm (with the reason) */
  onCallOff?: (note: string) => void
  /** the call-off door's refusal on this cell, in its words (`draft_pending` offers the Builder) */
  callOffSaid?: { code: string; why: string } | null
  /** test mode as the relay read it: 'on' says the mock outbox, 'unreadable' says the messages may go out */
  testMode?: boolean | 'on' | 'unreadable' | null
  /** the Builder: this cell carries a draft, which is published or undone before a call-off is marked */
  drafted?: boolean
  /** the Builder: a transfer waiting on this shift (GET /shift-handoff), answered in Live first */
  transferWaiting?: HandoffView
  /** the Builder: why the transfers could not be read, so none drawn is not read as none waiting */
  transfersWhy?: string
}) {
  /** The Transfer picker is open on this cell. */
  const [transferring, setTransferring] = useState(false)
  /** The Time switch. It spells out what the cell SAYS; the code stays the code. */
  const clock = useClockTimes()
  const builder = mode === 'builder'
  /** a phone: the panel rises from the bottom, 90% of the screen, with a handle */
  const phone = useMediaQuery('(max-width: 639px)')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const person = computed?.people.find((p) => p.employee === target?.employee)
  const week = target ? weekKeyOf(target.colIso) : ''
  const weekHours = person?.by_week?.[week]
  const overLine = computed?.weekly_ot_hours ?? 40
  const overWeek = Boolean(computed && weekHours && weekHours > overLine)
  const overAll = Boolean(estateWeek && estateWeek > overLine)
  const mine = target && computed ? conflictsFor(computed, target.employee, target.colIso) : []
  /** own shift: anybody may transfer it; another's: only the house's editor (`from_staff`) */
  const own = sameName(target?.employee, me)
  const canOffer = !builder && (mayEdit || own)
  /** A transfer already waiting on this cell — drawn instead of a new one. */
  const cellHandoff = target ? handoffAt(handoffs, target.employee, target.colIso) : undefined
  /** a call-off's line is not a workbook row and is never printed as one */
  const calledOffShift = openShift?.kind_of_open === 'call_off'
  /** a call-off line cell whose shift is gone */
  const goneLine = Boolean(callOffLine) && !openShift
  // keyed by the shift, so a pick never carries over to the next cell
  const [pickedFor, setPickedFor] = useState('')
  const cellId = target ? `${target.employee}|${target.colIso}` : ''
  if (pickedFor !== cellId) {
    setPickedFor(cellId)
    setTransferring(false)
  }

  // the window ticks while open
  const [nowMs, setNowMs] = useState(() => Date.now())
  const ticking = Boolean(openShift && !openShift.claimed_by && openShift.pool_state === 'open'
    && openShift.window?.closes_at)
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])

  /** Mark call-off, in either view: a person's shift with hours still ahead, no draft and no transfer on it */
  const liveNow = mayEdit && onCallOff && target && fact && fact.start != null && fact.state !== 'past'
    && !openRow && !callOffLine && !openShift && !calledOff && !drafted && !cellHandoff && !transferWaiting
    && !notAPerson(target.employee, house)
    ? (
      <LiveNowBox key={cellId} employee={target.employee} text={text} saving={saving}
        testMode={testMode} said={callOffSaid ?? null} onEditInBuilder={builder ? undefined : onEditInBuilder}
        onCallOff={onCallOff} />
    ) : null

  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }} onClick={onClose}
            className="fixed inset-0 z-30 bg-black/25 xl:hidden"
          />
          <motion.aside
            initial={phone ? { y: '100%' } : { x: 400 }} animate={phone ? { y: 0 } : { x: 0 }}
            exit={phone ? { y: '100%' } : { x: 400 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            aria-label="Shift panel"
            className={cn('fixed z-30 flex flex-col border-t-[3px] border-border bg-bg shadow-3',
              phone ? 'max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[90vh] max-sm:rounded-t-[16px]'
                : 'bottom-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] w-full border-l sm:w-[384px]',
              builder ? 'border-t-warning' : 'border-t-success')}
          >
            {phone && <span aria-hidden className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-text-3/40" />}
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <span className={cn('text-[11px] font-semibold uppercase tracking-[0.08em]',
                builder ? 'text-warning' : 'text-success')}>
                {builder ? 'Shift · draft' : 'Shift · live'}
              </span>
              <button onClick={onClose} aria-label="Close shift panel"
                className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
                <X size={15} />
              </button>
            </div>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex items-center gap-3">
                {!openRow && <Avatar name={target.employee} size="md" />}
                <div className="min-w-0">
                  <p className="clamp-1 text-[14px] font-semibold text-text-1">
                    {openRow ? 'Open shift' : target.employee}
                  </p>
                  <p className="clamp-1 text-[12px] text-text-3">
                    {house}
                    {calledOffShift ? ' · somebody called off' : openRow ? ` · row ${target.employee}` : ''}
                  </p>
                </div>
              </div>

              <p className="mt-4 text-[12px] font-semibold text-text-2">{target.label}</p>

              {/* a state timeOffMarks does not know draws nothing here either */}
              {timeOff && timeOffMarkOf(timeOff) && !openRow && (
                <div className={cn('mt-3 rounded-lg p-3 text-[12.5px] leading-5 text-text-1',
                  timeOff.state === 'scheduled' ? 'border border-[#8b0000]/40 bg-[#8b0000]/5'
                    : 'border border-dashed border-violet-500 bg-violet-500/5')}>
                  <p className={cn('text-[12px] font-semibold uppercase tracking-[0.06em]',
                    timeOff.state === 'scheduled' ? 'text-[#8b0000]' : 'text-text-2')}>
                    {timeOff.state === 'scheduled' ? 'On approved time off' : 'Time off asked'}
                  </p>
                  <p className="mt-1">
                    {timeOff.state === 'scheduled'
                      ? `${target.employee} is on approved time off until ${dayWords(timeOff.until ?? '')} (${timeOff.ref}) — no shift can be given to them this day.`
                      : `${target.employee} asked for time off until ${dayWords(timeOff.until ?? '')} (${timeOff.ref}), still waiting for approval — a draft here is allowed, and warned.`}
                  </p>
                  {onOpenTimeOff && timeOff.ref && (
                    <button type="button" onClick={() => onOpenTimeOff(timeOff.ref ?? '')}
                      className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2">
                      Open in Time Off
                    </button>
                  )}
                </div>
              )}

              {/* the caller's own cell (editors only): where the called-off shift went */}
              {calledOff && !openShift && (
                <div className="mt-3 rounded-lg border border-[#8b0000]/40 bg-[#8b0000]/5 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8b0000]">
                    <PhoneOff size={12} /> Called off
                  </p>
                  <p className="mt-1 text-[12.5px] leading-5 text-text-1">
                    {target.employee} called off {calledOff.value || 'this shift'}.{' '}
                    {calledOff.filled_by
                      ? <>It was given to <span className="font-semibold">{calledOff.filled_by}</span>.</>
                      : 'It waits on its red cell on the call-off line, where it is applied for and given.'}
                  </p>
                  {calledOff.ref && !builder && (
                    <button onClick={() => onShowRef(calledOff.ref)}
                      className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-[#8b0000]/40 bg-surface px-3 text-[12px] font-semibold text-[#8b0000] hover:bg-[#8b0000]/10">
                      Open the red cell
                    </button>
                  )}
                </div>
              )}

              {/* an open shift first; on the Builder it points back to Live */}
              {openShift && !builder && (
                <OpenShiftBlock
                  key={openShift.ref || openShift.key}
                  shift={openShift} mayEdit={mayEdit} saving={saving} staff={staff} me={me}
                  house={house} day={target.label} nowMs={nowMs}
                  onClaim={onClaim} onApplyFor={onApplyFor} onWithdraw={onWithdraw}
                  onOpenRequests={onOpenRequests}
                />
              )}
              {builder && (openShift || calledOff) && onOpenLive && (
                <div className="mt-3 rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8b0000]">
                    {openShift?.claimed_by ? `Taken by ${openShift.claimed_by}` : calledOff ? 'Called off' : 'Open shift'}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-text-2">
                    Applied for and given in Live, where the applicants and your decision are — never
                    edited over here.
                  </p>
                  <button onClick={onOpenLive}
                    className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-[#8b0000]/40 bg-surface px-3 text-[12px] font-semibold text-[#8b0000] hover:bg-[#8b0000]/10">
                    Open it in Live
                  </button>
                </div>
              )}
              {/* the Builder carries the transfers too: one waiting on this shift is answered in Live first */}
              {builder && transferWaiting && (
                <div aria-label="Transfer waiting" className="mt-3 rounded-lg border-2 border-info bg-tint-info p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-info">
                    <ArrowRightLeft size={12} /> Transfer waiting
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-text-1">
                    A transfer is waiting on this shift: answer it in Live first.
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-4 text-text-3">
                    {transferWaiting.from_staff} offers {transferWaiting.value || 'it'} to {transferWaiting.to_staff}.
                  </p>
                  {onOpenLive && (
                    <button onClick={onOpenLive}
                      className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-info bg-surface px-3 text-[12px] font-semibold text-info hover:bg-tint-info">
                      Open it in Live
                    </button>
                  )}
                </div>
              )}
              {builder && !transferWaiting && transfersWhy && fact && (
                <p className="mt-3 text-[11.5px] leading-4 text-text-3">
                  The transfers waiting here could not be read ({transfersWhy}) — this is not saying none are waiting.
                </p>
              )}

              {/* WHAT THE CELL MEANS — read through the same grammar the slices
                  use, so the panel and the Shift Board cannot disagree. */}
              <div className="mt-2 rounded-lg border border-border bg-surface p-3">
                {fact ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-tint-primary px-2 py-0.5 text-[11px] font-semibold text-text-1">
                        {KIND_LABEL[fact.kind] ?? fact.kind}
                      </span>
                      {fact.overnight && (
                        <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">
                          <Moon size={11} /> crosses midnight
                        </span>
                      )}
                      {fact.state === 'in_progress' && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          <Clock size={11} /> running now
                        </span>
                      )}
                      {fact.transfer && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">
                          at {fact.token}
                        </span>
                      )}
                    </div>
                    {fact.start != null && fact.end != null ? (
                      <p className="mt-2 text-[13px] text-text-1">
                        {hhmm(fact.start)} – {hhmm(fact.end)}
                        <span className="text-text-3"> · {fact.hours}h</span>
                      </p>
                    ) : (
                      // No hours in this cell — a house token, a meeting, a med run.
                      <p className="mt-2 text-[13px] text-text-2">
                        {clock ? clockText(fact.code) : fact.code}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-text-3">Nothing rostered.</p>
                )}
                {/* HOW IT GOT HERE — the cell's last publish, as the relay marks it */}
                {published ? (
                  <div className="mt-2">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">How it got here</p>
                    <PublishedNote mark={published} />
                  </div>
                ) : publishedWhy && fact ? (
                  <p className="mt-2 text-[11px] leading-4 text-text-3">
                    How this cell got here is not known right now: {publishedWhy}.
                  </p>
                ) : null}
              </div>

              {/* THE CONSEQUENCE. The number the desk is really deciding about. */}
              {person && (
                <div className={cn('mt-3 grid gap-2', estateWeek !== undefined ? 'grid-cols-3' : 'grid-cols-2')}>
                  <div className={cn('rounded-lg border p-3',
                    overWeek ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface')}>
                    <p className="text-[11px] uppercase tracking-[0.06em] text-text-3">{week || 'Week'}</p>
                    <p className={cn('text-[17px] font-semibold', overWeek ? 'text-danger' : 'text-text-1')}>
                      {weekHours ? `${weekHours}h` : '—'}
                    </p>
                  </div>
                  {estateWeek !== undefined && (
                    <div className={cn('rounded-lg border p-3',
                      overAll ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface')}>
                      <p className="text-[11px] uppercase tracking-[0.06em] text-text-3">Every house</p>
                      <p className={cn('text-[17px] font-semibold', overAll ? 'text-danger' : 'text-text-1')}>
                        {estateWeek ? `${estateWeek}h` : '—'}
                      </p>
                    </div>
                  )}
                  <div className="rounded-lg border border-border bg-surface p-3">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-text-3">Here, total</p>
                    <p className="text-[17px] font-semibold text-text-1">{person.hours}h</p>
                  </div>
                </div>
              )}

              {mine.length > 0 && (
                <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
                  {mine.map((c, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-[12px] leading-5 text-danger">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {c.why}
                    </p>
                  ))}
                </div>
              )}

              {/* a transfer waiting on this cell */}
              {!builder && cellHandoff && (
                <HandoffCard h={cellHandoff} busy={saving} className="mt-3" tone="info"
                  onAnswer={(h, word) => onHandoffAct(h, word)}
                  onWithdraw={(h) => onHandoffAct(h, 'withdraw')} />
              )}
              {/* transfer: only a shift that has not started */}
              {!builder && !cellHandoff && fact && !openShift && !openRow && fact.start != null
                && canOffer && fact.state !== 'in_progress' && fact.state !== 'past' && (
                transferring ? (
                  <TransferPicker location={house} colIso={target.colIso} dayLabel={target.label}
                    fromStaff={own ? '' : target.employee}
                    onOffered={(offer) => { setTransferring(false); onTransferred(offer) }}
                    onCancel={() => setTransferring(false)} />
                ) : (
                  <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                    <button onClick={() => setTransferring(true)} disabled={saving}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface disabled:opacity-50">
                      <ArrowRightLeft size={14} /> Transfer this shift
                    </button>
                    <p className="mt-1.5 text-[11px] leading-4 text-text-3">
                      {own ? 'Pick who takes it' : `Pick who takes ${target.employee.split(' ')[0]}'s shift`} —
                      they accept, and the house manager approves ({ABOVE_ONE} when
                      the house manager is part of it). The calendar does not change until both say yes.
                    </p>
                  </div>
                )
              )}

              {/* LIVE NOW — a call-off is not a draft: the house's editor marks it here, and it happens on confirm */}
              {!builder && liveNow}

              {/* the calendar is changed in the Builder only; there the live act sits apart, below the draft's buttons */}
              {builder ? <>{editor}{liveNow}</> : goneLine ? (
                <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-5 text-text-3">
                  <Lock size={12} className="mt-1 shrink-0" />
                  This called-off shift is no longer open here — it was given back, or it has passed.
                </p>
              ) : openShift || (openRow && text.trim()) ? (
                <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-5 text-text-3">
                  <Lock size={12} className="mt-1 shrink-0" />
                  An open shift is not typed over or cleared — it leaves the calendar only when somebody is assigned to it.
                </p>
              ) : mayEdit ? (
                <div className="mt-4 rounded-lg border border-border bg-surface p-3">
                  <p className="text-[12px] leading-5 text-text-2">
                    The calendar is changed in <span className="font-semibold">Calendar Builder → Builder</span>,
                    as a draft you publish for the house — then every screen and reminder has it.
                  </p>
                  {onEditInBuilder && (
                    <button onClick={onEditInBuilder}
                      className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90">
                      <CalendarCog size={14} /> Change it in Builder
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-5 text-text-3">
                  <Lock size={12} className="mt-1 shrink-0" />
                  Read-only — only this house&apos;s manager, and {ABOVE_ALL}, change its calendar.
                </p>
              )}
            </div>

            <div className={cn('flex gap-2 border-t border-border p-3', phone && 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]')}>
              <button onClick={onClose}
                className="h-9 flex-1 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 hover:bg-surface-2">
                Close
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/** Mark call-off, apart from everything that is a draft: every effect is named before it happens. */
function LiveNowBox({ employee, text, saving, testMode, said, onEditInBuilder, onCallOff }: {
  employee: string
  text: string
  saving: boolean
  testMode?: boolean | 'on' | 'unreadable' | null
  said: { code: string; why: string } | null
  onEditInBuilder?: () => void
  onCallOff: (note: string) => void
}) {
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const drafted = said?.code === 'draft_pending'
  return (
    <div aria-label="Live now" className="mt-3 rounded-lg border-2 border-danger p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-danger">Live now</p>
      <p className="mt-1 text-[12px] leading-5 text-text-2">
        A call-off is not a draft: it happens the moment you confirm. It opens the shift, sends the URGENT OPEN
        SHIFT to all staff and files the Call Off Tracker row.
      </p>
      <label className="mt-2 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        The reason, for the directors&apos; group only
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="Why they called off"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
      </label>
      {said && (
        <p className="mt-2 text-[12px] leading-5 text-danger">
          {drafted ? 'This cell has a draft in the Builder: publish or discard it first.' : said.why}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" disabled={saving} onClick={() => setAsking(true)}
          className="flex h-9 items-center gap-1.5 rounded-md border border-danger bg-surface px-3 text-[12.5px] font-semibold text-danger hover:bg-tint-danger disabled:opacity-50">
          <PhoneOff size={13} /> Mark call-off
          <span className="rounded-[6px] bg-tint-danger px-1.5 text-[10px] tracking-[0.05em]">LIVE: happens now</span>
        </button>
        {drafted && onEditInBuilder && (
          <button type="button" onClick={onEditInBuilder}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
            <CalendarCog size={13} /> Open it in Builder
          </button>
        )}
      </div>
      <ConfirmDialog
        open={asking}
        title="Mark this shift called off?"
        body={callOffConfirmBody(employee, text, testMode)}
        confirmLabel="Mark called off"
        busyLabel="Working…"
        cancelLabel="Keep it"
        busy={saving}
        onCancel={() => setAsking(false)}
        onConfirm={() => { setAsking(false); onCallOff(note.trim()) }}
      />
    </div>
  )
}

/** One open shift and this reader's one act on it (houseCalTypes.openAction); the door re-checks all of it. */
function OpenShiftBlock({
  shift, mayEdit, saving, staff, me, house, day, nowMs,
  onClaim, onApplyFor, onWithdraw, onOpenRequests,
}: {
  shift: OpenShift
  mayEdit: boolean
  saving: boolean
  staff: string[]
  me: string
  house: string
  day: string
  nowMs: number
  onClaim: (shift: OpenShift, forWhom?: string) => void
  onApplyFor: (shift: OpenShift) => void
  onWithdraw: (requestId: string) => void
  onOpenRequests: () => void
}) {
  const [placing, setPlacing] = useState('')
  const act = openAction(shift, mayEdit)
  const calledOff = shift.kind_of_open === 'call_off'
  const windowOpen = shift.pool_state === 'open' && !shift.claimed_by && !shift.started
  const closesAt = shift.window?.closes_at ?? ''
  const left = windowOpen && closesAt ? countdown(closesAt, nowMs) : null
  const street = shift.address ?? ''
  const applicants = shift.applicant_list ?? []
  const others = [me, ...staff].filter((n, i, all) => n && all.indexOf(n) === i
    && !applicants.some((a) => sameName(a.person, n)))

  const title = act.kind === 'taken' ? 'Taken'
    : act.kind === 'started' ? 'Started · nobody is on it'
      : shift.pool_state ? shiftStateLabel(shift.pool_state, shift.window)
        : 'Open shift · nobody is on this'

  return (
    <div className="mt-3 rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 p-3">
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8b0000]">{title}</p>

      {/* THE SHIFT — the same facts the URGENT OPEN SHIFT text carries. */}
      <div className="mt-2 grid gap-1 text-[12.5px] text-text-1">
        <p className="font-semibold">{houseShort(house)} · {day}</p>
        <p className="flex items-center gap-1.5">
          <Clock size={12} className="text-text-3" />
          {shift.start != null && shift.end != null
            ? <>{hhmm(shift.start)} – {hhmm(shift.end)}<span className="text-text-3"> · {shift.hours}h{shift.overnight ? ' · overnight' : ''}</span></>
            : shift.code || shift.raw}
        </p>
        {street && (
          <p className="flex items-start gap-1.5 text-text-2">
            <MapPin size={12} className="mt-1 shrink-0 text-text-3" /> {street}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[11.5px] text-text-3">
          {calledOff && <PhoneOff size={11} />}
          {calledOff
            ? (shift.called_off_by ? <>Called off by <span className="font-medium text-text-2">{shift.called_off_by}</span></> : 'A shift somebody called off')
            : 'An open shift on this house\'s calendar'}
        </p>
      </div>

      {windowOpen && (
        <p className={cn('mt-2 flex items-center gap-1.5 text-[11.5px] leading-4',
          left?.urgent ? 'font-semibold text-[#8b0000]' : 'text-text-2')}>
          <Clock size={11} />
          Applications close at {ohioTime(closesAt)}{left && left.seconds > 0 ? ` · ${left.label} left` : ''}
        </p>
      )}
      {shift.window?.why && act.kind !== 'taken' && (
        <p className="mt-1 text-[11px] leading-4 text-text-3">
          {shift.window.why}
          {typeof shift.applicants === 'number' && shift.applicants > 0 && !mayEdit
            && ` · ${shift.applicants} applied so far`}
        </p>
      )}

      {act.kind === 'taken' && (
        <p className="mt-2 text-[13px] text-text-1">
          <span className="font-semibold">{act.by}</span>
          {act.how && <span className="text-text-3"> · {act.how}</span>}
        </p>
      )}

      {act.kind === 'started' && (
        <p className="mt-2 text-[12px] leading-5 text-text-2">
          This shift has already begun, so it is no longer taken or assigned here —
          covering it now is a call from the house manager.
        </p>
      )}

      {act.kind === 'assign' && (
        <div className="mt-2.5">
          {applicants.length > 0 ? (
            <>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Applied · earliest first
              </p>
              <ul className="mt-1 grid gap-1.5">
                {applicants.map((a) => {
                  // disabled when the trainer is working then; the door refuses it
                  const blocked = approveBlockedBy(a)
                  return (
                  <li key={a.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5">
                    <Avatar name={a.person} size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-[12.5px] font-medium text-text-1">{a.person}</span>
                      <span className="clamp-1 block text-[11px] text-text-3">
                        {a.week_hours}h that week · applied {ohioTime(a.at)}
                        {a.via && a.via !== 'app' ? ` · by ${a.via}` : ''}
                      </span>
                      <RehearsalMark on={a.rehearsal} words className="mt-0.5" />
                      {(a.ist_ok === false || a.state === 'needs_training_approval') && (
                        <span className="mt-0.5 flex items-start gap-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                          <GraduationCap size={11} className="mt-0.5 shrink-0" />
                          No IST for this house — choosing them takes the training on.
                        </span>
                      )}
                      <TrainingNote training={a.training} className="mt-0.5" />
                    </span>
                    <button disabled={saving || Boolean(blocked) || windowOpen}
                      title={blocked || (windowOpen ? `Applications are open until ${ohioTime(closesAt)} — the decision is yours when they close` : undefined)}
                      onClick={() => onClaim(shift, a.person)}
                      className="h-8 shrink-0 rounded-md bg-[#8b0000] px-2.5 text-[12px] font-semibold text-white hover:bg-[#a50f0f] disabled:opacity-50">
                      Give it to {a.person.split(' ')[0]}
                    </button>
                  </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="text-[12px] text-text-2">
              {windowOpen ? 'Nobody has applied yet.' : 'Nobody applied.'}
            </p>
          )}
          <label className="mt-2.5 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
            {applicants.length ? 'Or assign somebody who did not apply' : 'Assign somebody'}
          </label>
          <select
            value={placing}
            onChange={(e) => setPlacing(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-[12px] text-text-1 outline-none focus:border-primary"
          >
            <option value="">Pick somebody…</option>
            {others.map((n) => <option key={n} value={n}>{n === me ? `Me — ${n}` : n}</option>)}
          </select>
          <button
            disabled={!placing || saving || shift.pool_state === 'filled' || windowOpen}
            onClick={() => onClaim(shift, placing)}
            className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[#8b0000] text-[13px] font-semibold text-white transition-all hover:bg-[#a50f0f] disabled:opacity-50"
          >
            <Hand size={14} /> {placing ? `Assign ${placing}` : 'Assign this shift'}
          </button>
          <p className="mt-1.5 text-[11px] leading-4 text-text-3">
            This is the house manager's decision: it marks anybody else who applied as not chosen,
            and goes on Calendar Builder → Requests with your name on it.
            {/* no decision inside the window */}
            {windowOpen && ` Applications are still open until ${ohioTime(closesAt)} — the decision is yours when they close.`}
          </p>
          <TrainingNote training={shift.training} className="mt-1.5"
            lead="Somebody with no IST for this house is a first shift here, which is a training:" />
        </div>
      )}

      {act.kind === 'apply' && (
        <div className="mt-2.5">
          {act.training && (
            <p className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11.5px] leading-4 text-amber-800 dark:text-amber-300">
              <GraduationCap size={12} className="mt-0.5 shrink-0" />
              <span>
                {act.training}. Your application becomes a training approval for the house
                manager first — your place in line is kept.
              </span>
            </p>
          )}
          {act.training && <TrainingNote training={shift.training} className="mb-2" />}
          <button
            disabled={saving}
            onClick={() => onApplyFor(shift)}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[#8b0000] text-[13px] font-semibold text-white transition-all hover:bg-[#a50f0f] disabled:opacity-50"
          >
            <Hand size={14} /> {saving ? 'Applying…' : 'Apply for this shift'}
          </button>
          <p className="mt-1.5 text-[11px] leading-4 text-text-3">
            Applying puts your name down — the shift is not yours yet. This house's manager
            decides {closesAt ? `when applications close at ${ohioTime(closesAt)}` : 'who takes it'}.
          </p>
        </div>
      )}

      {act.kind === 'applied' && (
        <div className="mt-2.5">
          <p className="text-[12.5px] leading-5 text-text-1">
            <span className="font-semibold">You applied.</span>{' '}
            {shift.mine?.state === 'needs_training_approval'
              ? 'It waits on the house manager to take the training on first.'
              : 'The house manager decides when applications close.'}
          </p>
          <TrainingNote training={shift.training} className="mt-1" />
          <button
            disabled={saving || !act.requestId}
            onClick={() => onWithdraw(act.requestId)}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50"
          >
            <Undo2 size={13} /> Withdraw my application
          </button>
        </div>
      )}

      {act.kind === 'blocked' && (
        <p className="mt-2.5 text-[12px] leading-5 text-text-2">
          <span className="font-semibold text-text-1">Not open to you now</span> — {act.why}
        </p>
      )}

      {!mayEdit && (
        <button onClick={onOpenRequests}
          className="mt-2.5 flex items-center gap-1 text-[11.5px] font-semibold text-[#8b0000] hover:underline">
          <Inbox size={12} /> Everything you applied for is on Calendar Builder → Requests
        </button>
      )}
    </div>
  )
}
