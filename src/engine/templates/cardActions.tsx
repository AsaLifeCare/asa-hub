// Shared card row actions — the ConfigAction quick buttons + ⋯ overflow menu that the kanban-style templates…
// Extracted from BoardTemplate so the pipeline renders the same vocabulary the same way instead of growing a second…
import { MoreHorizontal } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { actionVisible, type ConfigAction } from '@/engine/configActions'

export function CardActions<R>({
  rec,
  actions,
  onAction,
  canDo,
}: {
  rec: R
  actions: ConfigAction[]
  onAction: (a: ConfigAction, rec: R) => void
  canDo: (perm?: string) => boolean
}) {
  // `when` decides per card, right where the button would render — same rule the sheet applies to its row actions
  const visible = actions.filter((a) => actionVisible(a, rec))
  const quick = visible.filter((a) => a.quick)
  if (visible.length === 0) return null
  return (
    // hover-revealed like the grip — a permanent menu on every card is noise
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100">
      {quick.map((a) => {
        const blocked = !canDo(a.perm)
        return (
          <button
            key={a.id}
            aria-label={a.label}
            title={blocked ? `Requires ${a.perm} — ask an admin` : a.label}
            disabled={blocked}
            onClick={(e) => {
              e.stopPropagation()
              onAction(a, rec)
            }}
            className={cn(
              'grid h-6 w-6 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40',
              a.danger && 'text-danger hover:bg-tint-pink hover:text-danger',
            )}
          >
            <AppIcon name={a.icon ?? ''} size={13} />
          </button>
        )
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Card actions"
            onClick={(e) => e.stopPropagation()}
            className="grid h-6 w-6 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {visible.map((a) => {
            const blocked = !canDo(a.perm)
            return (
              <DropdownMenuItem
                key={a.id}
                disabled={blocked}
                title={blocked ? `Requires ${a.perm} — ask an admin` : undefined}
                className={cn(a.danger && 'text-danger focus:text-danger')}
                onClick={() => onAction(a, rec)}
              >
                <AppIcon name={a.icon ?? ''} size={14} /> {a.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
