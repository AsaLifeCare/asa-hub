// The small pieces every Locations section draws the same way: the card, a read's line, a labelled value, a source…
import type { ReactNode } from 'react'
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { readRefusal, SOURCE_LABEL, type ShiftSource } from './locationModel'
import { UpdatedStamp } from '@/components/FreshnessStamp'
import type { ReadState } from './useLocation'

export const linkCls = 'text-primary hover:underline'

export function SectionCard({ title, sub, extra, children, className }: {
  title: string
  sub?: ReactNode
  extra?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
          {sub && <p className="mt-1 text-[12.5px] leading-5 text-text-3">{sub}</p>}
        </div>
        {extra && <div className="flex flex-wrap items-center gap-2">{extra}</div>}
      </div>
      {children}
    </section>
  )
}

export function RetryButton({ onRetry, busy, label = 'Try again' }: { onRetry: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" onClick={onRetry} disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
      <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {label}
    </button>
  )
}

// What a read has to say before its rows: reading, or why it did not answer.
export function ReadLine({ state, what, onRetry, stamp = true }: {
  state: ReadState<unknown>
  what: string
  onRetry: () => void
  /** the "Updated …" line once read; a section that draws none says only the reading and a failure */
  stamp?: boolean
}) {
  if (state.status === 'loading' || (state.status === 'idle')) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading {what}…
      </p>
    )
  }
  if (state.status === 'ready') {
    return stamp ? <UpdatedStamp at={state.updatedAt} refreshing={state.refreshing} className="mb-2" /> : null
  }
  if (state.status !== 'failed') return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read of ${what} failed: ${readRefusal(state.error)} What is shown is from the read before.`
        : `${what[0].toUpperCase()}${what.slice(1)} could not be read: ${readRefusal(state.error)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}

/** The mockup's label-over-value row. */
export function Pair({ label, children, last = false }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn('py-3', !last && 'border-b border-border')}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-1 break-words text-[13.5px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}

export function SourceBadge({ source }: { source: ShiftSource | '' }) {
  if (!source) return null
  return (
    <span data-source={source}
      className={cn('inline-flex whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] font-semibold',
        source === 'archive' ? 'bg-tint-lavender text-tint-fg-lavender' : 'bg-tint-blue text-tint-fg-blue')}>
      {SOURCE_LABEL[source]}
    </span>
  )
}

const SECONDARY = 'inline-flex h-10 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text-1 hover:bg-surface-2'
const PRIMARY = 'inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40'

/** The form's two presses: "Review draft" arms and shows what will be filed; the second press files it. */
export function DraftButtons({ armed, busy, disabled, label = 'Review draft', armedLabel, onPress, onDisarm, onCancel }: {
  armed: boolean
  busy: boolean
  disabled: boolean
  label?: string
  armedLabel: string
  onPress: () => void
  onDisarm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
      {armed
        ? <button type="button" onClick={onDisarm} className="text-[12.5px] text-text-3 hover:text-text-1">Keep editing</button>
        : <button type="button" onClick={onCancel} className={SECONDARY}>Cancel</button>}
      <button type="button" onClick={onPress} disabled={disabled || busy} data-press={armed ? 'file' : 'review'}
        className={cn(PRIMARY, armed ? 'bg-primary hover:bg-primary-hover' : 'bg-[var(--success)] hover:opacity-90')}>
        {busy && <Loader2 size={14} className="animate-spin" />}
        {armed ? armedLabel : label}
        {!armed && !busy && <ArrowRight size={14} />}
      </button>
    </div>
  )
}
