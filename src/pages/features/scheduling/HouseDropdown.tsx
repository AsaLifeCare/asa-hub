// The house dropdown at the left of the top bar: the house as the Calendar Builder rail names it (tint dot, short…
// A listbox under the button, not a dialog; on a phone it rises as the panel's bottom sheet.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Home } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { useMediaQuery } from '@/hooks/use-mobile'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { houseTint } from '@/pages/features/calendarbuilder/calendarScreen'
import { nameKey } from '@/pages/features/shifts/houseCalTypes'
import type { BoardHouse } from './schedulingModel'

const tintOf = (h: BoardHouse) => TINT_BG[houseTint(h.location || h.code)]

function OpenChip({ n }: { n: number }) {
  if (!n) return null
  return <span className="shrink-0 rounded-full bg-tint-danger px-2 text-[11px] font-medium text-tint-fg-danger">{n} open</span>
}

export default function HouseDropdown({ houses, current, onPick }: {
  houses: BoardHouse[]
  current: BoardHouse | null
  onPick: (code: string) => void
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

  const pick = (code: string) => {
    setOpen(false)
    setQuery('')
    onPick(code)
  }
  const list = <HouseList houses={houses} current={current?.code ?? ''} query={query} onQuery={setQuery} onPick={pick} />

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        data-house-dropdown=""
        className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3 text-left text-text-1 transition-colors hover:bg-surface-3 sm:w-[320px]">
        {current ? (
          <>
            <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', tintOf(current))} />
            <span className="clamp-1 min-w-0 flex-1 text-[14px] font-semibold">{current.short}</span>
            {current.code && current.code !== current.short.toUpperCase() && (
              <span className="shrink-0 font-mono text-[11px] text-text-3">{current.code}</span>
            )}
            <OpenChip n={current.open} />
          </>
        ) : (
          <>
            <Home size={14} className="shrink-0 text-text-3" />
            <span className="clamp-1 min-w-0 flex-1 text-[14px] font-semibold">Choose a house</span>
          </>
        )}
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Houses" title="Choose a house">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[400px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}

export function HouseList({ houses, current, query, onQuery, onPick }: {
  houses: BoardHouse[]
  current: string
  query: string
  onQuery: (q: string) => void
  onPick: (code: string) => void
}) {
  const q = nameKey(query)
  const rows = houses.filter((h) => !q || nameKey(`${h.short} ${h.code} ${h.location}`).includes(q))
  return (
    <div className="grid gap-3 pt-1" data-house-list="">
      {houses.length > 6 && <SearchInput value={query} onChange={onQuery} placeholder="Search houses…" />}
      <ul role="listbox" aria-label="Houses" className="scroll-thin grid max-h-[360px] gap-1 overflow-y-auto">
        {rows.map((h) => {
          const on = h.code === current
          const managers = h.managers.length ? h.managers.join(', ') : 'no house manager named'
          return (
            <li key={h.code} role="option" aria-selected={on} data-house={h.code}>
              <button type="button" onClick={() => onPick(h.code)} title={h.location}
                className={cn('flex w-full items-start gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors',
                  on ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
                <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', tintOf(h))} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold text-text-1">
                    <span className="min-w-0 truncate">{h.short}</span>
                    {h.code && h.code !== h.short.toUpperCase() && (
                      <span className="shrink-0 font-mono text-[10.5px] font-normal text-text-3">{h.code}</span>
                    )}
                  </span>
                  <span className="clamp-1 text-[11px] text-text-3">{h.staff} staff · {managers}</span>
                </span>
                <OpenChip n={h.open} />
                <Check size={15} className={cn('mt-0.5 shrink-0 text-[var(--success)]', !on && 'invisible')} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-[12.5px] text-text-3">No house matches.</li>}
      </ul>
    </div>
  )
}
