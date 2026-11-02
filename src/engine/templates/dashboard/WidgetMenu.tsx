/** Per-widget ⋯ menu: rename / tint / span / bookmark / CSV export / hide-remove (moved verbatim from DashboardTemplate.tsx). */
import {
  Download,
  EyeOff,
  MoreHorizontal,
  MoveHorizontal,
  Pencil,
  RotateCcw,
  Star,
} from 'lucide-react'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { bookmarkId, useBookmarksStore } from '@/stores/useBookmarksStore'
import { useMyAsaOffered } from '@/lib/myAsaOffered'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TintName } from '@/engine/types'
import { WIDGET_TINTS } from './utils'

export function WidgetMenu({
  w,
  isAdded,
  csv,
  pagePath,
  pageTitle,
  onRename,
  onTint,
  onSpan,
  onHide,
  onRemove,
}: {
  w: any
  isAdded: boolean
  csv?: string
  pagePath: string
  pageTitle: string
  onRename: () => void
  onTint: (t: TintName | undefined) => void
  onSpan: () => void
  onHide: () => void
  onRemove: () => void
}) {
  const refId = `${pagePath}::${w._id}`
  const bookmarked = useBookmarksStore((s) => s.bookmarks.some((b) => b.id === bookmarkId('widget', refId)))
  const toggleBookmark = useBookmarksStore((s) => s.toggle)
  const bookmarksOffered = useMyAsaOffered()

  const exportCsv = () => {
    if (!csv) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'asa-hub-export.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={`Options for ${w._title}`} className="grid h-7 w-7 place-items-center rounded-sm bg-surface/80 text-text-3 shadow-1 transition-colors hover:bg-surface-2 hover:text-text-1">
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onRename}><Pencil size={14} /> Rename</DropdownMenuItem>
        <div className="px-2 py-1.5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-3">Tint</div>
          <div className="flex items-center gap-1.5">
            {WIDGET_TINTS.map((t) => (
              <button
                key={t}
                aria-label={`Tint ${t}`}
                onClick={() => onTint(t)}
                className={cn(
                  'h-5 w-5 rounded-full border-2 transition-transform duration-100 hover:scale-110',
                  TINT_BG[t],
                  w._tint === t ? 'border-primary' : 'border-transparent',
                )}
              />
            ))}
            <button
              aria-label="Clear tint"
              title="Clear tint"
              onClick={() => onTint(undefined)}
              className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-border-strong text-text-3 hover:text-text-1"
            >
              <RotateCcw size={10} />
            </button>
          </div>
        </div>
        <DropdownMenuItem onClick={onSpan}>
          <MoveHorizontal size={14} /> {w._span === 2 ? 'Make 1× wide' : 'Make 2× wide'}
        </DropdownMenuItem>
        {bookmarksOffered && (
          <DropdownMenuItem
            onClick={() =>
              toggleBookmark({
                type: 'widget',
                refId,
                title: w._title,
                subtitle: pageTitle,
                tint: w._tint ?? 'blue',
                href: `${pagePath}#widget-${w._id}`,
              })
            }
          >
            <Star size={14} fill={bookmarked ? 'currentColor' : 'none'} className={bookmarked ? 'text-warning' : undefined} />
            {bookmarked ? 'Remove bookmark' : 'Bookmark'}
          </DropdownMenuItem>
        )}
        {csv && <DropdownMenuItem onClick={exportCsv}><Download size={14} /> Export CSV</DropdownMenuItem>}
        {isAdded ? (
          <DropdownMenuItem onClick={onRemove} className="text-danger"><EyeOff size={14} /> Remove widget</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onHide}><EyeOff size={14} /> Hide widget</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
