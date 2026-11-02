// Share and Actions on the top bar.
// Actions is an anchored menu in three groups — Performance (New HR Issue, Add Note, Assign Training, File training…
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Share2, Star } from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { actionGroupsFor, type StaffAsk } from './staffModel'
import { useMyAsaOffered } from '@/lib/myAsaOffered'
import { useStaffViewer } from './staffViewer'

const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

export default function StaffActions({ staffKey, favorite, onAsk, onFavorite }: {
  staffKey: string
  favorite: boolean
  onAsk: (ask: StaffAsk) => void
  onFavorite: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const anyItem = useMenuGroups(staffKey).length > 0
  usePanelEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    // pinned right even when it wraps under the switcher, so the right-anchored menu opens inward on a phone
    <div className="ml-auto flex items-center gap-2">
      <button type="button" onClick={() => onAsk({ kind: 'share' })} aria-label="Share this staff member" data-share=""
        className={cn(BAR_BTN, 'w-11 justify-center px-0')}>
        <Share2 size={16} />
      </button>
      {anyItem && <div ref={box} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={BAR_BTN}
          data-actions="">
          Actions <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-40 mt-2 w-[260px] rounded-[14px] border border-border bg-surface py-1.5 shadow-3">
            <ActionsMenu staffKey={staffKey} favorite={favorite}
              onPick={(ask) => { setOpen(false); onAsk(ask) }}
              onFavorite={() => { setOpen(false); onFavorite() }} />
          </div>
        )}
      </div>}
    </div>
  )
}

/** The viewer's groups; the favorite is a bookmark, so it leaves with Bookmarks (lib/myAsaOffered). */
function useMenuGroups(staffKey: string) {
  const groups = actionGroupsFor(useStaffViewer(), staffKey)
  const offered = useMyAsaOffered()
  if (offered) return groups
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => 'ask' in i) })).filter((g) => g.items.length > 0)
}

export function ActionsMenu({ staffKey = '', favorite, onPick, onFavorite }: {
  staffKey?: string
  favorite: boolean
  onPick: (ask: StaffAsk) => void
  onFavorite: () => void
}) {
  const groups = useMenuGroups(staffKey)
  return (
    <div role="menu" aria-label="Actions" data-actions-menu="">
      {groups.map((g, i) => (
        <div key={g.label} className={cn(i > 0 && 'mt-1 border-t border-border pt-1')} data-group={g.label}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">{g.label}</p>
          {g.items.map((it) => ('ask' in it ? (
            <button key={it.label} type="button" role="menuitem" onClick={() => onPick(it.ask)} data-action={it.ask.kind}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2">
              <Plus size={14} className="text-text-3" /> {it.label}
            </button>
          ) : (
            <button key={it.label} type="button" role="menuitem" onClick={onFavorite} data-action="favorite" aria-pressed={favorite}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2">
              <Star size={14} className={favorite ? 'fill-current text-[var(--warning)]' : 'text-text-3'} />
              {favorite ? 'Remove from favorites' : it.label}
            </button>
          )))}
        </div>
      ))}
    </div>
  )
}
