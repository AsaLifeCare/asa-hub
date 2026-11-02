// Share and Actions on the top bar.
// Actions is an anchored menu in three groups — Details (Edit details), Activity (Add note, Schedule call) and…
import { useEffect, useRef, useState } from 'react'
import {
  CalendarClock, ChevronDown, FilePlus2, NotebookPen, Pencil, Share2, TriangleAlert, UserPlus, type LucideIcon,
} from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { CAN_ALL, CAN_NONE, actionGroups, canAny, type FamilyAsk, type FamilyCan, type FamilyClient, type MenuItem } from './familyModel'

const BAR_BTN = 'inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2'
const ITEM = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'

const ICON: Record<MenuItem['id'], LucideIcon> = {
  create: UserPlus, edit: Pencil, doc: FilePlus2, note: NotebookPen, call: CalendarClock, incident: TriangleAlert,
}

export default function FamilyActions({ clients, writes, can, onAsk }: {
  /** the associated clients once the overview is read; null while it is read */
  clients: FamilyClient[] | null
  /** the master's session: every write */
  writes: boolean
  /** the writes this viewer makes (the master's, or a holder's editions); every one for `writes` when not said */
  can?: FamilyCan
  onAsk: (ask: FamilyAsk) => void
}) {
  const allowed = can ?? (writes ? CAN_ALL : CAN_NONE)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
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
      <button type="button" onClick={() => onAsk({ kind: 'share' })} aria-label="Share this family member" data-share=""
        className={cn(BAR_BTN, 'w-11 justify-center px-0')}>
        <Share2 size={16} />
      </button>
      {canAny(allowed) && (
        <div ref={box} className="relative">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={BAR_BTN}
            data-actions="">
            Actions <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-40 mt-2 w-[250px] rounded-[14px] border border-border bg-surface py-1.5 shadow-3">
              <ActionsMenu clients={clients} can={allowed} onPick={(ask) => { setOpen(false); onAsk(ask) }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ActionsMenu({ clients, can, onPick }: {
  clients: FamilyClient[] | null
  can?: FamilyCan
  onPick: (ask: FamilyAsk) => void
}) {
  return (
    <div role="menu" aria-label="Actions" data-actions-menu="">
      {actionGroups(clients, can).map((g, i) => (
        <div key={g.label} className={cn(i > 0 && 'mt-1 border-t border-border pt-1')} data-group={g.label}>
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">{g.label}</p>
          {g.items.map((it) => {
            const Icon = ICON[it.id]
            return (
              <button key={it.id} type="button" role="menuitem" disabled={!!it.why} title={it.why || undefined}
                aria-disabled={it.why ? true : undefined} onClick={() => onPick(it.ask)} data-action={it.id} className={ITEM}>
                <Icon size={14} className="text-text-3" /> {it.label}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
