// The Builder's shift editor inside ShiftCellPanel: Save, Request Off and Delete are drafts.
// Mark Call-Off is not here: it is a live act, in the panel's own "Live now" box below.
import { useMemo, useState } from 'react'
import { CalendarOff, CalendarX2, Clock, History, Save, Trash2, Undo2 } from 'lucide-react'
import ConfirmDialog from '@/features/ops-flows/ConfirmDialog'
import { cn } from '@/lib/utils'
import { ohioDateTime, ohioTime } from '@/lib/ohio'
import { hhmm, sameName, weekKeyOf, type CellDraft, type CellFact, type HistoryEntry } from './houseCalTypes'
import {
  codeOf, hourOfTimeInput, ohioHourNow, runningFor, spanHours, timeInputOf, timesOf,
} from './shiftTimes'
import { timeOffWarning, type TimeOffMark } from './timeOffMarks'

export type EditorSave = {
  employee: string
  colIso: string
  /** a typed code, when the pickers were not used */
  value?: string
  /** the pickers' HH:MM, when they were — the relay composes the code */
  start?: string
  end?: string
  keepStar?: boolean
  note: string
}

type Confirm = 'request_off' | 'delete' | null

/** What the history row's road word means, out loud. */
function viaText(h: HistoryEntry): string {
  if (h.stage === 'published') {
    if (h.via === 'publish') return 'Published'
    if (h.via.startsWith('decision:')) return 'Given by the house manager'
    if (h.via.startsWith('claim:')) return 'Taken from the calendar'
    if (h.via === 'handoff') return 'Swapped'
    if (h.via === 'migration') return 'Carried over from an old override'
    if (h.via === 'test_mode_publish') return 'Published now from what test mode held'
    return 'Published'
  }
  // a change test mode held: the platform had it, the workbook never did
  if (h.stage === 'test_mode') {
    return h.via === 'test_mode_discard' ? 'Discarded — test mode held it, never in the workbook'
      : 'Recorded in test mode — not written to the workbook'
  }
  if (h.stage === 'call_off') return 'Called off'
  if (h.stage === 'override') return 'Edited on the old House Calendars'
  return ({
    cell: 'Drafted', times: 'Drafted', add: 'Added (draft)', delete: 'Deleted (draft)',
    move: 'Moved (draft)', swap: 'Swapped (draft)', replace: 'Replaced (draft)',
    request_off: 'Requested off (draft)', undo: 'Undone', discard: 'Draft discarded',
  } as Record<string, string>)[h.via] ?? 'Changed'
}

