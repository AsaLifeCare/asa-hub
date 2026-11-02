// The pieces every candidate section draws the same way: a read's line and the table head.
// The pill, the "could not read" lines, the empty note and "Not on file" are SSA's; the card, the label-over-value…
import { Loader2 } from 'lucide-react'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { UpdatedStamp } from '@/components/FreshnessStamp'
import {
  EmptyNote as SsaEmptyNote, None as SsaNone, Pill as SsaPill, WhyLines as SsaWhyLines,
} from '@/pages/features/ssaprofiles/SsaParts'
import { NOT_OPEN, notOpen, readRefusal } from './candidateModel'
import type { ReadState } from './useCandidateRead'

/** A part this reader may not see: said plainly, never as a failure. */
export function NotOpen() {
  return <p className="text-[12.5px] text-text-3" data-read="not-open">{NOT_OPEN}</p>
}

export const Pill = SsaPill
export const WhyLines = SsaWhyLines
export const EmptyNote = SsaEmptyNote
export const None = SsaNone

export const linkCls = 'text-primary hover:underline'

export const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'

// What a read has to say before its rows: reading, or why it did not answer.
export function ReadLine({ state, what, onRetry }: { state: ReadState<unknown>; what: string; onRetry: () => void }) {
  if (state.status === 'failed' && notOpen(state.error)) return <NotOpen />

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
