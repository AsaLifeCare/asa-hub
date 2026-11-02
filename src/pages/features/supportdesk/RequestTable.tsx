// The requests table: Status (an icon, its word read out), Date (sortable), Requestor (a round avatar), Request…
// The whole row is a button that opens the side panel; nothing is decided in a row.
import { AlertTriangle, ArrowDown, ArrowUp, Check, CheckCircle2, ChevronRight, Clock, Flag, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import Skeleton from '@/components/shared/Skeleton'
import { cn } from '@/lib/utils'
import {
  PILL, dateWords, requestorName, statusLook, typeTint, type Row, type SortDir, type StatusLook,
} from './supportDeskModel'

// the column template is a whole literal so the stylesheet keeps it
const COLS = 'md:grid-cols-[44px_168px_minmax(150px,1fr)_minmax(150px,0.9fr)_minmax(0,1.6fr)_20px]'
const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

export function StatusIcon({ look, word }: { look: StatusLook; word: string }) {
  const size = 15
  const icon = look.icon === 'dot' ? <span className="block h-2.5 w-2.5 rounded-full bg-current" />
    : look.icon === 'clock' ? <Clock size={size} />
      : look.icon === 'triangle-alert' ? <AlertTriangle size={size} />
        : look.icon === 'flag' ? <Flag size={size} />
          : look.icon === 'check' ? <Check size={size} />
            : look.icon === 'x' ? <X size={size} />
              : <CheckCircle2 size={size} />
  return (
    <span role="img" aria-label={word} title={word} data-status-icon={look.icon}
      className={cn('grid h-7 w-7 place-items-center rounded-full bg-surface-2', look.className)}>
      {icon}
    </span>
  )
}

export function TypePill({ row }: { row: Pick<Row, 'type' | 'route'> }) {
  return (
    <span data-type-pill={typeTint(row)}
      className={cn('inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL[typeTint(row)])}>
      {row.type.display}
    </span>
  )
}

export default function RequestTable({ rows, dir, onSort, onOpen, selected }: {
  rows: Row[]
  dir: SortDir
  onSort: () => void
  onOpen: (ref: string) => void
  /** the row whose panel is open */
  selected: string
}) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-1" data-request-table="">
      <div className={cn('hidden items-center gap-3 border-b border-border bg-surface-2/50 px-4 py-2.5 md:grid', COLS)} role="presentation">
        <span className={HEAD}>Status</span>
        <button type="button" onClick={onSort} data-sort={dir}
          aria-label={dir === 'desc' ? 'Date, newest first — press for oldest first' : 'Date, oldest first — press for newest first'}
          className={cn(HEAD, 'inline-flex items-center gap-1 text-left hover:text-text-1')}>
          Date {dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
        </button>
        <span className={HEAD}>Requestor</span>
        <span className={HEAD}>Request Type</span>
        <span className={HEAD}>Description</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => <RequestLine key={row.ref} row={row} open={row.ref === selected} onOpen={onOpen} />)}
      </ul>
    </div>
  )
}

export function RequestLine({ row, open, onOpen }: { row: Row; open: boolean; onOpen: (ref: string) => void }) {
  const name = requestorName(row)
  const look = statusLook(row.status.tone)
  const when = dateWords(row.date)
  const who = cn('truncate text-[13px] font-semibold', row.requestor.name ? 'text-text-1' : 'text-text-3')
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.ref)} data-row={row.ref} data-tone={row.status.tone}
        aria-label={`${row.status.word}: ${row.type.display} from ${name} — open`}
        className={cn('block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2/70', open && 'bg-primary-soft',
          !open && row.status.tone === 'warning' && !row.completed && 'bg-[color-mix(in_srgb,var(--danger)_5%,transparent)]')}>
        <span className={cn('hidden items-center gap-3 md:grid', COLS)}>
          <StatusIcon look={look} word={row.status.word} />
          <span className="text-[12.5px] tabular-nums text-text-2" data-date="">{when}</span>
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={name} size="xs" />
            <span className={who}>{name}</span>
          </span>
          <span className="min-w-0"><TypePill row={row} /></span>
          <span className="truncate text-[12.5px] text-text-2" data-description="">{row.description || '—'}</span>
          <ChevronRight size={16} className="text-text-3" aria-hidden />
        </span>
        <span className="flex items-start gap-3 md:hidden">
          <StatusIcon look={look} word={row.status.word} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={name} size="xs" />
              <span className={who}>{name}</span>
            </span>
            {row.description && <span className="mt-0.5 block truncate text-[12px] text-text-3">{row.description}</span>}
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[12px] tabular-nums text-text-2">{when}</span>
              <TypePill row={row} />
            </span>
          </span>
          <ChevronRight size={16} className="mt-1.5 shrink-0 text-text-3" aria-hidden />
        </span>
      </button>
    </li>
  )
}

/** Rows still being read: the table's shape, never "no requests". */
export function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-surface p-3 shadow-1" aria-label="Reading the requests" data-skeleton="">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-2.5">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-36 rounded-full" />
          <Skeleton className="hidden h-3 flex-1 md:block" />
        </div>
      ))}
    </div>
  )
}
