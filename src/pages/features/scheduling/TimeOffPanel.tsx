// Time off: a range of days the directors approve (the first answer decides).
// Nothing changes until then; approved, each shift in a period that exists goes to an OPEN row, and days past the…
import { useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { addDays, houseLabel, mayAskAhead, type Board } from './schedulingModel'
import { AREA, FIELD, LABEL, Muted, Refusal, TwoPress } from './SchedulingParts'

export type OpensRow = { house: string; iso: string; day: string; text: string }

/** The viewer's shifts from `from` to `to` on the board, every house. */
export function shiftsItOpens(board: Board, from: string, to: string): OpensRow[] {
  if (!from || !to || to < from) return []
  const out: OpensRow[] = []
  for (const grid of Object.values(board.grids)) {
    for (const row of grid.rows) {
      if (row.kind !== 'person' || !row.me) continue
      grid.cols.forEach((c, i) => {
        const cell = row.cells[i]
        if (c.iso < from || c.iso > to || !cell?.text || cell.kind === 'off' || cell.kind === 'ro' || cell.state === 'called_off') return
        out.push({ house: houseLabel(board, grid.code), iso: c.iso, day: `${c.weekday} ${c.short}`, text: cell.text })
      })
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.house.localeCompare(b.house))
}

export function TimeOffForm({ board, initialFrom = '', busy, refusal, onAsk }: {
  board: Board
  initialFrom?: string
  busy: boolean
  refusal: string
  onAsk: (from: string, to: string, reason: string) => void
}) {
  const min = board.settings.min_days_ahead
  const earliest = addDays(board.today, min)
  const [from, setFrom] = useState(initialFrom && initialFrom >= earliest ? initialFrom : earliest)
  const [to, setTo] = useState(initialFrom && initialFrom >= earliest ? initialFrom : earliest)
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useState('')
  const early = Boolean(from) && !mayAskAhead(board.today, from, min)
  const backwards = Boolean(from && to) && to < from
  const opens = shiftsItOpens(board, from, to)
  const past = board.period.last && to > board.period.last ? board.period.last : ''
  const ready = Boolean(from && to) && !early && !backwards && !busy && board.settings.directors_readable

  return (
    <div className="mt-3 grid gap-3" data-time-off="">
      <div className="grid grid-cols-2 gap-2">
        <label className={LABEL}>
          From
          <input type="date" value={from} min={earliest} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value) }} className={FIELD} />
        </label>
        <label className={LABEL}>
          To
          <input type="date" value={to} min={from || earliest} onChange={(e) => setTo(e.target.value)} className={FIELD} />
        </label>
      </div>
      <label className={LABEL}>
        Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Only the directors read it" className={AREA} />
      </label>
      {early && (
        <p className="rounded-md bg-tint-warning px-2 py-1.5 text-[12px] leading-5 text-tint-fg-warning" data-notice="">
          Time off needs {min} days’ notice: the first day can be {earliest} or later. For a shift sooner than that, use
          Call Off on the shift.
        </p>
      )}
      {backwards && <Refusal>The last day comes before the first.</Refusal>}
      {!board.settings.directors_readable && (
        <Refusal>The directors who approve time off could not be read, so it cannot be asked for now.</Refusal>
      )}
      <div className="rounded-md bg-surface-2 px-2.5 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
          <CalendarX2 size={12} /> If approved, these shifts will be removed from your calendar
        </p>
        {opens.length === 0 ? (
          <Muted className="mt-1">None of your shifts on this calendar fall in those days.</Muted>
        ) : (
          <ul className="mt-1 grid gap-0.5" data-opens="">
            {opens.map((o) => (
              <li key={`${o.house}|${o.iso}`} className="text-[12px] text-text-1">
                <span className="font-semibold">{o.house}</span> · {o.day} · <span className="font-mono">{o.text}</span>
              </li>
            ))}
          </ul>
        )}
        {past && <Muted className="mt-1">Days after {past} are kept, and come out as time off when that period is made.</Muted>}
      </div>
      <div className={cn('flex flex-wrap items-center gap-2')}>
        <TwoPress id="time-off" armed={armed} busy={busy} disabled={!ready} label="Ask for time off" armedLabel="Ask the directors"
          onArm={(a, act) => { setArmed(a); if (act) onAsk(from, to, reason) }} />
      </div>
      <Refusal>{refusal}</Refusal>
    </div>
  )
}

export default function TimeOffPanel({ open, onClose, ...form }: {
  open: boolean
  onClose: () => void
} & Parameters<typeof TimeOffForm>[0]) {
  return (
    <SidePanel open={open} onClose={onClose} label="Time off" title={<span className="sr-only">Time off</span>}>
      <TimeOffForm {...form} />
    </SidePanel>
  )
}
