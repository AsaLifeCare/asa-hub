// The shift form an editor fills, for a cell already on the grid ("Shift") and for a new one ("Add shift"): who…
// Every edit applies at once.
import { useMemo, useState, type ReactNode } from 'react'
import { History, Loader2, Save, Trash2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ohioDateTime } from '@/lib/ohio'
import { hhmm, weekKeyOf } from '@/pages/features/shifts/houseCalTypes'
import { hourOfTimeInput, spanHours, timeInputOf } from '@/pages/features/shifts/shiftTimes'
import {
  busyWeekMinutes, cellMinutes, clashFor, codeOfMinutes, dayIndex, firstRange, freePeople, minutesOf, notPossibleLine,
  istMissingAt, sameHouseText, spanOfValue, type Board, type Cell, type Clash, type Ignore, type LogEntry, type Person,
} from './schedulingModel'
import { AMBER_NOTE, DANGER_NOTE } from '@/pages/features/shifts/shiftUi'
import { AREA, FIELD, LABEL, OUTLINE_BTN, PRIMARY_BTN, Refusal, TrainingPickNote, TwoPress } from './SchedulingParts'

/** `cancelPending`: the flow waiting on the cell is cancelled in the same write. */
export type FormSave = { person: Person | null; rowId: string; date: string; value: string; note: string; cancelPending?: boolean }

const VIA_TEXT: Record<string, string> = {
  add: 'Added', edit: 'Changed', delete: 'Deleted', add_person: 'Added to the house', call_off: 'Called off',
  request_off: 'Request off', time_off: 'Time off', swap: 'Swapped', take: 'Taken', undo: 'Undone',
  seed: 'From the house book', roll: 'Copied forward', open: 'Opened', move: 'Moved (drag and drop)',
}

/** A week over 40h warns; it never refuses. */
const WEEK_LINE = 40

/** The person's hours at every house in the week of `date`, from the busy index (shifts only), the edited one left out. */
function weekHours(board: Board, key: string, date: string, ignore: Ignore | null): number {
  return Math.round((busyWeekMinutes(board.busy[key], weekKeyOf(date), ignore) / 60) * 100) / 100
}

