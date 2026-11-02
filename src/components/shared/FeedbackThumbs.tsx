// FeedbackThumbs — the platform's one thumbs control, for anything worth an opinion: a document, a video, a…
// A thumb is only worth collecting if you can say WHO, WHEN and on WHAT, so the vote carries the item's kind, id…
import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { cn } from '@/lib/utils'

export type FeedbackConfig = {
  /** what family of thing this is — 'doc' | 'video' | 'project' | 'isp' | … */
  itemKind: string
  /** row field holding the display title (tables); ignored when itemTitle is passed */
  titleKey?: string
  /** row field holding the grouping/collection, when there is one */
  collectionKey?: string
}

export default function FeedbackThumbs({
  itemKind,
  itemId,
  itemTitle,
  collection,
  size = 14,
  className,
}: {
  itemKind: string
  itemId: string
  itemTitle: string
  collection?: string
  size?: number
  className?: string
}) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)

  const send = (value: 'up' | 'down') => {
    setVote((v) => (v === value ? null : value))
    if (useApiConfigStore.getState().driver !== 'apps-script') return
    void gasAction('docFeedback', {
      doc_id: itemId,
      doc_title: itemTitle,
      collection: collection ?? '',
      item_kind: itemKind,
      vote: value,
    }).catch(() => {})
  }

  const btn = (value: 'up' | 'down', Icon: typeof ThumbsUp, label: string, activeCls: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={vote === value}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        send(value)
      }}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors duration-150 hover:bg-surface-3',
        vote === value && activeCls,
      )}
    >
      <Icon size={size} />
    </button>
  )

  return (
    <span className={cn('flex items-center', className)} onClick={(e) => e.stopPropagation()}>
      {btn('up', ThumbsUp, `Mark "${itemTitle}" as useful`, 'text-tint-fg-mint')}
      {btn('down', ThumbsDown, `Mark "${itemTitle}" as not useful`, 'text-tint-fg-pink')}
    </span>
  )
}
