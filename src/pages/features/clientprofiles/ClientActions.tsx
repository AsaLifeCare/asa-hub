// Share and Actions on the top bar.
// Actions is an anchored menu: the section's own group first (Add client, Add medication, Add authorization, New…
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Share2 } from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { actionGroups, type ClientAsk, type ClientTab } from './clientModel'
import { useClientReader } from './clientViewer'

const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

export default function ClientActions({ tab, view, onAsk }: { tab: ClientTab; view: string; onAsk: (ask: ClientAsk) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const { mayWrite } = useClientReader()
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
      <button type="button" onClick={() => onAsk({ kind: 'share' })} aria-label="Share this client" data-share=""
        className={cn(BAR_BTN, 'w-11 justify-center px-0')}>
        <Share2 size={16} />
      </button>
      {mayWrite && <div ref={box} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={BAR_BTN}
          data-actions="">
          Actions <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-40 mt-2 w-[240px] rounded-[14px] border border-border bg-surface py-1.5 shadow-3">
            <ActionsMenu tab={tab} view={view} onPick={(ask) => { setOpen(false); onAsk(ask) }} />
          </div>
        )}
      </div>}
    </div>
  )
}

export function ActionsMenu({ tab, view, onPick }: { tab: ClientTab; view: string; onPick: (ask: ClientAsk) => void }) {
  const groups = actionGroups(tab, view)
  return (
    <div role="menu" aria-label="Actions" data-actions-menu="">
      {groups.map((g, i) => {
        const context = i === 0 && g.label !== 'Client management'
        return (
          <div key={g.label} className={cn(i > 0 && 'mt-1 border-t border-border pt-1')} data-group={g.label}>
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">{g.label}</p>
            {g.items.map((it) => (
              <button key={it.label} type="button" role="menuitem" onClick={() => onPick(it.ask)} data-action={it.ask.kind}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2">
                {context && <Plus size={14} className="text-text-3" />} {it.label}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
