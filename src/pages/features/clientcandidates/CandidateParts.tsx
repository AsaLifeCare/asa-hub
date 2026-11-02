// The pieces every candidate section draws the same way: a read's line, the table head and the pill (SSA's, with…
// The "could not read" lines, the empty note and "Not on file" are SSA's; the card, the label-over-value row and…
import { Loader2, Pencil } from 'lucide-react'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { UpdatedStamp } from '@/components/FreshnessStamp'
import { cn } from '@/lib/utils'
import { NOT_OPEN, readRefusal, type PillMeta, type PillTint } from './candidateModel'
import type { ReadState } from './useCandidateRead'

export { EmptyNote, None, WhyLines, linkCls } from '@/pages/features/ssaprofiles/SsaParts'

/** A form reached by its address by a reader the writes are not open to. */
export function NotOpen() {
  return <p className="text-[12.5px] text-text-3" data-read="not-open">{NOT_OPEN}</p>
}

/** A section's pencil: opens the edition's panel. */
export function EditButton({ label, onClick, what }: { label: string; onClick: () => void; what: string }) {
  return (
    <button type="button" onClick={onClick} data-edit={what}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
      <Pencil size={13} /> {label}
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
  peach: 'bg-tint-peach text-tint-fg-peach',
  pink: 'bg-tint-pink text-tint-fg-pink',
}

export function Pill({ meta, className }: { meta: PillMeta; className?: string }) {
  return (
    <span data-pill={meta.label}
      className={cn('inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', PILL[meta.tint], className)}>
      {meta.label}
    </span>
  )
}

export const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

// What a read has to say before its rows: reading, or why it did not answer.
export function ReadLine({ state, what, onRetry }: { state: ReadState<unknown>; what: string; onRetry: () => void }) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading {what}…
      </p>
    )
  }
  if (state.status === 'ready') {
    return <UpdatedStamp at={state.updatedAt} refreshing={state.refreshing} />
  }
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read of ${what} failed: ${readRefusal(state.error)} What is shown is from the read before.`
        : `${what[0].toUpperCase()}${what.slice(1)} could not be read: ${readRefusal(state.error)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}
