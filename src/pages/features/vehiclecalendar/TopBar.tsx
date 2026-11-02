// The top bar: the app's name and the Eastern stamp of the read on the off-white card, Share and the Actions menu…
// Every action opens a mode of the one right panel.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { CarFront, ChevronDown, Loader2, Plus, RefreshCw, Settings2, Share2 } from 'lucide-react'
import { usePanelEscape } from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { PAGES, pageHref, type PageId, type Panel } from './vehicleCalendarModel'
import { BAR_BTN } from './parts'

export type MenuPowers = {
  canRequest: boolean
  /** why Request transport is not open, when it is not */
  requestWhy: string
  canEdit: boolean
}

export default function TopBar({ page, stamp, refreshing, powers, canSetup, onPanel, onReload }: {
  page: PageId
  stamp: string
  refreshing: boolean
  /** null until a board is held */
  powers: MenuPowers | null
  canSetup: boolean
  onPanel: (p: Panel) => void
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  usePanelEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const pick = (p: Panel) => { setOpen(false); onPanel(p) }
  const label = PAGES.find((p) => p.id === page)?.label ?? 'Calendar'

  return (
    <div className="mb-4 grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1 sm:p-4" data-top-bar="">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue"><CarFront size={20} /></span>
          <div className="min-w-0">
            <h1 className="font-display text-[18px] font-semibold leading-6 text-text-1">Transportation</h1>
            <p className="flex items-center gap-1.5 truncate text-[12px] text-text-3" data-stamp="">
              {refreshing && <Loader2 size={11} className="animate-spin" />}
              {stamp ? `As of ${stamp}` : 'All times Eastern Time'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" data-top-actions="">
          <button type="button" onClick={() => onPanel({ kind: 'share' })} aria-label="Share this page" data-share=""
            className={cn(BAR_BTN, 'w-11 justify-center px-0')}>
            <Share2 size={16} />
          </button>
          <div ref={box} className="relative">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={BAR_BTN} data-actions="">
              Actions <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <ActionsMenu label={label} powers={powers} canSetup={canSetup} onPick={pick}
                onReload={() => { setOpen(false); onReload() }} />
            )}
          </div>
        </div>
      </div>
      <nav aria-label="Transportation pages" className="scroll-thin flex gap-1 overflow-x-auto" data-tabs="">
        {PAGES.map((p) => (
          <NavLink key={p.id} to={pageHref(p.id)} data-tab={p.id} aria-current={p.id === page ? 'page' : undefined}
            className={cn('shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] transition-colors',
              p.id === page ? 'bg-primary-soft font-semibold text-primary' : 'text-text-2 hover:bg-surface-2')}>
            {p.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function ActionsMenu({ label, powers, canSetup, onPick, onReload }: {
  label: string
  powers: MenuPowers | null
  canSetup: boolean
  onPick: (p: Panel) => void
  onReload: () => void
}) {
  return (
    <div role="menu" aria-label="Actions" data-actions-menu=""
      className="absolute right-0 top-full z-40 mt-2 w-[260px] max-w-[calc(100vw-32px)] rounded-[14px] border border-border bg-surface py-1.5 shadow-3">
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-3">Transportation · {label}</p>
      {powers && (
        <MenuItem icon={<Plus size={14} />} label="Request transport" disabled={!powers.canRequest} title={powers.requestWhy}
          onClick={() => onPick({ kind: 'request' })} act="request" />
      )}
      {powers?.canEdit && <MenuItem icon={<Plus size={14} />} label="Add vehicle" onClick={() => onPick({ kind: 'vehicle-new' })} act="vehicle-new" />}
      {canSetup && <MenuItem icon={<Settings2 size={14} />} label="Setup" onClick={() => onPick({ kind: 'setup' })} act="setup" />}
      <div className="mt-1 border-t border-border pt-1">
        <MenuItem icon={<RefreshCw size={14} />} label="Read again" onClick={onReload} act="reload" />
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, disabled = false, title, act }: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  act: string
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} title={disabled ? title : undefined} data-action={act}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:bg-transparent">
      <span className="text-text-3">{icon}</span> {label}
    </button>
  )
}
