// The pieces My Work, My Calendar and My Inbox share on a client-role account: the worded card for an account not…
import type { ReactNode } from 'react'
import { Link2, RefreshCw } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'
import {
  UNLINKED_BODY, UNLINKED_TITLE, sourceFailed, sourceLine, type FamilySource, type FamilyState,
} from './myFamily'

/** No key, no person — and never a guess. */
export function FamilyUnlinked({ why }: { why?: string }) {
  return (
    <div className="w-full pt-6" data-unlinked="">
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-amber text-tint-fg-amber">
          <Link2 size={22} />
        </span>
        <h2 className="font-display text-[17px] font-bold text-text-1">{UNLINKED_TITLE}</h2>
        <p className="max-w-[460px] text-[13px] leading-5 text-text-2">{UNLINKED_BODY}</p>
        {why && <p className="max-w-[460px] text-[12px] leading-5 text-text-3">{why}</p>}
      </Card>
    </div>
  )
}

export function FamilyRefused({ title, error }: { title: string; error: string }) {
  return (
    <div className="w-full pb-16">
      <EmptyState title={`${title} is not open here`} body={error} />
    </div>
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

/** Before the first answer: reading, or the read that failed — never an empty page. */
export function FamilyReadLine<T>({ state, reading, failed, onRetry }: {
  state: FamilyState<T>
  reading: string
  failed: string
  onRetry: () => void
}) {
  if (state.status === 'failed') {
    return (
      <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]">
          {failed}: {state.error || 'no answer'}. Nothing is shown rather than an empty page.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <p className="text-[12.5px] text-text-3">{reading}</p>
    </section>
  )
}

// A card with its source's sentence under the title when the source did not answer with rows.
export function SourceCard({ title, source, quietEmpty = false, children }: {
  title: string
  source: FamilySource | null | undefined
  quietEmpty?: boolean
  children?: ReactNode
}) {
  const bare = source?.state === 'empty' && !String(source.why ?? '').trim()
  const line = (source && source.state === 'ok') || (quietEmpty && bare) ? '' : sourceLine(source)
  return (
    <section aria-label={title} data-source={source?.key ?? ''} data-state={source?.state ?? 'unreadable'}
      className="rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6">
      <h2 className="mb-3 font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
      {line && (
        <p className={cn('mb-2 text-[12.5px] leading-5', sourceFailed(source) ? 'text-[var(--danger)]' : 'text-text-3')}>
          {line}
        </p>
      )}
      {children}
    </section>
  )
}
