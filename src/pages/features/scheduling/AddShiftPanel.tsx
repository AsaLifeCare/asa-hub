/** Add shift: the editor's form for a new cell — anybody free, any day of the period, the times or the code. */
import { useState } from 'react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { houseLabel, type Board, type WriteAnswer } from './schedulingModel'
import { prefsReasonOf, saidOf, saveCell } from './schedulingLane'
import ShiftForm, { dayChoices, type FormSave } from './ShiftForm'
import { OUTLINE_BTN, PrefsOverride } from './SchedulingParts'

export default function AddShiftPanel({ open, onClose, board, house, day, hours, onWrite }: {
  open: boolean
  onClose: () => void
  board: Board
  house: string
  /** the day it opens on */
  day: string
  hours: boolean
  onWrite: (answer: WriteAnswer, close: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [prefs, setPrefs] = useState<{ reason: string; s: FormSave } | null>(null)
  const grid = board.grids[house]

  const save = async (s: FormSave, override = false) => {
    if (!s.person) return
    const row = grid?.rows.find((r) => r.kind === 'person' && r.key === s.person?.key)
    setBusy(true)
    setRefusal('')
    setPrefs(null)
    try {
      onWrite(await saveCell({
        house, ...(row ? { row_id: row.row_id } : {}), person: s.person.name, date: s.date, value: s.value,
        ...(s.note ? { note: s.note } : {}), via: 'add', ...(override ? { override: true } : {}),
      }), true)
    } catch (err) {
      const reason = prefsReasonOf(err)
      if (reason && !override) setPrefs({ reason, s })
      else setRefusal(saidOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SidePanel open={open && Boolean(grid)} onClose={onClose} label="Add shift" title="Add shift"
      footer={<button type="button" onClick={onClose} className={cn(OUTLINE_BTN, 'w-full')}>Close</button>}>
      {grid && (
        <>
          <p className="mt-1 text-[12px] text-text-3">{houseLabel(board, house)} · only people free for the day and times are listed.</p>
          <ShiftForm key={`${house}|${day}`} board={board} house={house} mode="add" date={day} text=""
            days={dayChoices(grid.cols, board.today)} hours={hours} saving={busy} refusal={refusal} onSave={(s) => void save(s)}
            prefs={prefs && (
              <PrefsOverride reason={prefs.reason} label="Assign anyway" busy={busy}
                onGo={() => void save(prefs.s, true)} onDrop={() => setPrefs(null)} />
            )} />
        </>
      )}
    </SidePanel>
  )
}
