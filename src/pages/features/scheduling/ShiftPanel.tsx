// The right panel a cell opens.
// Your own shift: Request Off, Call Off, Swap and Time off (Request Off and Time off need the notice days); the
// Employee field asks somebody else to take it, through the swap's approvals; an editor's gives it to another of the
// house's staff at once (one write, the holder's cell cleared with it).
import { useState, type ReactNode } from 'react'
import { ArrowLeftRight, CalendarOff, CalendarX2, GraduationCap, Hand, Loader2, PhoneOff, UserCheck } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { hhmm } from '@/pages/features/shifts/houseCalTypes'
import { cellText } from '@/pages/features/shifts/cellClock'
import { AMBER_NOTE, DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import {
  SWAP_ASK_STAFF, cellMinutes, clashFor, editsHouse, editsHouseOwn, exchangeLine, flowLabel, flowSteps, freePeople, hmOrAbove,
  houseLabel, isPendingRefusal, istMissingAt, mayAskAhead, mayWithdraw, noticeLine, openLabel, panelMode, pendingFlowLine,
  sameHouseText, swapsAnybody, trainingTitle, trainingWaiting, withdrawable, type Board, type Person, type WriteAnswer,
} from './schedulingModel'
import {
  callOff, prefsReasonOf, proposeSwap, requestOff, saidOf, saveCell, takeShift, undoLast, withdrawFlow,
} from './schedulingLane'
import ShiftForm, { dayChoices, type FormSave } from './ShiftForm'
import { FreePicker } from './SwapPanel'
import type { SwapPreset } from './SwapShiftsPanel'
import {
  AREA, FIELD, LABEL, Muted, OUTLINE_BTN, PRIMARY_BTN, PrefsOverride, Refusal, StepBar, TrainingPickNote, TwoPress,
} from './SchedulingParts'
import type { CellTarget } from './SchedulingGrid'

const STATE_WORDS: Record<string, string> = {
  open: 'Open — nobody holds this shift yet.',
  called_off: 'Called off — the shift is on an OPEN row at the top.',
  requested_off: 'Requested off — the shift is on an OPEN row at the top.',
  time_off: 'Time off.',
  swapped_out: 'Swapped to somebody else.',
  swap_in: 'Swapped in.',
  taken: 'Taken from OPEN.',
  training: 'Training — no IST at this house yet: this shift is worked with the house manager, not as the DSP, and is not counted as coverage.',
}

const first = (name: string) => name.split(' ')[0] || name

// The Employee field as a swap: the holder first, then whoever is free for the shift (an account, no clash, not
// already at the house that day); picking one asks them through the swap's own approvals, nothing changes yet.
function EmployeeSwap({ board, house, iso, span, holderKey, holderName, below, busy, onGive, children }: {
  board: Board
  house: string
  iso: string
  span: [number, number] | null
  holderKey: string
  holderName: string
  /** below a house manager: the question is asked in words before anything is sent */
  below: boolean
  busy: boolean
  onGive: (p: Person) => void
  /** the refusal and the Staff Preferences override, said under the question */
  children?: ReactNode
}) {
  const [picked, setPicked] = useState<Person | null>(null)
  const { free } = freePeople(board, iso, span, { except: holderKey, house, needsAccount: true })
  return (
    <div data-employee-swap="">
      <select value={picked?.key ?? holderKey} onChange={(ev) => setPicked(free.find((p) => p.key === ev.target.value) ?? null)}
        className={FIELD} aria-label="Employee — pick somebody to swap this shift to" disabled={busy}>
        <option value={holderKey}>{holderName}</option>
        {free.map((p) => (
          <option key={p.key} value={p.key}>{p.name}{istMissingAt(board, house, p.key) ? ' — training (no IST here)' : ''}</option>
        ))}
      </select>
      {picked && istMissingAt(board, house, picked.key) && <TrainingPickNote />}
      {picked && (
        <div className={cn('mt-2 rounded-md px-2 py-1.5 text-[12px] font-normal normal-case leading-5 tracking-normal text-text-1', AMBER_NOTE)}
          data-swap-confirm={below ? 'staff' : 'editor'}>
          <p>
            {below ? SWAP_ASK_STAFF
              : `Swap this shift to ${picked.name}? ${first(picked.name)} is notified to accept it, then the house manager and a director approve it. Nothing changes until then.`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => onGive(picked)} className={PRIMARY_BTN} data-act="give">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowLeftRight size={13} />}
              {below ? 'Yes, send it' : `Ask ${first(picked.name)}`}
            </button>
            <button type="button" disabled={busy} onClick={() => setPicked(null)} className="text-[12px] text-text-3 hover:text-text-1">
              Not now
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

/** Who, when and the hours of a shift, read as the editor's form lays them out. */
function ShiftFacts({ personName, dayLabel, span, code, employee }: {
  personName: string
  dayLabel: string
  span: [number, number] | null
  code: string
  employee?: ReactNode
}) {
  const box = 'mt-1 flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-2'
  return (
    <div className="mt-3 grid grid-cols-2 gap-2" data-shift-facts="">
      <div className={cn(LABEL, 'col-span-2')}>
        Employee
        {employee ?? <span className={box}>{personName}</span>}
      </div>
      <div className={cn(LABEL, 'col-span-2')}>
        Date
        <span className={box}>{dayLabel}</span>
      </div>
      {span ? (
        <>
          <div className={LABEL}>Start<span className={box}>{hhmm(span[0] / 60)}</span></div>
          <div className={LABEL}>End<span className={box}>{hhmm(span[1] / 60)}{span[1] > 1440 ? ' (next day)' : ''}</span></div>
        </>
      ) : (
        <div className={cn(LABEL, 'col-span-2')}>Shift<span className={box}>{code || 'Nothing on this day'}</span></div>
      )}
    </div>
  )
}

/** Where a training stands, for whoever is shown its flow (the trainee and the house's editors). */
const TRAINING_FLOW_WORDS: Record<string, string> = {
  waiting: 'Waiting on the house manager and a director: both approve; one decline takes the person off and opens the shift at the top.',
  approved: 'Approved by the house manager and a director: the training stands.',
  expired: 'The shift ended before both answered; it stood as a training.',
}

export default function ShiftPanel({ board, house, target, assignKey, hours, clock, onClose, onWrite, onTimeOff, onSwap }: {
  board: Board
  house: string
  target: CellTarget | null
  /** an OPEN shift dropped on somebody's row: Assign opens with them picked */
  assignKey?: string
  hours: boolean
  clock: boolean
  onClose: () => void
  /** a write answered: laid over the board, its sentence said; `close` when the panel's work is done */
  onWrite: (answer: WriteAnswer, close: boolean) => void
  onTimeOff: (from: string) => void
  /** Swap opens the Swap shifts panel with this shift picked first */
  onSwap: (shift: SwapPreset) => void
}) {
  const grid = board.grids[house]
  const row = target ? grid?.rows.find((r) => r.row_id === target.rowId) : undefined
  const ci = target && grid ? grid.cols.findIndex((c) => c.iso === target.iso) : -1
  const col = ci >= 0 ? grid?.cols[ci] : undefined
  const open = Boolean(target && grid && row && col)
  return (
    <SidePanel open={open} onClose={onClose} label="Shift"
      title={<span className="sr-only">{row ? (row.kind === 'open' ? openLabel(row.row_id) : row.name) : 'Shift'}</span>}
      footer={<button type="button" onClick={onClose} className={cn(OUTLINE_BTN, 'w-full')}>Close</button>}>
      {open && target && grid && row && col && (
        <ShiftBody key={`${house}|${target.rowId}|${target.iso}|${assignKey ?? ''}`} board={board} house={house} rowId={row.row_id}
          iso={col.iso} assignKey={assignKey} hours={hours} clock={clock} onWrite={onWrite} onTimeOff={onTimeOff} onSwap={onSwap} />
      )}
    </SidePanel>
  )
}

function ShiftBody({ board, house, rowId, iso, assignKey, hours, clock, onWrite, onTimeOff, onSwap }: {
  board: Board
  house: string
  rowId: string
  iso: string
  assignKey?: string
  hours: boolean
  clock: boolean
  onWrite: (answer: WriteAnswer, close: boolean) => void
  onTimeOff: (from: string) => void
  onSwap: (shift: SwapPreset) => void
}) {
  const grid = board.grids[house]
  const row = grid.rows.find((r) => r.row_id === rowId)!
  const ci = grid.cols.findIndex((c) => c.iso === iso)
  const col = grid.cols[ci]
  const cell = row.cells[ci] ?? null
  const editor = editsHouse(board, house)
  // the house's own editors; a calendar edition alone edits cells and people, never a flow Apps Script answers
  const ownEditor = editsHouseOwn(board, house)
  const mode = panelMode({ row, cell, editor, date: iso, today: board.today })
  const span = cellMinutes(cell)
  const at = { house, row_id: rowId, date: iso }
  const dayLabel = `${col.weekday} ${col.short}`.trim()
  const flow = cell?.flow ? board.mine.find((f) => f.id === cell.flow?.id) : undefined

  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  // which press the refusal answers, so it is said under that press and nowhere else
  const [failed, setFailed] = useState('')
  const [armed, setArmed] = useState('')
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState<Person | null>(() => board.people.find((p) => p.key === assignKey) ?? null)
  const [prefs, setPrefs] = useState<{ where: string; reason: string; again: () => Promise<WriteAnswer>; close: boolean } | null>(null)
  const swapThis = () => onSwap({ house, rowId, iso })

  /** `again`: the same write as an override, offered when Staff Preferences are all that refused it. */
  const run = async (fn: () => Promise<WriteAnswer>, close = true, where = 'act', again?: () => Promise<WriteAnswer>) => {
    setBusy(true)
    setRefusal('')
    setFailed('')
    setPrefs(null)
    try {
      onWrite(await fn(), close)
    } catch (err) {
      const reason = prefsReasonOf(err)
      if (reason && again) setPrefs({ where, reason, again, close })
      else {
        setRefusal(saidOf(err))
        setFailed(where)
      }
    } finally {
      setBusy(false)
      setArmed('')
    }
  }
  const said = (where: string) => (failed === where ? refusal : '')
  const prefsAt = (where: string, label: string) => (prefs?.where === where ? (
    <PrefsOverride reason={prefs.reason} label={label} busy={busy}
      onGo={() => void run(prefs.again, prefs.close, where)} onDrop={() => setPrefs(null)} />
  ) : null)

  // an edition holder's save names the cell as the panel shows it (only Python's board names editions, and only it reads this)
  const seen = board.viewer.editions?.length ? { seen: cell?.text ?? '' } : {}
  const save = (s: FormSave) => {
    // another of the house's staff picked: one write gives them the shift and takes it off this row
    const to = s.person && s.person.key !== row.key ? grid.rows.find((r) => r.kind === 'person' && r.key === s.person?.key) : undefined
    const send = (override: boolean) => saveCell({
      house, date: s.date, value: s.value, ...(s.note ? { note: s.note } : {}),
      ...(to ? { row_id: to.row_id, via: 'add', from_row_id: rowId } : { row_id: rowId, via: cell?.text ? 'edit' : 'add' }),
      ...(s.cancelPending ? { cancel_pending: true } : {}), ...(override ? { override: true } : {}), ...seen,
    })
    return run(() => send(false), Boolean(to), 'form', () => send(true))
  }
  // the Employee field's choices: the house's own staff, as the grid lists them
  const staff: Person[] = row.kind === 'person' && row.key
    ? grid.rows.filter((r) => r.kind === 'person' && r.key)
      .map((r) => board.people.find((p) => p.key === r.key) ?? { key: r.key, name: r.name, has_account: false })
    : []
  // a flow waiting on the cell: from the board, or from the refusal when the board was older than the flow
  const pending = pendingFlowLine(cell) || (isPendingRefusal(said('form')) ? said('form') : '')

  // an OPEN shift given to somebody: one write — their cell and the OPEN cell together, or neither
  const assign = (p: Person) => {
    const theirs = grid.rows.find((r) => r.kind === 'person' && r.key === p.key)
    const send = (override: boolean) => saveCell({
      house, ...(theirs ? { row_id: theirs.row_id } : {}), person: p.name, date: iso, open_row_id: rowId, via: 'add',
      ...(override ? { override: true } : {}),
    })
    return run(() => send(false), true, 'assign', () => send(true))
  }

  const viewerClash = mode === 'take' && span ? clashFor(board, board.viewer.key, iso, span[0], span[1]) : null
  const viewerThere = mode === 'take' && board.viewer.key ? sameHouseText(board, house, board.viewer.key, iso) : ''
  const takeWhy = mode !== 'take' ? ''
    : !board.viewer.key ? 'Your account is not on any house’s rows, so a shift cannot be yours here.'
    : viewerClash ? `Not possible: you are ${viewerClash.why}.`
    : viewerThere ? `Not possible: you already have ${viewerThere} at ${houseLabel(board, house)} that day — a row holds one shift a day.`
    : ''
  const callOffFor = ownEditor && row.kind === 'person' && !row.me && Boolean(span) && iso >= board.today
  // somebody else's shift that can still change hands
  const othersSwappable = row.kind === 'person' && !row.me && Boolean(span) && Boolean(cell?.text)
    && iso >= board.today && mode !== 'take'
    && !['called_off', 'requested_off', 'time_off', 'swapped_out', 'training'].includes(String(cell?.state))
    && !(cell?.flow && withdrawable(cell.flow))
  // the two-shift exchange stays Apps Script's: the master's and a director's alone
  const swapFor = (board.viewer.is_master || board.viewer.is_director) && othersSwappable
  // a flow of yours still waiting on this shift holds its own acts; a done take or swap leaves the shift wholly…
  const waitingFlow = Boolean(flow && withdrawable(flow) && mayWithdraw(board, flow))
  // a training still waiting: Call Off and Time off stay (they close it); Request Off and Swap wait for its answer
  const training = trainingWaiting(cell?.flow)
  const ahead = mayAskAhead(board.today, iso, board.settings.min_days_ahead)

  // the Employee field gives the shift to somebody through a swap: its holder, or for anybody the master, a director
  // or whoever Settings › Editions › Swaps lists
  const mayGive = row.kind === 'person' && Boolean(span) && Boolean(cell?.text) && iso >= board.today
    && !(cell?.flow && withdrawable(cell.flow))
    && (row.me ? mode === 'own' && !training : othersSwappable && swapsAnybody(board))
  const give = (p: Person) => run(() => proposeSwap(at, p.key), true, 'give', () => proposeSwap(at, p.key, '', true))
  const employee = mayGive ? (
    <EmployeeSwap board={board} house={house} iso={iso} span={span} holderKey={row.key} holderName={row.name}
      below={row.me && !hmOrAbove(board)} busy={busy} onGive={(p) => void give(p)}>
      <Refusal>{said('give')}</Refusal>
      {prefsAt('give', 'Ask anyway')}
    </EmployeeSwap>
  ) : undefined
  const stateWords = [
    !cell?.text && cell?.echo ? `Working at ${cell.echo} that day.` : '',
    cell?.state && cell.state !== 'training' ? STATE_WORDS[String(cell.state)] ?? '' : '',
    cell?.time_off ? `Time off ${cell.time_off === 'asked' ? 'asked — waiting on a director' : 'approved'}.` : '',
  ].filter(Boolean)

  return (
    <div data-panel-mode={mode}>
      {stateWords.length > 0 && (
        <p className="mt-1 text-[12px] leading-5 text-text-2" data-cell-state="">{stateWords.join(' ')}</p>
      )}

      {/* THE SHIFT AS IT STANDS, FOR WHOEVER DOES NOT EDIT IT */}
      {!(editor && mode !== 'take') && (
        <ShiftFacts personName={row.kind === 'open' ? `Open shift · ${openLabel(rowId)}` : row.name}
          dayLabel={dayLabel} span={span} code={cell?.text ? cellText(cell.text, clock) : ''} employee={employee} />
      )}

      {/* A TRAINING: NO IST AT THIS HOUSE */}
      {cell?.state === 'training' && (
        <div className={cn('mt-3 flex items-start gap-2 rounded-lg p-3 text-[12.5px] leading-5 text-text-1',
          training ? AMBER_NOTE : 'border border-border bg-tint-lavender')} data-training-means={cell.flow?.state || 'yes'}>
          <GraduationCap size={15} className={cn('mt-0.5 shrink-0', training ? 'text-warning' : 'text-tint-fg-lavender')} />
          <span>
            <span className="block font-semibold">{trainingTitle(houseLabel(board, house))}.</span>
            <span className="block text-[12px] text-text-2">{STATE_WORDS.training}</span>
            {cell.flow?.kind === 'training' && TRAINING_FLOW_WORDS[cell.flow.state] && (
              <span className="block pt-1 text-[12px] text-text-2">{TRAINING_FLOW_WORDS[cell.flow.state]}</span>
            )}
          </span>
        </div>
      )}

      {/* A FLOW OF YOURS ON THIS SHIFT */}
      {flow && (
        <div className="mt-3 grid gap-2 rounded-lg border border-border bg-surface p-3" data-flow={flow.kind}>
          <p className="text-[12.5px] font-semibold text-text-1">
            {flowLabel(flow)}{flow.exchange ? ` · ${flow.person} ⇄ ${flow.replacement}` : flow.replacement ? ` · ${flow.replacement}` : ''}
          </p>
          {exchangeLine(board, flow) && (
            <Muted>{`${houseLabel(board, flow.house_code)} · ${flow.date} · ${flow.shift_text ?? ''} ⇄ ${exchangeLine(board, flow)}`}</Muted>
          )}
          <StepBar steps={flowSteps(flow)} />
          {flow.kind === 'training' && flow.reason && <Muted>{flow.reason}</Muted>}
          {withdrawable(flow) && mayWithdraw(board, flow) && (
            <TwoPress id="withdraw" armed={armed} busy={busy} tone="outline" label="Withdraw" armedLabel="Withdraw"
              onArm={(a, act) => { setArmed(a); if (act) void run(() => withdrawFlow(flow.id), true, 'withdraw') }} />
          )}
          <Refusal>{said('withdraw')}</Refusal>
        </div>
      )}

      {/* YOUR OWN SHIFT — scheduled, or yours by a take, a swap or as a training */}
      {mode === 'own' && !waitingFlow && (
        <div className="mt-3 grid gap-2 rounded-lg border border-border bg-surface p-3" data-own="">
          {!ahead && (
            <p className={cn('rounded-md px-2 py-1.5 text-[12px] leading-5 text-text-1', AMBER_NOTE)} data-notice="">
              {noticeLine(board.today, iso, board.settings.min_days_ahead)}
            </p>
          )}
          {training && (
            <p className={cn('rounded-md px-2 py-1.5 text-[12px] leading-5 text-text-1', AMBER_NOTE)} data-training-wait="">
              Request Off and Swap wait until the training is decided. Call Off gives the shift up now (the training then closes).
            </p>
          )}
          <label className={LABEL}>
            Reason
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={AREA}
              placeholder="Only the directors read it — it is never in a text" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ahead && !training && (
              <TwoPress id="request-off" armed={armed} busy={busy} tone="outline" icon={<CalendarOff size={13} />}
                label="Request Off" armedLabel="Ask the directors"
                onArm={(a, act) => { setArmed(a); if (act) void run(() => requestOff(at, note), true, 'own') }} />
            )}
            <TwoPress id="call-off" armed={armed} busy={busy} tone="danger" icon={<PhoneOff size={13} />}
              label="Call Off" armedLabel="Call off now"
              onArm={(a, act) => { setArmed(a); if (act) void run(() => callOff(at, note), true, 'own') }} />
            {!training && !(cell?.flow && withdrawable(cell.flow)) && (
              <button type="button" className={OUTLINE_BTN} disabled={busy} onClick={swapThis} data-act="swap">
                <ArrowLeftRight size={13} /> Swap
              </button>
            )}
            {ahead && (
              <button type="button" className={OUTLINE_BTN} disabled={busy} onClick={() => onTimeOff(iso)}>
                <CalendarX2 size={13} /> Time off
              </button>
            )}
          </div>
          <Muted>
            Request Off asks the directors in My Work. Call Off happens now: the shift goes to an OPEN row at the top and
            the house is texted.
          </Muted>
          <Refusal>{said('own')}</Refusal>
        </div>
      )}

      {/* AN OPEN SHIFT, FOR STAFF */}
      {mode === 'take' && (
        <div className="mt-3 grid gap-2 rounded-lg border border-border bg-surface p-3" data-take="">
          <TwoPress id="take" armed={armed} busy={busy} disabled={Boolean(takeWhy)} icon={<Hand size={13} />}
            label="Take this shift" armedLabel="Take it"
            onArm={(a, act) => { setArmed(a); if (act) void run(() => takeShift(at), true, 'take', () => takeShift(at, true)) }} />
          {takeWhy ? <p className={cn('rounded-md px-2 py-1.5 text-[12px] leading-5 text-danger', DANGER_NOTE)}>{takeWhy}</p>
            : <Muted>First come: it is yours at once, and the house manager and the directors are told.</Muted>}
          <Refusal>{said('take')}</Refusal>
          {prefsAt('take', 'Take it anyway')}
        </div>
      )}

      {/* AN OPEN SHIFT, FOR AN EDITOR */}
      {mode === 'assign' && (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3" data-assign="">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Assign somebody</p>
          <FreePicker board={board} date={iso} span={span} house={house} picked={assignee}
            onPick={(p) => { setAssignee(p); setArmed('') }} label="People free for it" />
          {assignee && (
            <TwoPress id="assign" armed={armed} busy={busy} className="mt-2" icon={<UserCheck size={13} />}
              label={`Assign ${assignee.name}`} armedLabel={`Give it to ${assignee.name.split(' ')[0]}`}
              onArm={(a, act) => { setArmed(a); if (act) void assign(assignee) }} />
          )}
          <Refusal>{said('assign')}</Refusal>
          {prefsAt('assign', 'Assign anyway')}
        </div>
      )}

      {/* THE MASTER SWAPS ANYBODY'S SHIFT, SAME SEATS AS THEIR OWN */}
      {swapFor && (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3" data-swap-for="">
          <button type="button" className={OUTLINE_BTN} disabled={busy} onClick={swapThis} data-act="swap">
            <ArrowLeftRight size={13} /> Swap
          </button>
          <Muted className="mt-1.5">Exchange it for anybody’s shift at any house, or give it away — the same seats as their own.</Muted>
        </div>
      )}

      {/* THE CELL'S FORM, FOR AN EDITOR */}
      {editor && mode !== 'take' && (
        <ShiftForm board={board} house={house} mode="edit" rowId={rowId} personKey={row.key}
          personName={row.kind === 'open' ? openLabel(rowId) : row.name} openRow={row.kind !== 'person'}
          date={iso} text={cell?.text ?? ''} cell={cell} days={dayChoices(grid.cols)} hours={hours}
          saving={busy} refusal={pending && pending === said('form') ? '' : said('form')} pending={pending} onSave={(s) => void save(s)}
          mayCancel={ownEditor} staff={staff.length ? staff : undefined}
          prefs={prefsAt('form', 'Assign anyway')}
          onDelete={(n, cancel) => void run(() => saveCell({
            house, row_id: rowId, date: iso, value: '', ...(n ? { note: n } : {}), via: 'delete', ...(cancel ? { cancel_pending: true } : {}),
            ...seen,
          }), false, 'form')}
          onUndo={() => void run(() => undoLast(house), false, 'form')} />
      )}

      {/* AN EDITOR CALLS OFF ON SOMEBODY'S BEHALF */}
      {callOffFor && (
        <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-surface p-3" data-call-off-for="">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-danger">Call off for them</p>
          <label className={cn(LABEL, 'mt-2')}>
            Reason
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={AREA}
              placeholder="For the editors and the directors only" />
          </label>
          <TwoPress id="call-off-for" armed={armed} busy={busy} tone="danger" className="mt-2" icon={<PhoneOff size={13} />}
            label="Call off on their behalf" armedLabel="Call off now"
            onArm={(a, act) => { setArmed(a); if (act) void run(() => callOff(at, note), true, 'call-off-for') }} />
          <Muted className="mt-1.5">It happens now: the cell becomes C/O, the shift goes to an OPEN row and the house is texted.</Muted>
          <Refusal>{said('call-off-for')}</Refusal>
        </div>
      )}

      {mode === 'read' && (
        <Muted className="mt-3">
          {row.kind === 'person' ? `Only ${row.name} and the house’s editors change this shift.` : 'Only the house’s editors change this row.'}
        </Muted>
      )}
    </div>
  )
}
