// The house switcher: the current house with its Active pill, and an anchored list of every house with its photo, a…
// A listbox under the button, not a dialog; on a phone it rises as the panel's bottom sheet.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import SafeImg from '@/components/shared/SafeImg'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { useMediaQuery } from '@/hooks/use-mobile'
import { photoThumb, type HouseRow } from '@/pages/features/houses/houseModel'
import { cn } from '@/lib/utils'
import { prefetchLocation, prefetchLocationNeighbours } from './locationReads'
import { switcherHouses } from './locationModel'

/** `dark` is accepted and ignored: every header is the platform surface now, and older callers still pass it. */
export function ActivePill({ active }: { active: boolean; dark?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
      active ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-3 text-text-3')}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

export default function HouseSwitcher({ houses, current, onPick }: {
  houses: HouseRow[]
  current: HouseRow | null
  onPick: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [inactive, setInactive] = useState(false)
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

  const pick = (code: string) => {
    setOpen(false)
    setQuery('')
    onPick(code)
  }
  const list = (
    <SwitcherList houses={houses} current={current?.code ?? ''} query={query} onQuery={setQuery}
      inactive={inactive} onInactive={setInactive} onPick={pick} />
  )

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => {
        if (!open && current) prefetchLocationNeighbours(current.code)
        setOpen(!open)
      }} aria-haspopup="listbox" aria-expanded={open}
        data-switcher=""
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[12px] border border-border bg-surface-2 px-3 text-left text-text-1 transition-colors hover:bg-surface-3 sm:w-[300px]">
        <span className="clamp-1 min-w-0 flex-1 text-[14px] font-semibold">{current?.title ?? 'Choose a house'}</span>
        {current && <ActivePill active={current.active} />}
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Locations" title="Choose a house">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[400px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}

export function SwitcherList({ houses, current, query, onQuery, inactive, onInactive, onPick }: {
  houses: HouseRow[]
  current: string
  query: string
  onQuery: (q: string) => void
  inactive: boolean
  onInactive: (on: boolean) => void
  onPick: (code: string) => void
}) {
  const rows = switcherHouses(houses, query, inactive)
  return (
    <div className="grid gap-3 pt-1" data-switcher-list="">
      <label className="flex items-center justify-end gap-2 text-[12.5px] font-medium text-text-2">
        <input type="checkbox" checked={inactive} onChange={(e) => onInactive(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]"
          data-show-inactive="" />
        Show Inactive
      </label>
      <SearchInput value={query} onChange={onQuery} placeholder="Search locations…" />
      <ul role="listbox" aria-label="Locations" className="scroll-thin grid max-h-[360px] gap-1 overflow-y-auto">
        {rows.map((h) => {
          const on = h.code === current
          return (
            <li key={h.code} role="option" aria-selected={on} data-house={h.code}>
              <button type="button" onClick={() => onPick(h.code)}
                onPointerEnter={() => prefetchLocation(h.code)} onFocus={() => prefetchLocation(h.code)}
                className={cn('flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors',
                  on ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
                <SafeImg src={h.photo?.src ? photoThumb(h.photo.src, 96) : ''} icon="house" shape="square" size={40} alt={h.title} />
                <span className="clamp-1 min-w-0 flex-1 text-[13.5px] font-semibold text-text-1">{h.title}</span>
                <ActivePill active={h.active} />
                <Check size={15} className={cn('shrink-0 text-[var(--success)]', !on && 'invisible')} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-[12.5px] text-text-3">No house matches.</li>}
      </ul>
    </div>
  )
}
