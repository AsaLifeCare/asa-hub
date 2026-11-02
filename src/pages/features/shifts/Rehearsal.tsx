// The rehearsal: staff answers played through the real doors (server/shift_rehearsal.py), inside a sandbox of its…
// It decides nothing of its own — every rule, refusal and window below is the lane's own answer.
import { useMemo, useState } from 'react'
import { AlertTriangle, Clock, FlaskConical, Loader2, MessageSquare, MonitorSmartphone, RotateCcw } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { post } from './laneFetch'
import {
  ACTS, APPROVAL_ACTS, CLOCK_ACTS, OUTCOME_TINT, SWAP_ACTS, clockBounds, deciderChoices, doorsFor,
  giveChoices, giverChoices, instantOf, numberNote, owedLine, owedSplit, receiverChoices, roleNote,
  seatChoices, shiftLabel, swapLabel,
  type OwedMessage, type RehearsalRow,
} from './rehearsalLogic'
import { useRehearsalBoard } from './useRehearsalBoard'

const CHIP = 'rounded-full px-2 py-0.5 text-[11px] font-semibold'
const BTN = 'flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all disabled:opacity-50'
const FIELD = 'h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1'

export default function Rehearsal() {
  const { board, error, loading, load, askClock, retry, run } = useRehearsalBoard()
  const [busy, setBusy] = useState('')
  const [door, setDoor] = useState('app')
  const [act, setAct] = useState('apply')
  const [ref, setRef] = useState('')
  const [person, setPerson] = useState('')
  const [second, setSecond] = useState('')
  const [decider, setDecider] = useState('')
  const [swap, setSwap] = useState('')
  const [requestId, setRequestId] = useState('')
  const [word, setWord] = useState('yes')
  const [at, setAt] = useState('')
  const [giveHouse, setGiveHouse] = useState('')
  const [giveDay, setGiveDay] = useState('')
  const [last, setLast] = useState<RehearsalRow | null>(null)
  const [note, setNote] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const shift = useMemo(() => board?.shifts.find((s) => s.ref === ref) ?? null, [board, ref])
  const people = useMemo(() => (shift ? board?.people[shift.location] ?? [] : []), [board, shift])
  const chosenSwap = useMemo(() => board?.swaps.find((s) => s.id === swap) ?? null, [board, swap])
  const doors = doorsFor(act)
  // an offer gives the giver's OWN shift; the pool's open shifts are applied for, decided or taken
  const offers = act === 'offer_swap'
  const needsShift = act === 'apply' || act === 'decide' || act === 'take'
  const needsSwap = SWAP_ACTS.includes(act)
  const approves = APPROVAL_ACTS.includes(act)
  const decides = act === 'decide' || act === 'take'
  // the datetime-local value is the viewer's own local time; the relay is sent the instant
  const clockIso = instantOf(at)
  const approvers = seatChoices(act, chosenSwap, board?.driver ?? '')
  const deciders = deciderChoices(board, shift?.location ?? '')

  const send = () => {
    if (!board) return
    setBusy('answer')
    setNote('')
    post<RehearsalRow>('/hub-lanes/shift-rehearsal/answer', {
      run: run.current || board.run,
      door: doors.includes(door) ? door : doors[0],
      act,
      ref: needsShift ? ref : '',
      location: offers ? giveHouse : needsShift && shift ? shift.location : '',
      open_row: needsShift && shift ? shift.open_row : '',
      col_iso: offers ? giveDay : needsShift && shift ? shift.col_iso : '',
      person,
      to_staff: second,
      decider: decides ? decider : '',
      handoff_id: needsSwap ? swap : '',
      request_id: act === 'withdraw' ? requestId : '',
      word,
      at: CLOCK_ACTS.includes(act) ? clockIso : '',
    })
      .then((row) => { setLast(row); load(CLOCK_ACTS.includes(act) ? clockIso : '') })
      .catch((err) => setNote(err instanceof Error ? err.message : 'the rehearsal refused it'))
      .finally(() => setBusy(''))
  }

  // no browser dialog: the reset asks for its own second click, in the page
  const reset = () => {
    setBusy('reset')
    setNote('')
    setConfirmReset(false)
    post<{ cleared: number; why: string }>('/hub-lanes/shift-rehearsal/reset', {})
      .then((d) => { setNote(d.why); setLast(null); load() })
      .catch((err) => setNote(err instanceof Error ? err.message : 'the sandbox was not reset'))
      .finally(() => setBusy(''))
  }

  if (!board) {
    // no board read yet: the failure is the page, with a way to ask again
    return error ? (
      <p className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
        <span>The rehearsal could not be read ({error}).</span>
        <button type="button" onClick={retry} disabled={loading}
          className={cn(BTN, 'border border-border bg-surface text-text-2')}>
          {loading && <Loader2 size={13} className="animate-spin" />} Try again
        </button>
      </p>
    ) : (
      <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
        <Loader2 size={14} className="animate-spin" /> Reading the rehearsal…
      </p>
    )
  }
  const standing = board.made.filter((r) => !r.cleared)
  const box = board.sandbox
  const owed = owedSplit(board.owed)

  return (
    <div className="grid gap-3">
      {error && (
        // a board is already drawn: it stays, and the failed read is said above it
        <p className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
          <span>
            The rehearsal could not be read again ({error}). What is shown below is the board as it
            was last read{board.at ? `, at the clock ${ohioDateTime(board.at) || board.at}` : ''}.
          </span>
          <button type="button" onClick={retry} disabled={loading}
            className={cn(BTN, 'border border-border bg-surface text-text-2')}>
            {loading && <Loader2 size={13} className="animate-spin" />} Try again
          </button>
        </p>
      )}
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-[12px] leading-[18px] text-text-2">
        <FlaskConical size={14} className="mt-0.5 shrink-0 text-text-3" />
        <span>
          <span className="font-semibold text-text-1">This is a rehearsal, played in a sandbox.</span> The
          sandbox is a copy of the estate
          {box?.filled_at ? ` taken ${ohioDateTime(box.filled_at) || box.filled_at}` : ''}
          {box?.since ? `, reaching back to ${box.since}` : ''}. Every answer below goes through the door
          a real one comes through — a text is written into the sandbox's own inbox and heard by the
          real reply ear, an answer in the platform calls the function the button calls — but only
          inside that copy. Nothing it does reaches a real row, a real calendar, a real person or any
          host, and nothing it owes is ever handed to the message door: what a lane would say is
          listed instead. Reset empties the sandbox and takes a fresh copy.
          {roleNote(box) && <span className="mt-1 block text-[11.5px] leading-4 text-text-3">{roleNote(box)}</span>}
        </span>
      </p>

      {(board.stopped?.length ?? 0) > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500 bg-amber-500/[0.06] px-4 py-2.5 text-[12px] leading-[18px] text-text-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <span className="font-semibold text-text-1">The sandbox stopped a reach outside it</span>
            {' — nothing was done: '}{board.stopped?.join('; ')}
          </span>
        </p>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-text-1">Play an answer</h2>
          <span className="text-[12px] text-text-3">· through a real door, inside the sandbox</span>
        </header>
        <div className="grid gap-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="What is answered" className={FIELD} value={act}
              onChange={(e) => {
                // an approver, a director, a giver and an answering person come from different lists
                const apart = [...APPROVAL_ACTS, 'offer_swap']
                if (apart.includes(e.target.value) || apart.includes(act)) setPerson('')
                setAct(e.target.value)
                setLast(null)
              }}>
              {ACTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <div className="flex items-center gap-1">
              {doors.map((d) => (
                <button key={d} type="button" onClick={() => setDoor(d)}
                  className={cn(BTN, doors.includes(door) && door === d
                    ? 'bg-primary text-on-primary' : 'border border-border bg-surface text-text-2')}>
                  {d === 'text' ? <MessageSquare size={13} /> : <MonitorSmartphone size={13} />}
                  {d === 'text' ? `by text to the ${board.line.slice(-4)}` : 'in the platform'}
                </button>
              ))}
            </div>
          </div>

          {needsShift && (
            <select aria-label="Which shift" className={FIELD} value={ref}
              onChange={(e) => setRef(e.target.value)}>
              <option value="">Pick a shift…</option>
              {board.shifts.map((s) => (
                <option key={s.ref} value={s.ref}>{shiftLabel(s)}</option>
              ))}
            </select>
          )}

          {offers && (
            // the giver's own shift, from the sandbox's calendar: a swap hands over a cell somebody already works…
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Which house" className={FIELD} value={giveHouse}
                onChange={(e) => { setGiveHouse(e.target.value); setPerson(''); setGiveDay(''); setSecond('') }}>
                <option value="">Pick a house…</option>
                {board.houses.map((h) => <option key={h.location} value={h.location}>{h.house}</option>)}
              </select>
              <select aria-label="Who gives their shift" className={FIELD} value={person}
                onChange={(e) => { setPerson(e.target.value); setGiveDay('') }}>
                <option value="">Who gives their shift away…</option>
                {giverChoices(board, giveHouse).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select aria-label="Which of their shifts" className={FIELD} value={giveDay}
                onChange={(e) => setGiveDay(e.target.value)}>
                <option value="">Which of their shifts…</option>
                {giveChoices(board, giveHouse, person).map((c) => (
                  <option key={c.col_iso} value={c.col_iso}>{`${c.col_iso} · ${c.value}`}</option>
                ))}
              </select>
              <select aria-label="Who is offered the shift" className={FIELD} value={second}
                onChange={(e) => setSecond(e.target.value)}>
                <option value="">Offered to…</option>
                {receiverChoices(board, giveHouse, person).map((p) => (
                  <option key={p} value={p}>{p}{numberNote(board, p)}</option>
                ))}
              </select>
            </div>
          )}

          {offers && giveHouse && giverChoices(board, giveHouse).length === 0 && (
            <p className="text-[11.5px] leading-4 text-text-3">
              Nobody at this house has a shift of their own still ahead on the sandbox's calendar, so there is nothing to give away here.
            </p>
          )}

          {needsSwap && (
            <select aria-label="Which swap" className={FIELD} value={swap}
              onChange={(e) => setSwap(e.target.value)}>
              <option value="">Pick a swap waiting…</option>
              {board.swaps.map((s) => (
                <option key={s.id} value={s.id}>{swapLabel(s)}</option>
              ))}
            </select>
          )}

          {act === 'withdraw' && (
            <select aria-label="Which application" className={FIELD} value={requestId}
              onChange={(e) => setRequestId(e.target.value)}>
              <option value="">Pick a rehearsed application…</option>
              {board.shifts.flatMap((s) => s.applicants.filter((a) => a.rehearsed).map((a) => (
                <option key={a.id} value={a.id}>
                  {`${a.person} · ${s.house} · ${s.col_iso} · ${s.value || 'open'} · ${a.state}`}
                </option>
              )))}
            </select>
          )}

          {(needsShift || approves) && (
            <div className="flex flex-wrap items-center gap-2">
              {approves ? (
                // the transfer's own names for that seat, never the house's grid: the relay weighs the name as the…
                <select aria-label="Who approves" className={FIELD} value={person}
                  onChange={(e) => setPerson(e.target.value)}>
                  <option value="">{act === 'swap_director' ? 'Which director approves…' : 'Who approves…'}</option>
                  {approvers.map((c) => (
                    <option key={c.name} value={c.name}>{c.label}{numberNote(board, c.name)}</option>
                  ))}
                </select>
              ) : (
                <select aria-label="Who answers" className={FIELD} value={person}
                  onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Who answers…</option>
                  {people.map((p) => (
                    <option key={p} value={p}>{p}{numberNote(board, p)}</option>
                  ))}
                </select>
              )}
              {decides && (
                <select aria-label="Decided as" className={FIELD} value={decider}
                  onChange={(e) => setDecider(e.target.value)}>
                  <option value="">{board.driver ? `Decided as ${board.driver} (you)` : 'Decided as you'}</option>
                  {deciders.filter((c) => c.name !== board.driver).map((c) => (
                    <option key={c.name} value={c.name}>{`Decided as ${c.label}`}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {act === 'swap_approve' && chosenSwap && (
            <p className="text-[11.5px] leading-4 text-text-3">
              {chosenSwap.approval_why || 'the transfer names who approves it'}
              {(chosenSwap.approvers ?? []).length === 0
                && ' — no house manager is named on it, so you approve it here.'}
            </p>
          )}

          {act === 'swap_director' && chosenSwap && (
            <p className="text-[11.5px] leading-4 text-text-3">
              {(chosenSwap.directors ?? []).length > 0
                ? `The director's approval is given by ${chosenSwap.directors.join(' or ')}, from the directors list on Settings → Time Off.`
                : 'This transfer was asked of no director, so nobody can give the director\'s approval on it.'}
            </p>
          )}

          {decides && shift && board.deciders_readable === false && (
            <p className="text-[11.5px] leading-4 text-text-3">
              {`Who manages ${shift.house} could not be read (${board.deciders_why || 'no reason given'}), so only you are offered to decide.`}
            </p>
          )}

          {door === 'text' && doors.includes('text') && board.textable_readable === false && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-[18px] text-text-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                {`The contact index could not be read (${board.textable_why || 'no reason given'}). Which number anybody would text from is not known, so no text can be played until it can.`}
              </span>
            </p>
          )}

          {needsSwap && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-3">The answer</span>
              {['yes', 'no'].map((w) => (
                <button key={w} type="button" onClick={() => setWord(w)}
                  className={cn(BTN, word === w ? 'bg-primary text-on-primary'
                    : 'border border-border bg-surface text-text-2')}>
                  {w === 'yes' ? (approves ? 'APPROVE' : 'YES') : 'NO'}
                </button>
              ))}
            </div>
          )}

          {CLOCK_ACTS.includes(act) && (
            <div className="grid gap-1 rounded-md border border-border bg-surface-2 px-3 py-2">
              <label className="flex flex-wrap items-center gap-2 text-[12px] text-text-2">
                <Clock size={13} className="shrink-0 text-text-3" />
                <span className="font-semibold text-text-1">Play it at</span>
                <input type="datetime-local" className={FIELD} value={at}
                  min={clockBounds(shift).min} max={clockBounds(shift).max}
                  onChange={(e) => { setAt(e.target.value); askClock(instantOf(e.target.value)) }} />
                {at && (
                  <button type="button" className={cn(BTN, 'border border-border bg-surface text-text-2')}
                    onClick={() => { setAt(''); load('') }}>Now</button>
                )}
                {loading && <Loader2 size={13} className="animate-spin text-text-3" aria-label="Reading the board" />}
              </label>
              <p className="text-[11px] leading-4 text-text-3">
                The instant the lane's own window arithmetic is asked about, in your own local time.
                It is how the ten reserved minutes, the choice between two applicants and a call-off's
                five hours are rehearsed at all: on a live estate those windows closed hours ago.
                Nothing is moved to make it true, and it has to fall inside the life of a shift that
                exists.
              </p>
            </div>
          )}

          {shift && needsShift && (
            <p className="text-[11.5px] leading-4 text-text-3">
              {shift.window.why || `the window is ${shift.window.state}`}
              {clockIso && CLOCK_ACTS.includes(act) && ` · as it stood at ${ohioDateTime(clockIso) || clockIso}`}
              {shift.applicants.length > 0 && ` · applicants: ${shift.applicants.map((a) => `${a.person} (${a.rehearsed ? 'rehearsed' : 'copied from the estate'})`).join(', ')}`}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={send} disabled={busy !== ''}
              className={cn(BTN, 'bg-primary text-on-primary')}>
              {busy === 'answer' && <Loader2 size={13} className="animate-spin" />}
              Play it through the {doors.includes(door) ? door : doors[0]} door
            </button>
            {!confirmReset ? (
              <button type="button" onClick={() => setConfirmReset(true)} disabled={busy !== ''}
                className={cn(BTN, 'border border-border bg-surface text-text-2 hover:bg-surface-2')}>
                <RotateCcw size={13} /> Reset the sandbox
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500 bg-amber-500/[0.06] px-2 py-1 text-[12px] text-text-2">
                {`Empty the sandbox of all ${standing.length} answer(s) played in it and take a fresh copy of the estate?`}
                <button type="button" onClick={reset} disabled={busy !== ''}
                  className={cn(BTN, 'bg-primary text-on-primary')}>
                  {busy === 'reset' && <Loader2 size={13} className="animate-spin" />} Reset
                </button>
                <button type="button" onClick={() => setConfirmReset(false)}
                  className={cn(BTN, 'border border-border bg-surface text-text-2')}>Keep it</button>
              </span>
            )}
          </div>
          {note && <p className="text-[12px] leading-[18px] text-text-2">{note}</p>}
        </div>
      </section>

      {last && <Answer row={last} title="What the lane did" />}

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex items-center gap-2 px-4 py-2.5">
          <FlaskConical size={14} className="text-text-3" />
          <h2 className="text-[13px] font-semibold text-text-1">What was played in the sandbox</h2>
          <span className="text-[12px] text-text-3">· {standing.length} since the last reset, {board.made.length} in all</span>
        </header>
        {board.made.length === 0 ? (
          <p className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">
            Nothing has been rehearsed yet.
          </p>
        ) : (
          <ul className="border-t border-border">
            {board.made.map((r) => (
              <li key={r.id} className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 first:border-t-0',
                r.cleared && 'opacity-60')}>
                <Avatar name={r.person || '?'} size="xs" />
                <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-text-2">
                  <span className="font-medium text-text-1">{r.person || r.driver}</span>
                  {' · '}{r.act.replace(/_/g, ' ')}{' · '}
                  {r.door === 'text' ? 'by text' : 'in the platform'}
                  {' · '}{ohioDateTime(r.at) || r.at}
                  {r.said && <span className="block text-[12px] leading-[18px] text-text-1">“{r.said}”</span>}
                  {r.why && <span className="block text-[11.5px] leading-4 text-text-3">{r.why}</span>}
                  <OwedLines owed={r.owed} />
                  {r.cleared && (
                    <span className="block text-[11px] leading-4 text-text-3">
                      cleared by the reset{r.cleared_by ? ` of ${r.cleared_by}` : ''}
                      {r.cleared_at ? ` · ${ohioDateTime(r.cleared_at) || r.cleared_at}` : ''}
                    </span>
                  )}
                </span>
                <span className={cn(CHIP, `bg-tint-${OUTCOME_TINT[r.outcome] ?? 'slate'} text-tint-fg-${OUTCOME_TINT[r.outcome] ?? 'slate'}`)}>
                  {r.outcome}{r.code ? ` · ${r.code}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex items-center gap-2 px-4 py-2.5">
          <MessageSquare size={14} className="text-text-3" />
          <h2 className="text-[13px] font-semibold text-text-1">What the sandbox's lanes owe now</h2>
          <span className="text-[12px] text-text-3">
            {owed.unreadable.length > 0
              ? `· at least ${owed.messages.length}, and ${owed.unreadable.length} lane(s) could not be read — none of it is ever sent`
              : `· ${owed.messages.length}, and none of it is ever sent`}
          </span>
        </header>
        {owed.unreadable.length > 0 && (
          // a lane nobody could read owes an unknown number of messages, never none and never one
          <p className="flex items-start gap-2 border-t border-border bg-amber-500/[0.06] px-4 py-2 text-[12px] leading-[18px] text-text-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
            <span>{owed.unreadable.map(owedLine).join('; ')} — what it owes is not known.</span>
          </p>
        )}
        {owed.messages.length === 0 ? (
          <p className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">
            {owed.unreadable.length > 0
              ? 'No lane that could be read owes a message right now.'
              : 'No lane of the sandbox owes a message right now.'}
          </p>
        ) : (
          <ul className="border-t border-border px-4 py-2 text-[12px] leading-[18px] text-text-2">
            {owed.messages.map((o) => <li key={o.key}>{owedLine(o)}</li>)}
          </ul>
        )}
      </section>

      <p className="text-[11.5px] leading-4 text-text-3">
        Only houses the platform holds a calendar for are offered
        {board.not_houses.length > 0
          && `; ${board.not_houses.join(', ')} ${board.not_houses.length === 1 ? 'has' : 'have'} open rows in the pool but no calendar here, so ${board.not_houses.length === 1 ? 'it is' : 'they are'} not offered as a house`}.
        All three consents of a swap may be given here — the receiver's, the house manager's and a
        listed director's: the shift then moves on the sandbox's own calendar, never on the real one. A row the sandbox copied from the estate is never answered, decided or taken
        back by the rehearsal — only what it played itself.
      </p>
    </div>
  )
}

function OwedLines({ owed }: { owed: OwedMessage[] }) {
  // a lane nobody could read is never listed as something that would have been said
  const { messages, unreadable } = owedSplit(owed)
  if (!messages.length && !unreadable.length) return null
  return (
    <>
      {messages.length > 0 && (
        <span className="block text-[11.5px] leading-4 text-text-3">
          <span className="font-semibold">would have been said, and to whom</span>
          {': '}{messages.map(owedLine).join('; ')}
          {' — inside the sandbox, so nobody was told.'}
        </span>
      )}
      {unreadable.length > 0 && (
        <span className="block text-[11.5px] leading-4 text-amber-700 dark:text-amber-400">
          <span className="font-semibold">not known</span>
          {': '}{unreadable.map(owedLine).join('; ')}
        </span>
      )}
    </>
  )
}

function Answer({ row, title }: { row: RehearsalRow; title: string }) {
  const lanes = Object.entries(row.lanes ?? {})
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-text-1">{title}</h2>
        <span className={cn(CHIP, `bg-tint-${OUTCOME_TINT[row.outcome] ?? 'slate'} text-tint-fg-${OUTCOME_TINT[row.outcome] ?? 'slate'}`)}>
          {row.outcome}{row.code ? ` · ${row.code}` : ''}
        </span>
        <span className="text-[12px] text-text-3">
          {row.door === 'text' ? 'through the reply ear' : 'through the platform door'}
        </span>
      </header>
      <div className="grid gap-1 border-t border-border px-4 py-2.5">
        {row.said && <p className="text-[12.5px] leading-[18px] text-text-1">“{row.said}”</p>}
        <p className="text-[12.5px] leading-[18px] text-text-2">{row.why}</p>
        {lanes.map(([k, v]) => (
          <p key={k} className="text-[11.5px] leading-4 text-text-3">
            <span className="font-semibold">{k.replace(/_/g, ' ')}</span>
            {': '}
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </p>
        ))}
        <OwedLines owed={row.owed} />
        {(row.stopped?.length ?? 0) > 0 && (
          <p className="text-[11.5px] leading-4 text-amber-700 dark:text-amber-400">
            The sandbox stopped a reach outside it — nothing was done: {row.stopped?.join('; ')}
          </p>
        )}
      </div>
    </section>
  )
}