export function HistoryBlock({ entries }: { entries: LogEntry[] | null }) {
  return (
    <div className="mt-3 border-t border-border pt-2">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        <History size={11} /> History
      </p>
      {entries === null ? (
        <p className="mt-1 text-[11.5px] text-text-3">The history is not in this answer.</p>
      ) : entries.length === 0 ? (
        <p className="mt-1 text-[11.5px] text-text-3">Nothing has changed this cell here.</p>
      ) : (
        <ul className="mt-1 grid gap-1">
          {entries.map((h) => (
            <li key={h.id} className={cn('text-[11.5px] leading-4 text-text-2', h.undone_at && 'line-through opacity-60')}>
              <span className="font-semibold text-text-1">{VIA_TEXT[h.via] ?? 'Changed'}</span>{' '}
              {h.was || '∅'} → {h.now || '∅'} <span className="text-text-3">· {h.by_name} · {ohioDateTime(h.at)}</span>
              {h.note && <span className="block text-text-3">“{h.note}”</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ShiftForm({
  board, house, mode, rowId = '', personKey = '', personName = '', openRow = false, date, text, cell, days, hours,
  saving, refusal, pending = '', mayCancel = true, onSave, onDelete, onUndo, prefs, staff,
}: {
  board: Board
  house: string
  /** edit: a cell of a row on the grid (who and the day are the cell's); add: anybody free, any day drawn */
  mode: 'edit' | 'add'
  rowId?: string
  personKey?: string
  personName?: string
  openRow?: boolean
  date: string
  text: string
  cell?: Cell | null
  days: { iso: string; label: string }[]
  /** the hours figures (schedulingModel.hoursShown) */
  hours: boolean
  saving: boolean
  refusal: string
  /** a swap, Request Off or training waits on the cell (schedulingModel.pendingFlowLine): saving cancels it, pressed twice */
  pending?: string
  /** false: cancelling what waits on the cell is the house's own editors' (a calendar edition alone never cancels it) */
  mayCancel?: boolean
  onSave: (s: FormSave) => void
  onDelete?: (note: string, cancelPending: boolean) => void
  onUndo?: () => void
  /** Staff Preferences speak against the save: the reason and its override (SchedulingParts.PrefsOverride) */
  prefs?: ReactNode
  /** edit: the house's staff the Employee field gives the shift to (saved with `person`); absent, the holder, read-only */
  staff?: Person[]
}) {
  const times = useMemo(() => firstRange(text), [text])
  const plain = Boolean(times) && !/[<>]/.test(text)
  const [whoKey, setWhoKey] = useState(personKey)
  const [day, setDay] = useState(date || days[0]?.iso || '')
  const [start, setStart] = useState(plain ? timeInputOf(times?.start) : '')
  const [end, setEnd] = useState(plain ? timeInputOf(times?.end) : '')
  const [code, setCode] = useState(text)
  const [usedPickers, setUsedPickers] = useState(false)
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState('')

  const empty = !text.trim()
  const s = hourOfTimeInput(start)
  const e = hourOfTimeInput(end)
  const composed = usedPickers && s !== null && e !== null && s !== e ? codeOfMinutes(...minutesOf(s, e)) : ''
  const value = composed ? `${text.trim().startsWith('*') ? '*' : ''}${composed}` : code.trim()
  const read = spanOfValue(value)
  const span: [number, number] | null = read === 'none' ? null : read ?? [0, 1440]
  const newHours = Array.isArray(read) ? spanHours(read[0] / 60, read[1] / 60) : 0

  // edit: the shift given to somebody else of the house's staff (its holder's cell comes off with it)
  const moving = mode === 'edit' && Boolean(whoKey) && whoKey !== personKey
  const own = cellMinutes(cell)
  const ignore: Ignore | null = mode === 'edit' && !moving && own ? { house_code: house, date, start: own[0], end: own[1] } : null
  // OFF is free (an add replaces it); a shift already at this house that day is not (one row, one cell a day)
  const people = mode === 'add' ? freePeople(board, day, span, { house }) : null
  const picked: Person | null = whoKey
    ? board.people.find((p) => p.key === whoKey) ?? staff?.find((p) => p.key === whoKey)
      ?? (personKey === whoKey ? { key: whoKey, name: personName, has_account: false } : null)
    : null
  const clash: Clash | null = picked && span && !openRow ? clashFor(board, picked.key, day, span[0], span[1], ignore) : null
  const weekAll = hours && picked && Array.isArray(read) ? Math.round((weekHours(board, picked.key, day, ignore) + newHours) * 100) / 100 : null

  const changed = mode === 'add' || moving || value !== text.trim() || note !== ''
  // a shift given away is a shift: its start and end are picked when the cell holds none (an OFF)
  const ready = !saving && changed && value !== '' && !clash && (mode === 'edit' || Boolean(picked)) && Boolean(day)
    && (!moving || Array.isArray(read))

  const save = (cancelPending = false) => {
    if (!ready) return
    onSave({ person: mode === 'add' || moving ? picked : null, rowId, date: day, value, note, ...(cancelPending ? { cancelPending } : {}) })
  }

  const saveWord = saving ? 'Saving…' : mode === 'add' || empty ? 'Add shift' : 'Save'
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-3" data-shift-form={mode}>
      {/* the actions open the panel, each its icon alone (its name on hover); a delete still asks twice in words */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5" data-shift-actions="">
        {pending ? (mayCancel && (
          <TwoPress id="cancel-edit" armed={armed} busy={saving} disabled={!ready} tone="danger" icon={<Save size={14} />}
            label="" armedLabel="Cancel it and save" title="Cancel it and edit"
            onArm={(a, act) => { setArmed(a); if (act) save(true) }} />
        )) : (
          <button type="button" disabled={!ready} onClick={() => save()} className={PRIMARY_BTN} data-save=""
            title={saveWord} aria-label={saveWord}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          </button>
        )}
        {mode === 'edit' && !empty && onDelete && (!pending || mayCancel) && (
          <TwoPress id="delete" armed={armed} busy={saving} tone="danger" icon={<Trash2 size={14} />}
            label="" armedLabel={pending ? 'Cancel it and delete' : 'Delete'} title={pending ? 'Cancel it and delete' : 'Delete'}
            onArm={(a, act) => { setArmed(a); if (act) onDelete(note, Boolean(pending)) }} />
        )}
        {onUndo && (
          <button type="button" disabled={saving} onClick={onUndo} title="Undo your last change at this house"
            aria-label="Undo your last change at this house" className={OUTLINE_BTN}>
            <Undo2 size={14} />
          </button>
        )}
      </div>
      {pending && (
        <p className={cn('mb-3 rounded-md px-2 py-1.5 text-[12px] font-medium leading-5 text-text-1', AMBER_NOTE)} data-pending-flow="">
          {pending}
          {!mayCancel && <span className="block font-normal">The house manager, a Scheduling director or the master cancels it.</span>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={cn(LABEL, 'col-span-2')}>
          Employee
          {mode === 'edit' && staff && !openRow ? (
            <select value={whoKey} onChange={(ev) => setWhoKey(ev.target.value)} className={FIELD} data-house-staff=""
              aria-label="Employee — pick who works this shift">
              {staff.map((p) => {
                // somebody else's shift here that day: a row holds one shift a day
                const there = p.key === personKey ? '' : sameHouseText(board, house, p.key, date)
                return (
                  <option key={p.key} value={p.key} disabled={Boolean(there)}>
                    {p.name}{there ? ` — has ${there} here` : p.key !== personKey && istMissingAt(board, house, p.key) ? ' — training (no IST here)' : ''}
                  </option>
                )
              })}
            </select>
          ) : mode === 'edit' ? (
            <span className="mt-1 flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-[12.5px] font-normal normal-case tracking-normal text-text-2">
              {openRow ? `Open shift · ${personName}` : personName}
            </span>
          ) : (
            <select value={whoKey} onChange={(ev) => setWhoKey(ev.target.value)} className={FIELD} data-free-people="">
              <option value="">Pick somebody free…</option>
              {picked && !people?.free.some((p) => p.key === picked.key) && <option value={picked.key}>{picked.name}</option>}
              {people?.free.map((p) => (
                <option key={p.key} value={p.key}>{p.name}{istMissingAt(board, house, p.key) ? ' — training (no IST here)' : ''}</option>
              ))}
            </select>
          )}
        </label>
        <label className={cn(LABEL, 'col-span-2')}>
          Date
          {mode === 'edit' ? (
            <span className="mt-1 block h-9 rounded-md border border-border bg-surface-2 px-2 text-[12.5px] font-normal normal-case leading-9 tracking-normal text-text-2">
              {days.find((d) => d.iso === date)?.label ?? date}
            </span>
          ) : (
            <select value={day} onChange={(ev) => setDay(ev.target.value)} className={FIELD}>
              {days.map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
            </select>
          )}
        </label>
        <label className={LABEL}>
          Start
          <input type="time" value={start}
            onChange={(ev) => { setStart(ev.target.value); setUsedPickers(true) }} className={FIELD} />
        </label>
        <label className={LABEL}>
          End
          <input type="time" value={end}
            onChange={(ev) => { setEnd(ev.target.value); setUsedPickers(true) }} className={FIELD} />
        </label>
      </div>

      {/* a cell already drawn is changed by its times alone; a new one may still be written as the houses write it */}
      {mode === 'add' && (
        <label className={cn(LABEL, 'mt-2')}>
          Or the code, as the houses write it
          <input value={composed ? value : code} onChange={(ev) => { setCode(ev.target.value); setUsedPickers(false) }}
            placeholder="8A-8P · 930P-730A · OFF · 48TH (B)" className={FIELD} />
        </label>
      )}

      {mode === 'edit' && weekAll !== null && !openRow && weekAll > WEEK_LINE && (
        <p className="mt-2 text-[11px] font-semibold text-danger" data-week-over="">
          That week: {weekAll}h at every house — past {WEEK_LINE}h
        </p>
      )}

      {mode === 'add' && value && (
        <div className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-[12px] text-text-1">
          {Array.isArray(read)
            ? <>{hhmm(read[0] / 60)} – {hhmm(read[1] / 60)}{hours && <> · <span className="font-semibold">{newHours}h</span></>}</>
            : <>{value} <span className="text-text-3">· {read === 'none' ? 'not working' : 'no time read — it holds the whole day'}</span></>}
          {weekAll !== null && !openRow && (
            <span className={cn('block text-[11px] text-text-3', weekAll > WEEK_LINE && 'font-semibold text-danger')}>
              That week: {weekAll}h at every house{weekAll > WEEK_LINE ? ` — past ${WEEK_LINE}h` : ''}
            </span>
          )}
        </div>
      )}

      <label className={cn(LABEL, 'mt-2')}>
        Notes
        <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} placeholder="Add note here"
          className={AREA} />
      </label>

      {clash && picked && (
        <p role="alert" className={cn('mt-2 rounded-md px-2 py-1.5 text-[12px] font-medium leading-5 text-danger', DANGER_NOTE)} data-not-possible="">
          {notPossibleLine(picked.name, clash)}
        </p>
      )}
      {moving && picked && !Array.isArray(read) && (
        <p className="mt-2 text-[11.5px] leading-4 text-text-3" data-give-needs-times="">
          Pick its start and end to give the shift to {picked.name}.
        </p>
      )}
      {(mode === 'add' || moving) && picked && !clash && istMissingAt(board, house, picked.key) && <TrainingPickNote />}
      <Refusal>{refusal}</Refusal>
      {prefs}
      {mode === 'add' && people && people.blocked.length > 0 && (
        <p className="mt-2 text-[11px] leading-4 text-text-3">
          {people.blocked.length} {people.blocked.length === 1 ? 'person is' : 'people are'} not listed: already working
          in that span or at this house that day, or not free that day.
        </p>
      )}
      {mode === 'edit' && (
        <HistoryBlock entries={board.log ? (board.log[house] ?? []).filter((h) => h.row_id === rowId && h.date === date) : null} />
      )}
    </div>
  )
}

/** Days are compared as calendar days: the form's list of days drawn, labelled the way the grid heads them. */
export function dayChoices(cols: { iso: string; short: string; weekday: string }[], from = '', to = ''): { iso: string; label: string }[] {
  return cols
    .filter((c) => (!from || c.iso >= from) && (!to || c.iso <= to) && !Number.isNaN(dayIndex(c.iso)))
    .map((c) => ({ iso: c.iso, label: `${c.weekday} ${c.short}`.trim() }))
}
