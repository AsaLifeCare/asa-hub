/** The freshness stamps every app draws, gated once by Settings › My Work's stamps switch (lib/stamps). */
import { Loader2 } from 'lucide-react'
import { useStampsHidden } from '@/lib/stamps'
import { ohioTime } from '@/lib/ohio'
import { updatedWords } from '@/pages/features/locations/locationLanes'

/** "Updated 4 min ago" under a record read; nothing without a stamp. */
export function UpdatedStamp({ at, refreshing, className = '' }: { at?: string | null; refreshing?: boolean; className?: string }) {
  const hidden = useStampsHidden()
  const age = updatedWords(at ?? '')
  if (hidden || !age) return null
  return (
    <p className={`${className} flex items-center gap-1.5 text-[11.5px] text-text-3`.trim()} data-read="updated">
      {refreshing && <Loader2 size={11} className="animate-spin" />}
      Updated {age}{refreshing ? ' · refreshing' : ''}
    </p>
  )
}

/** "Read <Ohio time>" at the foot of a My page; nothing before the first read. */
export function ReadStamp({ at, kept = false }: { at: number; kept?: boolean }) {
  const hidden = useStampsHidden()
  // a kept copy not read again always says how old it is, whatever the stamps switch says
  if (kept) return <p className="mt-3 text-[11.5px] text-text-3" data-stamp="kept">{keptWords(at)}</p>
  if (hidden || !(at > 0)) return null
  return <p className="mt-3 text-[11.5px] text-text-3" data-stamp="read">Read {ohioTime(new Date(at))}</p>
}

/** How a kept copy not read again since is said. */
export function keptWords(at: number): string {
  return at > 0 ? `Kept copy read ${ohioTime(new Date(at))} — not read again yet` : 'Kept copy — not read again yet'
}
