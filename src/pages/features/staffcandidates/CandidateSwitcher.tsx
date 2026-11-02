// The candidate switcher: the current candidate with their stage, and an anchored list of every candidate on the…
// A listbox under the button, not a dialog; on a phone it rises as the panel's bottom sheet.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SearchInput from '@/components/shared/SearchInput'
import SidePanel, { usePanelEscape } from '@/components/shared/SidePanel'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { ARCHIVED_META, rosterLine, stageMeta, switcherCandidates, type RosterRow } from './candidateModel'
import { prefetchCandidate } from './candidateReads'
import { Pill } from './CandidateParts'

export default function CandidateSwitcher({ candidates, current, onPick }: {
  candidates: RosterRow[]
  current: RosterRow | null
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
  const list = <SwitcherList candidates={candidates} current={current?.key ?? ''} query={query} onQuery={setQuery} onPick={pick} />

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-switcher=""
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[12px] border border-border bg-surface-2 px-3 text-left text-text-1 transition-colors hover:bg-surface-3 sm:w-[340px]">
        {current && <Avatar src={current.avatar} name={current.name} size="xs" />}
        <span className="clamp-1 min-w-0 flex-1 text-[14px] font-semibold">{current?.name ?? 'Choose a candidate'}</span>
        {current && <Pill meta={current.archived ? ARCHIVED_META : stageMeta(current.stage)} />}
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {phone ? (
        <SidePanel open={open} onClose={close} label="Candidate" title="Choose a candidate">{list}</SidePanel>
      ) : open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[420px] max-w-[calc(100vw-32px)] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          {list}
        </div>
      )}
    </div>
  )
}

export function SwitcherList({ candidates, current, query, onQuery, onPick }: {
  candidates: RosterRow[]
  current: string
  query: string
  onQuery: (q: string) => void
  onPick: (key: string) => void
}) {
  const rows = switcherCandidates(candidates, query)
  return (
    <div className="grid gap-3 pt-1" data-switcher-list="">
      <SearchInput value={query} onChange={onQuery} placeholder="Search candidates…" />
      <ul role="listbox" aria-label="Candidates" className="scroll-thin grid max-h-[360px] gap-1 overflow-y-auto">
        {rows.map((r) => {
          const on = r.key === current
          const line = rosterLine(r)
          return (
            <li key={r.key} role="option" aria-selected={on} data-candidate={r.key}>
              <button type="button" onClick={() => onPick(r.key)}
                onPointerEnter={() => prefetchCandidate(r.key)} onFocus={() => prefetchCandidate(r.key)}
                className={cn('flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors',
                  on ? 'bg-surface-2' : 'hover:bg-surface-2/70')}>
                <Avatar src={r.avatar} name={r.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13.5px] font-semibold text-text-1">{r.name}</span>
                  {line && <span className="clamp-1 block text-[11.5px] text-text-3">{line}</span>}
                </span>
                <Check size={15} className={cn('shrink-0 text-[var(--success)]', !on && 'invisible')} />
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-[12.5px] text-text-3">No candidate matches.</li>}
      </ul>
    </div>
  )
}
