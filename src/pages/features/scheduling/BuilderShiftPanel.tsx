// The Builder's Edit shift panel, for a pattern day and for a day of the period alike: who works it (a person on…
// Saving on another person moves the shift to them.
import { useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { codeOf, hourOfTimeInput, timeInputOf } from '@/pages/features/shifts/shiftTimes'
import { DAY_OFF, OPEN_KEY, QUICK_SHIFTS, shiftInfo, type BuilderRow } from './builderModel'
import { DANGER_BTN, FIELD, LABEL, Muted, PRIMARY_BTN } from './SchedulingParts'

export type ShiftTarget = { row: string; index?: number; text: string; words: string }

function ShiftForm({ target, rows, onSave, onDelete }: {
  target: ShiftTarget
  rows: BuilderRow[]
  onSave: (row: string, text: string) => void
  onDelete: () => void
}) {
  const [who, setWho] = useState(target.row)
  const [text, setTextRaw] = useState(target.text)
  const first = shiftInfo(target.text)
  const [start, setStart] = useState(first.start === null ? '' : timeInputOf(first.start))
  const [end, setEnd] = useState(first.end === null ? '' : timeInputOf(first.end))
  const info = shiftInfo(text)
  const dayOff = text.trim().toUpperCase() === DAY_OFF
  const setText = (t: string) => {
    const i = shiftInfo(t)
    setTextRaw(t)
    setStart(i.start === null ? '' : timeInputOf(i.start))
    setEnd(i.end === null ? '' : timeInputOf(i.end))
  }
  const setTime = (s: string, e: string) => {
    setStart(s)
    setEnd(e)
    const hs = hourOfTimeInput(s)
    const he = hourOfTimeInput(e)
    if (hs !== null && he !== null && hs !== he) setTextRaw(codeOf(hs, he))
  }
  const isNew = target.row === OPEN_KEY && target.index === undefined

  return (
    <div className="grid gap-4" data-builder-shift="">
      <label className={LABEL}>
        Staff member
        <select value={who} onChange={(e) => setWho(e.target.value)} className={FIELD}>
          <option value={OPEN_KEY}>OPEN</option>
          {rows.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </label>
      <div>
        <p className={LABEL}>Quick shifts</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {QUICK_SHIFTS.map((q) => (
            <button key={q} type="button" onClick={() => setText(q)} aria-pressed={text === q}
              className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold',
                text === q ? 'border-primary bg-tint-primary text-primary' : 'border-border bg-surface text-text-1 hover:bg-surface-2')}>
              {q}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-text-1">
        <input type="checkbox" checked={dayOff} onChange={(e) => setText(e.target.checked ? DAY_OFF : '')} disabled={who === OPEN_KEY} />
        Day off (R/O)
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={LABEL}>
          Start time
          <input type="time" value={start} disabled={dayOff} onChange={(e) => setTime(e.target.value, end)} className={FIELD} />
        </label>
        <label className={LABEL}>
          End time
          <input type="time" value={end} disabled={dayOff} onChange={(e) => setTime(start, e.target.value)} className={FIELD} />
        </label>
      </div>
      <Muted>Shift: <span className="font-mono text-text-1">{text || '—'}</span>{info.works ? ` · ${info.hours} h` : ''}</Muted>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY_BTN} disabled={!text.trim() || (who === OPEN_KEY && !info.works)}
          onClick={() => onSave(who, text.trim())} data-act="builder-shift-save">
          <Save size={13} /> Save
        </button>
        {!isNew && (
          <button type="button" className={DANGER_BTN} onClick={onDelete} data-act="builder-shift-delete">
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>
      {who === OPEN_KEY && <Muted>An OPEN shift needs its hours.</Muted>}
    </div>
  )
}

export default function BuilderShiftPanel({ target, rows, onSave, onDelete, onClose }: {
  target: ShiftTarget | null
  rows: BuilderRow[]
  onSave: (row: string, text: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <SidePanel open={Boolean(target)} onClose={onClose} label="Edit shift" title={target?.words ?? 'Edit shift'}>
      {target && (
        <ShiftForm key={`${target.words}|${target.row}|${target.index ?? ''}`} target={target} rows={rows} onSave={onSave} onDelete={onDelete} />
      )}
    </SidePanel>
  )
}
