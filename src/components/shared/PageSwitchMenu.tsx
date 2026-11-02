/** One dropdown of an app's screens beside Refresh; the caller passes the allowed pages. Draws and navigates only. */
import { Fragment } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type SwitchItem = { id: string; title: string; group?: string }

/** Same size as the Refresh button beside it. */
export const SWITCH_CONTROL =
  'inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 ' +
  'text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2'

/** Items under their headings, in first-appearance order. */
export function groupItems(items: SwitchItem[]): { group: string; items: SwitchItem[] }[] {
  const out: { group: string; items: SwitchItem[] }[] = []
  for (const it of items) {
    const g = it.group ?? ''
    const at = out.find((x) => x.group === g)
    if (at) at.items.push(it)
    else out.push({ group: g, items: [it] })
  }
  return out
}

export default function PageSwitchMenu({ items, current, onPick, label = 'Go to another page of this app' }: {
  items: SwitchItem[]
  current: string
  onPick: (id: string) => void
  label?: string
}) {
  if (items.length < 2) return null
  const here = items.find((p) => p.id === current)
  const groups = groupItems(items)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={SWITCH_CONTROL} aria-label={label}>
          <span className="max-w-[9rem] truncate">{here?.title || 'Pages'}</span>
          <ChevronDown size={14} className="shrink-0 text-text-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] min-w-[13rem] overflow-y-auto">
        {groups.map((g, gi) => (
          <Fragment key={g.group || `g${gi}`}>
            {gi > 0 && <DropdownMenuSeparator />}
            {g.group && (
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                {g.group}
              </DropdownMenuLabel>
            )}
            {g.items.map((p) => {
              const active = p.id === current
              return (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => onPick(p.id)}
                  className={cn('gap-2 text-[13px]', active && 'text-primary')}
                >
                  {/* the tick keeps its column so titles line up */}
                  <Check size={13} className={cn('shrink-0', active ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{p.title}</span>
                </DropdownMenuItem>
              )
            })}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
