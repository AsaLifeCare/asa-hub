// The pieces every Staff section draws the same way: the pill, a read's line, what an answer says it could not…
// The card, the pair and the two-press buttons are Locations'.
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, Pencil } from 'lucide-react'
import { UpdatedStamp } from '@/components/FreshnessStamp'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { useRecordNotesHidden } from '@/lib/stamps'
import { cn } from '@/lib/utils'
import {
  EDIT_SECTION_LABEL, NOT_ON_FILE, NOT_PUBLISHED, STATUS_META, isRefusal, readRefusal, type EditSection, type PillMeta,
  type PillTint, type StaffAsk, type StaffStatus,
} from './staffModel'
import type { ReadState } from './useStaffRead'

export const linkCls = 'text-primary hover:underline'

/** The pencil on a section card, or on one line of it (`id`, drawn as the icon alone): its record edit, in the right panel. */
export function EditPencil({ section, id, label, onAsk }: {
  section: EditSection
  id?: string
  /** the line's own words, for the button's name */
  label?: string
  onAsk: (ask: StaffAsk) => void
}) {
  if (id) {
    return (
      <button type="button" onClick={() => onAsk({ kind: 'edit', section, id })} data-edit-section={section} data-edit-id={id}
        aria-label={`Edit ${EDIT_SECTION_LABEL[section]} ${label || id}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 hover:bg-primary-soft hover:text-primary">
        <Pencil size={13} />
      </button>
    )
  }
  return (
    <button type="button" onClick={() => onAsk({ kind: 'edit', section })} data-edit-section={section}
      aria-label={`Edit ${EDIT_SECTION_LABEL[section]}`} title={`Edit ${EDIT_SECTION_LABEL[section]}`}
      className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
      <Pencil size={14} />
    </button>
  )
}

const PILL: Record<PillTint, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  amber: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-danger text-tint-fg-danger',
  slate: 'bg-tint-slate text-tint-fg-slate',
  blue: 'bg-tint-blue text-tint-fg-blue',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
}

export function Pill({ meta, className }: { meta: PillMeta; className?: string }) {
  return (
    <span data-pill={meta.label}
      className={cn('inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', PILL[meta.tint], className)}>
      {meta.label}
    </span>
  )
}

export const StatusPill = ({ status }: { status: StaffStatus }) => <Pill meta={STATUS_META[status]} />

// What a read has to say before its rows: reading, or why it did not answer.
export function ReadLine({ state, what, onRetry }: { state: ReadState<unknown>; what: string; onRetry: () => void }) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading {what}…
      </p>
    )
  }
  if (state.status === 'ready') return <UpdatedStamp at={state.updatedAt} refreshing={state.refreshing} />
  if (state.status !== 'failed') return null
  // a part this viewer may not see is said plainly, never as a failure to retry
  if (!state.data && isRefusal(state.error)) {
    return <p className="text-[12.5px] leading-5 text-text-3" data-read="refused">{NOT_PUBLISHED}</p>
  }
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read of ${what} failed: ${readRefusal(state.error)} What is shown is from the read before.`
        : `${what[0].toUpperCase()}${what.slice(1)} could not be read: ${readRefusal(state.error)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}

// What the answer says it could not read: a labelled banner when part of it is missing, a quiet line otherwise…
export function WhyNote({ why, degraded = false, said = false }: { why: string; degraded?: boolean; said?: boolean }) {
  const notesHidden = useRecordNotesHidden() && !said
  if (!why && !degraded) return null
  if (degraded) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber" data-degraded="">
        <AlertTriangle size={14} className="mt-px shrink-0" />
        <p><strong>Part of this could not be read.</strong>{why ? ` ${why}` : ''} What is missing is not shown as empty.</p>
      </div>
    )
  }
  if (notesHidden) return null
  return <p className="text-[12px] leading-4 text-text-3" data-why="">{why}</p>
}

/** A plain sentence in a list's place: an empty list, or what the platform does not hold. */
export function EmptyNote({ children, kind = 'empty' }: { children: ReactNode; kind?: 'empty' | 'missing' }) {
  return (
    <div data-empty={kind}
      className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">
      {children}
    </div>
  )
}

/** "Not on file", quiet. */
export function None() {
  return <span className="text-text-3">{NOT_ON_FILE}</span>
}

/** The mockup's label-over-value cell, in a two-column grid. */
export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-b border-border py-3" data-cell={label}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-1 break-words text-[13.5px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}

export function CellGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 sm:grid-cols-2">{children}</dl>
}

/** A masked value: never more than the mask the answer sent. */
export function Masked({ value }: { value: string }) {
  return value ? <span className="font-mono tracking-wide" data-masked="">{value}</span> : <None />
}
