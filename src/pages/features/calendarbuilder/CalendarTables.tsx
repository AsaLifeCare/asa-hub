/** Calendar Builder's four estate tables (Conflicts · Hours · Staff · Houses) over the derived slices. */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import type { CalendarConflict, CalendarHours, CalendarHouse, CalendarStaffPref } from './useCalendarData'

/** 'YYYY-MM-DD' → 'Mon D' — parsed at local noon, never `new Date(iso)` (see lib/ohio). */
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '') || '—'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  )
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn('border-b border-border bg-surface-2/60 px-3 py-2 text-left font-semibold text-text-2', className)}>
      {children}
    </th>
  )
}

function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('border-b border-border px-3 py-2 text-text-1', className)}>{children}</td>
}

/* ---------- Conflicts ---------- */

export function ConflictsTab({ conflicts }: { conflicts: CalendarConflict[] }) {
  if (conflicts.length === 0) {
    return (
      <EmptyState
        title="No conflicts in the current period"
        body="Every shift in the period belongs to one house at a time, and none falls in approved time off."
      />
    )
  }
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Staff</Th>
          <Th>Date</Th>
          <Th>House</Th>
          <Th>Shift</Th>
          <Th>Clashes with</Th>
          <Th>When</Th>
        </tr>
      </thead>
      <tbody>
        {conflicts.map((c, i) => (
          <tr key={`${c.staff}-${c.date}-${i}`}>
            <Td className="font-medium">{c.staff}</Td>
            <Td>{c.date}</Td>
            <Td>{c.houseA}</Td>
            <Td className="text-text-2">{c.startA}–{c.endA}</Td>
            {c.kind === 'time_off' ? (
              <>
                <Td>
                  <span className="rounded-full bg-[#8b0000]/10 px-2 py-0.5 text-[11.5px] font-semibold text-[#8b0000]">
                    Approved time off
                  </span>
                </Td>
                <Td className="text-text-2">
                  {c.startB === c.endB ? c.startB : `${c.startB} – ${c.endB}`}{c.ref ? ` · ${c.ref}` : ''}
                </Td>
              </>
            ) : (
              <>
                <Td>{c.houseB}</Td>
                <Td className="text-text-2">{c.startB}–{c.endB}</Td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

/* ---------- Hours ---------- */

/** Over 40h/week on average is the line the desk watches. */
const FULL_TIME_AVG = 40

function HoursRow({ row }: { row: CalendarHours }) {
  const [open, setOpen] = useState(false)
  const max = Math.max(...row.weekly.map((w) => w.hours), 1)
  const over = row.perWeekAvg > FULL_TIME_AVG
  return (
    <>
      <tr
        className="cursor-pointer transition-colors hover:bg-surface-2/50"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Hide the weekly breakdown' : 'Show the weekly breakdown'}
      >
        <Td className="font-medium">
          <span className="mr-1 inline-block align-middle text-text-3">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          {row.staff}
        </Td>
        <Td className="text-text-2">{row.houses.join(', ')}</Td>
        <Td>{row.totalHours.toFixed(2)}</Td>
        <Td>{row.weeks}</Td>
        <Td>
          <span className={cn(over && 'rounded-sm bg-tint-amber px-1.5 py-0.5 font-semibold text-tint-fg-amber')}>
            {row.perWeekAvg.toFixed(1)}h
          </span>
          {over && <span className="ml-1.5 text-[11px] font-medium text-text-3">over {FULL_TIME_AVG}h</span>}
        </Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-b border-border bg-surface-2/40 px-6 py-2">
            <div className="flex flex-col gap-1">
              {row.weekly.map((w) => (
                <div key={w.weekStart} className="flex items-center gap-2 text-[11px] text-text-2">
                  <span className="w-[64px] shrink-0 text-text-3">{fmtDay(w.weekStart)}</span>
                  <span className="h-2 rounded-full bg-tint-blue" style={{ width: `${Math.max((w.hours / max) * 180, 3)}px` }} />
                  <span>{w.hours.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function HoursTab({ hours }: { hours: CalendarHours[] }) {
  const sorted = useMemo(() => [...hours].sort((a, b) => b.totalHours - a.totalHours), [hours])
  if (sorted.length === 0) {
    return <EmptyState title="No hours in the current period" body="The normalized shift table has nobody in it yet." />
  }
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Staff</Th>
          <Th>Houses</Th>
          <Th>Total hours</Th>
          <Th>Weeks</Th>
          <Th>Per-week avg</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <HoursRow key={row.staff} row={row} />
        ))}
      </tbody>
    </TableShell>
  )
}

/* ---------- Houses ---------- */

export function HousesTab({ houses }: { houses: CalendarHouse[] }) {
  if (houses.length === 0) {
    return <EmptyState title="No houses found" body="Neither the live mirror nor the Houses tab answered." />
  }
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>House</Th>
          <Th>Live grid</Th>
          <Th>Staff rows</Th>
          <Th>Grid last moved</Th>
          <Th>Workbook</Th>
        </tr>
      </thead>
      <tbody>
        {houses.map((h) => (
          <tr key={h.house}>
            <Td className="font-medium">{h.house}</Td>
            <Td>
              {h.hasLiveGrid ? (
                <span className="inline-block rounded-full bg-tint-mint px-2 py-0.5 text-[11px] font-semibold text-tint-fg-mint">
                  Live
                </span>
              ) : (
                <span className="inline-block rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-text-3">
                  No live grid
                </span>
              )}
            </Td>
            <Td className="text-text-2">{h.hasLiveGrid ? h.staffRows : '—'}</Td>
            <Td className="text-text-2">{h.liveAt ? h.liveAt.slice(0, 16).replace('T', ' ') : '—'}</Td>
            <Td>
              {h.sheetUrl ? (
                <a
                  href={h.sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-medium text-tint-fg-info underline-offset-2 hover:underline"
                >
                  Open sheet
                </a>
              ) : (
                <span className="text-text-3">—</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}


export function StaffTab({ staff }: { staff: CalendarStaffPref[] }) {
  if (staff.length === 0) {
    return <EmptyState title="No preferences on file" body="Nobody has answered the preferences form yet." />
  }
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Staff</Th>
          <Th>Shifts</Th>
          <Th>Pick up</Th>
          <Th>Weekend</Th>
          <Th>Allergy/Fear</Th>
          <Th>Note</Th>
        </tr>
      </thead>
      <tbody>
        {staff.map((s) => (
          <tr key={s.name}>
            <Td className="font-medium">{s.name}</Td>
            <Td className="text-text-2">{s.shifts || '—'}</Td>
            <Td className="text-text-2">{s.pickup || '—'}</Td>
            <Td className="text-text-2">{s.weekend || '—'}</Td>
            <Td className="text-text-2">{s.allergy || '—'}</Td>
            <Td className="text-text-2">{s.note || '—'}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}
