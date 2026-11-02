// The staff switcher: the current person with their status pill, and an anchored list of every staff member with a…
// A name two records share is listed and cannot be picked.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { switcherStaff, type RosterRow } from './staffModel'
import { StatusPill } from './StaffParts'

export type InactiveState = { on: boolean; reading: boolean; why: string }

export const AMBIGUOUS_WORDS = 'Two records share this name — resolve them in People first.'

export default function StaffSwitcher({ staff, current, inactive, onInactive, onPick }: {
  staff: RosterRow[]
  current: RosterRow | null
  inactive: InactiveState
  onInactive: (on: boolean) => void
  onPick: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const phone = useMediaQuery('(max-width: 639px)')
  const box = useRef<HTMLDivElement | null>(null)
  const close = () => setOpen(false)
  usePanelEscape(open && !phone, close)

  useEffect(() => {
    if (!open || phone) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, phone])

  const pick = (key: string) => {
    setOpen(false)
    setQuery('')
    onPick(key)
  }
  const list = (
    <SwitcherList staff={staff} current={current?.key ?? ''} query={query} onQuery={setQuery}
      inactive={inactive} onInactive={onInactive} onPick={pick} />
  )

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-switcher=""
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[12px] border border-border bg-surface-2 px-3 text-left text-text-1 transition-colors hover:bg-surface-3 sm:w-[320px]">
        {current && <Avatar src={current.avatar} name={current.name} size="xs" />}
        <span className="clamp-1 min-w-0 flex-1 text-[14px] font-semibold">{current?.name ?? 'Choose a staff member'}</span>
        {current && <StatusPill status={current.status} />}
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Staff" title="Choose a staff member">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[400px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}

export function SwitcherList({ staff, current, query, onQuery, inactive, onInactive, onPick }: {
  staff: RosterRow[]
  current: string
  query: string
  onQuery: (q: string) => void
  inactive: InactiveState
  onInactive: (on: boolean) => void
  onPick: (key: string) => void
}) {
  const rows = switcherStaff(staff, query, inactive.on)
  return (
    <div className="grid gap-3 pt-1" data-switcher-list="">
      <label className="flex items-center justify-end gap-2 text-[12.5px] font-medium text-text-2">
        {inactive.reading && <Loader2 size={13} className="animate-spin text-text-3" />}
        <input type="checkbox" checked={inactive.on} onChange={(e) => onInactive(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]"
          data-show-inactive="" />
        Show Inactive
      </label>
      <SearchInput value={query} onChange={onQuery} placeholder="Search staff…" />
      {inactive.on && inactive.why && <p className="text-[12px] leading-4 text-text-3" data-inactive-why="">{inactive.why}</p>}
      <ul role="listbox" aria-label="Staff" className="scroll-thin grid max-h-[360px] gap-1 overflow-y-auto">
        {rows.map((r) => {
          const on = r.key === current
          return (
            <li key={r.key} role="option" aria-selected={on} aria-disabled={r.ambiguous || undefined} data-staff={r.key}>
              <button type="button" onClick={() => onPick(r.key)} disabled={r.ambiguous}
                title={r.ambiguous ? AMBIGUOUS_WORDS : undefined}
                className={cn('flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors disabled:cursor-not-allowed',
                  on ? 'bg-surface-2' : 'hover:bg-surface-2/70', r.ambiguous && 'opacity-60 hover:bg-transparent')}>
                <Avatar src={r.avatar} name={r.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13.5px] font-semibold text-text-1">{r.name}</span>
                  {r.ambiguous ? <span className="block text-[11.5px] text-text-3" data-ambiguous="">two records share this name</span>
                    : r.role && <span className="clamp-1 block text-[11.5px] text-text-3">{r.role}</span>}
                </span>
                <StatusPill status={r.status} />
                <Check size={15} className={cn('shrink-0 text-[var(--success)]', !on && 'invisible')} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-[12.5px] text-text-3">No staff member matches.</li>}
      </ul>
    </div>
  )
}
