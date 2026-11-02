// Share and Actions on the top bar.
// Actions is an anchored menu — House Notes, New Incident, New House Repair — and every item, like Share, opens a…
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Share2 } from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { actionGroupsFor, type PanelAsk } from './locationModel'
import { useLocationViewer, viewerCan } from './useLocation'

const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

export default function LocationActions({ onAsk }: { onAsk: (ask: PanelAsk) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const viewer = useLocationViewer()
  // Actions files, so it stands only for a viewer who makes one of its items' editions
  const writes = actionGroupsFor((e) => viewerCan(viewer, e)).length > 0
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
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onAsk({ kind: 'share' })} aria-label="Share this location" data-share=""
        className={cn(BAR_BTN, 'w-11 justify-center px-0')}>
        <Share2 size={16} />
      </button>
      {writes && <div ref={box} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={BAR_BTN}
          data-actions="">
          Actions <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-40 mt-2 w-[240px] rounded-[14px] border border-border bg-surface py-1.5 shadow-3">
            <ActionsMenu onPick={(ask) => { setOpen(false); onAsk(ask) }} />
          </div>
        )}
      </div>}
    </div>
  )
}

export function ActionsMenu({ onPick }: { onPick: (ask: PanelAsk) => void }) {
  const viewer = useLocationViewer()
  return (
    <div role="menu" aria-label="Actions" data-actions-menu="">
      {actionGroupsFor((e) => viewerCan(viewer, e)).map((g, i) => (
        <div key={g.label} className={cn(i > 0 && 'mt-1 border-t border-border pt-1')}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">{g.label}</p>
          {g.items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => onPick(it.ask)} data-action={it.ask.kind}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2">
              <Plus size={14} className="text-text-3" /> {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
