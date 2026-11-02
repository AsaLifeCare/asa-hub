// View shifts — schedule × punches, side by side, for the day and house of the anomaly being reviewed.
// The answer to "was this person actually there?" lives in two lists the server already keeps; this right panel puts
// them beside each other. reconShiftsForDate answers {shifts, punches, elsewhere}: the house calendars' planned shifts,
// PsiAnywhere's entries at that house, and the same people's entries at OTHER houses that day — a "missing" punch is
// often a person who worked, somewhere else. (The panel used to read `schedule`, a key the server never sent, so the
// Scheduled column was always "—".)
import { useEffect, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import Skeleton from '@/components/shared/Skeleton'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'
import { dayLabel, timeLabel, type ReconError } from './reconTypes'

type SideRow = { start: string; end: string; note: string }
type EmployeeDay = { key: string; employee: string; id: string; schedule: SideRow[]; punches: SideRow[] }
type Elsewhere = { employee: string; location: string; start: string; end: string }

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return ''
}

function sideRow(row: Record<string, unknown>, startKeys: string[], endKeys: string[]): SideRow {
  // timeLabel, not the raw cell: a stored time can come back as Sheets' time-only epoch (1899-12-30T21:30:00.000Z)
  return {
    start: timeLabel(pick(row, ...startKeys)),
    end: timeLabel(pick(row, ...endKeys)),
    note: pick(row, 'note', 'detail'),
  }
}

const rowsOf = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map((r) => (r ?? {}) as Record<string, unknown>) : []

/** {shifts[], punches[], elsewhere[]} → one entry per person (by people id, else by name) and the elsewhere list. */
function normalize(data: unknown): { days: EmployeeDay[]; elsewhere: Elsewhere[] } {
  const d = (data ?? {}) as Record<string, unknown>
  const byEmp = new Map<string, EmployeeDay>()
  const ensure = (row: Record<string, unknown>): EmployeeDay => {
    const name = pick(row, 'employeeName', 'employee', 'name') || 'Unknown employee'
    const id = pick(row, 'employeeId')
    const key = id || `name:${name.trim().toLowerCase()}`
    if (!byEmp.has(key)) byEmp.set(key, { key, employee: name, id, schedule: [], punches: [] })
    return byEmp.get(key)!
  }
  // `schedule` is tolerated for an answer from before the server named it `shifts`
  for (const row of rowsOf(Array.isArray(d.shifts) ? d.shifts : d.schedule)) {
    ensure(row).schedule.push(sideRow(row, ['startTime', 'start', 'scheduledStart'], ['endTime', 'end', 'scheduledEnd']))
  }
  for (const row of rowsOf(d.punches)) {
    ensure(row).punches.push(sideRow(row, ['startTime', 'clockIn', 'start'], ['endTime', 'clockOut', 'end']))
  }
  const elsewhere = rowsOf(d.elsewhere).map((row) => ({
    employee: pick(row, 'employeeName', 'employee', 'name') || 'Unknown employee',
    location: pick(row, 'location', 'house') || 'another place',
    start: timeLabel(pick(row, 'startTime', 'start')),
    end: timeLabel(pick(row, 'endTime', 'end')),
  }))
  return {
    days: [...byEmp.values()].sort((a, b) => a.employee.localeCompare(b.employee)),
    elsewhere: elsewhere.sort((a, b) => a.employee.localeCompare(b.employee) || a.start.localeCompare(b.start)),
  }
}

export default function ShiftsPanel({ error, onClose }: { error: ReconError; onClose: () => void }) {
  const [got, setGot] = useState<{ days: EmployeeDay[]; elsewhere: Elsewhere[] } | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let alive = true
    gasAction<unknown>('reconShiftsForDate', { date: error.date, location: error.location })
      .then((r) => { if (alive) setGot(normalize(r)) })
      .catch((e) => { if (alive) setFailed(e instanceof Error ? e.message : 'The schedule could not be read.') })
    return () => { alive = false }
  }, [error.date, error.location])

  const isFocus = useMemo(() => {
    const id = (error.employeeId || '').trim()
    const name = (error.employeeName || '').trim().toLowerCase()
    return (d: { id?: string; employee: string }) =>
      (!!id && d.id === id) || (!!name && d.employee.trim().toLowerCase() === name)
  }, [error.employeeId, error.employeeName])

  return (
    <SidePanel
      open
      onClose={onClose}
      label="Shifts"
      title={`${dayLabel(error.date)} · ${error.location || 'Unknown location'}`}
    >
      <p className="mt-0.5 text-[13px] text-text-3">
        The house calendar’s shifts against PsiAnywhere’s entries — {error.employeeName || 'the employee'} is highlighted.
      </p>

      <div className="mt-4">
        {failed ? (
          <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{failed}</p>
        ) : !got ? (
          <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : got.days.length === 0 && got.elsewhere.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-text-3">
            No shift or entry came back for this house on this day.
          </p>
        ) : (
          <div className="space-y-3">
            {got.days.length > 0 && (
              <div className="grid grid-cols-2 gap-3 px-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-text-3">
                <span>Scheduled</span>
                <span>Punched</span>
              </div>
            )}
            {got.days.map((d) => {
              const focus = isFocus(d)
              const rows = Math.max(d.schedule.length, d.punches.length, 1)
              return (
                <div
                  key={d.key}
                  className={cn(
                    'rounded-lg border px-3 py-2.5',
                    focus ? 'border-primary/40 bg-tint-blue' : 'border-border bg-surface',
                  )}
                >
                  <DragPerson name={d.employee === 'Unknown employee' ? '' : d.employee} id={d.id || undefined}>
                    <p className={cn('mb-1.5 text-[14px] font-semibold', focus ? 'text-tint-fg-blue' : 'text-text-1')}>
                      {d.employee}
                      {focus && <span className="ml-2 text-[12px] font-normal">— this anomaly</span>}
                    </p>
                  </DragPerson>
                  <div className="space-y-1">
                    {Array.from({ length: rows }, (_, i) => {
                      const s = d.schedule[i]
                      const p = d.punches[i]
                      return (
                        <div key={i} className="grid grid-cols-2 gap-3 text-[13.5px] tabular-nums">
                          <span className="text-text-2">
                            {s ? `${s.start || '?'} – ${s.end || '?'}` : <span className="text-text-3">—</span>}
                          </span>
                          <span className="text-text-2">
                            {p ? `${p.start || '?'} – ${p.end || 'open'}` : <span className="text-text-3">—</span>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {got.elsewhere.length > 0 && (
              <div className="pt-2">
                <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.07em] text-text-3">
                  Punched at another house that day
                </p>
                <ul className="space-y-1.5">
                  {got.elsewhere.map((x, i) => {
                    const focus = isFocus({ employee: x.employee })
                    return (
                      <li
                        key={`${x.employee}|${x.location}|${x.start}|${i}`}
                        className={cn(
                          'flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-3 py-2 text-[13px]',
                          focus ? 'border-primary/40 bg-tint-blue' : 'border-border bg-surface',
                        )}
                      >
                        <span className={cn('font-semibold', focus ? 'text-tint-fg-blue' : 'text-text-1')}>{x.employee}</span>
                        <span className="flex items-center gap-1 text-text-2"><MapPin size={12} className="text-text-3" />{x.location}</span>
                        <span className="ml-auto tabular-nums text-text-2">{x.start || '?'} – {x.end || 'open'}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  )
}
