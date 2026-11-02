// The family switcher: the current family member with the Active pill, and an anchored list of every one with their…
// A listbox under the button, not a dialog; on a phone it rises as the panel's bottom sheet.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { ActivePill } from '@/pages/features/locations/HouseSwitcher'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { rosterLine, switcherFamilies, type RosterRow } from './familyModel'
import { prefetchFamily } from './familyReads'

export default function FamilySwitcher({ families, current, why, showInactive, onInactive, onPick }: {
  families: RosterRow[]
  current: RosterRow | null
  /** what the roster says it could not read */
  why: string[]
  showInactive: boolean
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
    <SwitcherList families={families} current={current?.key ?? ''} query={query} onQuery={setQuery} why={why}
      showInactive={showInactive} onInactive={onInactive} onPick={pick} />
  )

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-switcher=""
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[12px] border border-border bg-surface-2 px-3 text-left text-text-1 transition-colors hover:bg-surface-3 sm:w-[320px]">
        {current && <Avatar src={current.avatar} name={current.name} size="xs" />}
        <span className="clamp-1 min-w-0 flex-1 text-[14px] font-semibold">{current?.name ?? 'Choose a family member'}</span>
        {current && <ActivePill active={current.status === 'active'} />}
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Families & Guardians" title="Choose a family member">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[400px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}

export function SwitcherList({ families, current, query, onQuery, why, showInactive, onInactive, onPick }: {
  families: RosterRow[]
  current: string
  query: string
  onQuery: (q: string) => void
  why: string[]
  showInactive: boolean
  onInactive: (on: boolean) => void
  onPick: (key: string) => void
}) {
  const rows = switcherFamilies(families, query, showInactive)
  return (
    <div className="grid gap-3 pt-1" data-switcher-list="">
      <label className="flex items-center justify-end gap-2 text-[12.5px] font-medium text-text-2">
        <input type="checkbox" checked={showInactive} onChange={(e) => onInactive(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]"
          data-show-inactive="" />
        Show Inactive
      </label>
      <SearchInput value={query} onChange={onQuery} placeholder="Search family members…" />
      {why.length > 0 && (
        <ul className="grid gap-0.5 text-[12px] leading-4 text-text-3" data-roster-why="">{why.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      <ul role="listbox" aria-label="Family members" className="scroll-thin grid max-h-[360px] gap-1 overflow-y-auto">
        {rows.map((r) => {
          const on = r.key === current
          const line = rosterLine(r)
          return (
            <li key={r.key} role="option" aria-selected={on} data-family={r.key}>
              <button type="button" onClick={() => onPick(r.key)}
                onPointerEnter={() => prefetchFamily(r.key)} onFocus={() => prefetchFamily(r.key)}
                className={cn('flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors',
                  on ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
                <Avatar src={r.avatar} name={r.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13.5px] font-semibold text-text-1">{r.name}</span>
                  {line && <span className="clamp-1 block text-[11.5px] text-text-3">{line}</span>}
                </span>
                <ActivePill active={r.status === 'active'} />
                <Check size={15} className={cn('shrink-0 text-[var(--success)]', !on && 'invisible')} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-[12.5px] text-text-3">No family member matches.</li>}
      </ul>
    </div>
  )
}
