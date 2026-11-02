// The Hiring Pipeline's Views chooser — the Clients pattern, duplicated on purpose (each app owns its own chrome; a…
// THE MERGE made it the SWITCHER the unified page is built around: it lists the views the master allows, marks the…
import { useEffect, useState } from 'react'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HIRING_VIEWS, pickHiringView, useHiringViewsStore, type HiringViewId } from '@/stores/useHiringViewsStore'
import { useHiringPolicyStore } from '@/stores/useHiringPolicyStore'

export function HiringViewsChooser({ offeredIds, active: activeProp, onPick }: {
  offeredIds?: string[]
  // The view actually ON SCREEN — the page owns it, so the label and the body can never disagree about what is…
  active?: HiringViewId
  onPick?: (id: HiringViewId) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = useHiringViewsStore((s) => s.selected)
  const setSelected = useHiringViewsStore((s) => s.setSelected)
  const masterViews = useHiringPolicyStore((s) => s.views)
  const ensure = useHiringPolicyStore((s) => s.ensure)
  useEffect(() => { ensure() }, [ensure])
  // WHEN THE PAGE HANDS A LIST, THE PAGE IS THE AUTHORITY.
  const offered = offeredIds
    ? HIRING_VIEWS.filter((v) => offeredIds.includes(v.id))
    : HIRING_VIEWS.filter((v) => masterViews.includes(v.id))
  if (offered.length === 0) return null
  const active = activeProp ?? pickHiringView(selected, offered.map((v) => v.id))
  const choose = onPick ?? setSelected
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Switch among the Hiring views — in place, yours alone"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
      >
        <Settings2 size={14} />
        Views
        <span className="text-text-3">·</span>
        <span className="text-text-1">{HIRING_VIEWS.find((v) => v.id === active)?.label}</span>
        <ChevronDown size={13} className={cn('text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-border bg-surface p-1 shadow-2">
          {offered.map((v) => (
            <button
              key={v.id}
              onClick={() => { choose(v.id); setOpen(false) }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] text-text-1 hover:bg-surface-2',
                v.id === active && 'font-semibold',
              )}
            >
              {v.label}
              {v.id === active && <Check size={14} className="text-primary" />}
            </button>
          ))}
          {/* The explaining paragraph is gone: a menu of eight words does
              not need a
              sentence telling somebody that picking one shows it. */}
        </div>
      )}
    </div>
  )
}
