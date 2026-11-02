// The pieces every Families section draws the same way: a read's line, what an answer says it could not read and an…
// The card, the label-over-value row and the retry button are Locations'.
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { UpdatedStamp } from '@/components/FreshnessStamp'
import { NOT_ON_FILE, readRefusal } from './familyModel'
import type { ReadState } from './useFamilyRead'

export const linkCls = 'text-primary hover:underline'

// What a read has to say before its rows: reading, or why it did not answer.
export function ReadLine({ state, what, onRetry }: { state: ReadState<unknown>; what: string; onRetry: () => void }) {
  const master = useEffectiveIsMaster()
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
      {state.data ? `The last read of ${what} failed: ${readRefusal(state.error, master)} What is shown is from the read before.`
        : `${what[0].toUpperCase()}${what.slice(1)} could not be read: ${readRefusal(state.error, master)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}

// What the answer says it could not read, one line per source — never taken for "nothing": a labelled banner when…
export function WhyLines({ why, degraded = false }: { why: string[]; degraded?: boolean }) {
  if (!why.length && !degraded) return null
  const lines = why.map((w) => <li key={w}>{w}</li>)
  if (degraded) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber" data-degraded="">
        <AlertTriangle size={14} className="mt-px shrink-0" />
        <div>
          <p className="font-semibold">Part of this could not be read. What is missing is not shown as empty.</p>
          {lines.length > 0 && <ul className="mt-1 grid gap-0.5" data-why="">{lines}</ul>}
        </div>
      </div>
    )
  }
  return <ul className="grid gap-1 text-[12px] leading-4 text-text-3" data-why="">{lines}</ul>
}

/** A plain sentence in a list's place. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div data-empty=""
      className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">
      {children}
    </div>
  )
}

/** "Not on file", quiet. */
export function None() {
  return <span className="text-text-3">{NOT_ON_FILE}</span>
}