export default function ShiftEditor({
  employee, colIso, text, fact, draft, days, staff, openRow, locked, saving,
  history, historyFailed, weekHere, weekAll, overLine, nowMs, timeOff,
  onSave, onRequestOff, onDelete, onUndo,
}: {
  employee: string
  colIso: string
  /** the cell as the draft picture has it now */
  text: string
  fact?: CellFact
  draft?: CellDraft
  /** the grid's days, for the Date field */
  days: { iso: string; label: string }[]
  /** everybody who may be placed here: this house's people, then the directory */
  staff: string[]
  /** the clicked row is an OPEN row — nobody's shift */
  openRow: boolean
  /** why this cell cannot be edited here, when it cannot ('' when it can) */
  locked: string
  saving: boolean
  /** null while the history is being read */
  history: HistoryEntry[] | null
  historyFailed: string
  /** the person's hours for this cell's week, here and at every house (relay's) */
  weekHere?: number
  weekAll?: number
  overLine: number
  nowMs: number
  /** time off on this person's day (timeOffMarks, fed by the Time Off app): a warning, never a block here */
  timeOff?: TimeOffMark | null
  onSave: (s: EditorSave) => void
  onRequestOff: (note: string) => void
  onDelete: (note: string) => void
  onUndo: () => void
}) {
  const times = useMemo(() => timesOf(text), [text])
  const [who, setWho] = useState(employee)
  const [day, setDay] = useState(colIso)
  const [start, setStart] = useState(timeInputOf(times?.start))
  const [end, setEnd] = useState(timeInputOf(times?.end))
  const [code, setCode] = useState(text)
  const [usedPickers, setUsedPickers] = useState(false)
  const [note, setNote] = useState(draft?.note ?? '')
  const [confirm, setConfirm] = useState<Confirm>(null)
  // keyed by the cell, so nothing typed follows onto the next one

  const running = fact?.state === 'in_progress'
  const empty = !text.trim()
  const s = hourOfTimeInput(start)
  const e = hourOfTimeInput(end)
  const composed = usedPickers && s !== null && e !== null && s !== e ? codeOf(s, e) : ''
  const value = composed ? `${times?.star ? '*' : ''}${composed}` : code.trim()
  const newHours = composed && s !== null && e !== null ? spanHours(s, e)
    : (timesOf(value) ? spanHours(timesOf(value)!.start, timesOf(value)!.end) : 0)
  const oldHours = fact?.hours ?? 0
  const sameCell = sameName(who, employee) && day === colIso
  const delta = sameCell ? newHours - oldHours : newHours
  const projectedHere = weekHere !== undefined ? Math.round((weekHere + delta) * 100) / 100 : undefined
  const projectedAll = weekAll !== undefined ? Math.round((weekAll + delta) * 100) / 100 : undefined
  const changed = !sameCell || value !== text.trim() || note !== (draft?.note ?? '')
  // Emptying a cell is Delete, said as Delete — Save always carries a shift.
  const ready = !locked && !saving && changed && value !== ''
  const week = weekKeyOf(day)

  const save = () => {
    if (!ready) return
    onSave({
      employee: who, colIso: day, note,
      ...(composed ? { start, end, keepStar: Boolean(times?.star) } : { value }),
    })
  }

  /* THE CELL'S HISTORY — every draft, publish, decision and call-off; a locked cell keeps it too. */
  const historyBlock = (
    <div className="mt-3 border-t border-border pt-2">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        <History size={11} /> History
      </p>
      {historyFailed ? (
        <p className="mt-1 text-[11.5px] text-danger">The history could not be read ({historyFailed}).</p>
      ) : history === null ? (
        <p className="mt-1 text-[11.5px] text-text-3">Reading…</p>
      ) : history.length === 0 ? (
        <p className="mt-1 text-[11.5px] text-text-3">Nothing has changed this cell here.</p>
      ) : (
        <ul className="mt-1 grid gap-1">
          {history.map((h) => (
            <li key={h.id} className={cn('text-[11.5px] leading-4 text-text-2', h.undone && 'line-through opacity-60')}>
              <span className="font-semibold text-text-1">{viaText(h)}</span>{' '}
              {h.stage !== 'call_off' && <>{h.was || '∅'} → {h.now || '∅'} </>}
              <span className="text-text-3">· {h.by} · {ohioDateTime(h.at)}</span>
              {h.note && <span className="block text-text-3">“{h.note}”</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  if (locked) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-[12px] leading-5 text-text-2">{locked}</p>
        {historyBlock}
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-3">
      {/* WHERE THIS CELL STANDS — a draft, running now, or as published. */}
      {draft && (
        <p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11.5px] leading-4 text-amber-800 dark:text-amber-300">
          Draft — the workbook says <span className="font-semibold">{draft.base || 'nothing'}</span> here
          until the house is published{draft.by ? ` · drafted by ${draft.by}` : ''}.
          {draft.ist && <span className="block pt-1">{draft.ist}. Publishing takes the training on as your approval, and only while whoever trains is free then.</span>}
        </p>
      )}
      {running && fact?.starts_at && (
        <p className="mb-2 flex items-start gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-[11.5px] leading-4 text-emerald-800 dark:text-emerald-300">
          <Clock size={12} className="mt-0.5 shrink-0" />
          <span>
            Running now — started {ohioTime(fact.starts_at)}, {runningFor(fact.starts_at, nowMs)} so far
            {fact.ends_at ? `, ends ${ohioTime(fact.ends_at)}` : ''}. Its start has happened; only its end is still yours to change.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Employee
          {openRow ? (
            <span className="mt-1 block h-9 rounded-md border border-border bg-surface-2 px-2 text-[12.5px] font-normal normal-case leading-9 tracking-normal text-text-2">
              Open shift · {employee}
            </span>
          ) : (
            <select value={who} onChange={(ev) => setWho(ev.target.value)} disabled={running}
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none focus:border-primary disabled:opacity-60">
              {[employee, ...staff.filter((n) => !sameName(n, employee))].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          )}
        </label>
        <label className="col-span-2 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Date
          <select value={day} onChange={(ev) => setDay(ev.target.value)} disabled={running || openRow}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none focus:border-primary disabled:opacity-60">
            {days.map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
          </select>
        </label>
        <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Start
          <input type="time" value={start} disabled={running || (!empty && !times)}
            onChange={(ev) => { setStart(ev.target.value); setUsedPickers(true) }}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary disabled:opacity-60" />
        </label>
        <label className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
          End
          <input type="time" value={end} disabled={!empty && !times}
            onChange={(ev) => { setEnd(ev.target.value); setUsedPickers(true) }}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary disabled:opacity-60" />
        </label>
      </div>
      {running && (
        <button type="button"
          onClick={() => { setEnd(timeInputOf(ohioHourNow(nowMs))); setUsedPickers(true) }}
          className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-[12px] font-semibold text-text-1 hover:bg-surface">
          <Clock size={12} /> End now
        </button>
      )}

      <label className="mt-2 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        Or the code, as the houses write it
        <input value={composed ? value : code}
          onChange={(ev) => { setCode(ev.target.value); setUsedPickers(false) }}
          placeholder="8A-8P · 930P-730A · OFF · 48TH (B)"
          className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
      </label>

      {value && (
        <div className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-[12px] text-text-1">
          {timesOf(value)
            ? <>{hhmm(timesOf(value)!.start)} – {hhmm(timesOf(value)!.end)} · <span className="font-semibold">{newHours}h</span></>
            : <>{value} <span className="text-text-3">· no hours counted</span></>}
          {(projectedHere !== undefined || projectedAll !== undefined) && !openRow && (
            <span className="block text-[11px] text-text-3">
              Week of {week}:
              {projectedHere !== undefined && <> {projectedHere}h here</>}
              {projectedAll !== undefined && (
                <span className={cn(projectedAll > overLine && 'font-semibold text-danger')}>
                  {' · '}{projectedAll}h at every house{projectedAll > overLine ? ` — past ${overLine}h` : ''}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* time off on this day: said before a shift is saved onto it */}
      {timeOff && !openRow && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-text-3/30 bg-surface-2 px-2 py-1.5 text-[11.5px] leading-4 text-text-2">
          <CalendarX2 size={12} className="mt-0.5 shrink-0 text-text-3" />
          <span>{timeOffWarning(timeOff, employee)}</span>
        </p>
      )}

      <label className="mt-2 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        Notes
        <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={2}
          placeholder="Why — kept in this cell's history"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] font-normal normal-case tracking-normal text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
      </label>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" disabled={!ready} onClick={save}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50">
          <Save size={13} /> {saving ? 'Saving…' : empty ? 'Add shift' : 'Save'}
        </button>
        {!empty && !openRow && (
          <button type="button" disabled={saving} onClick={() => setConfirm('request_off')}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
            <CalendarOff size={13} /> Request Off
          </button>
        )}
        {!empty && (
          <button type="button" disabled={saving} onClick={() => setConfirm('delete')}
            className="flex h-9 items-center gap-1.5 rounded-md border border-danger/40 bg-surface px-2.5 text-[12.5px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-50">
            <Trash2 size={13} /> Delete
          </button>
        )}
        <button type="button" disabled={saving} onClick={onUndo}
          title="Undo your last draft edit on this house"
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
          <Undo2 size={13} /> Undo
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-text-3">
        Save, Request Off and Delete are drafts — nothing reaches the house's calendar until you
        publish the house.
      </p>

      {historyBlock}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'request_off' ? 'Request this day off?' : 'Delete this shift?'}
        body={confirm === 'request_off'
          ? `${employee}'s day becomes R/O and ${text} moves to the house's first free OPEN row, as a draft you publish with the house.`
          : `${employee}'s ${text} is removed, as a draft you publish with the house. The cell's history keeps it.`}
        confirmLabel={confirm === 'request_off' ? 'Request off' : 'Delete'}
        busyLabel="Working…"
        cancelLabel="Keep it"
        busy={saving}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const what = confirm
          setConfirm(null)
          if (what === 'request_off') onRequestOff(note)
          else if (what === 'delete') onDelete(note)
        }}
      />
    </div>
  )
}
