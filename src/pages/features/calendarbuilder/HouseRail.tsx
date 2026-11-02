/** The houses beside the calendar screen, the reader's own first, as the relay says; on a phone, one button. */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Home, Loader2, Lock, Search, X } from 'lucide-react'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { houseCode, houseShort, type House } from '@/pages/features/shifts/houseCalTypes'
import { houseTint, type RailSection } from './calendarScreen'

type RailProps = {
  sections: RailSection[]
  current: string
  onPick: (location: string) => void
  filter: string
  onFilter: (q: string) => void
  loading: boolean
  /** the rail door's own words when it could not be read */
  failed: string
  /** a foot note, e.g. that who manages each house could not be read */
  note?: ReactNode
  /** an entry above the houses (the Builder's "All houses · master grid") */
  top?: ReactNode
  /** unclaimed open shifts per house (/housecal/open); absent when that read failed */
  openBy?: Map<string, number> | null
  /** the amber draft pills; the relay sends counts only on houses this reader builds */
  showDrafts?: boolean
  /** the relay could not count the drafts: the reader's own houses say so, never none */
  draftsUnread?: boolean
  /** what the phone's button says when the open "house" is not one (the master grid) */
  currentLabel?: string
}

export default function HouseRail(props: RailProps) {
  const [sheet, setSheet] = useState(false)
  const label = props.currentLabel || (props.current ? houseShort(props.current) : 'Pick a house')
  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])
  return (
    <>
      {/* a phone: one sticky button, the list full screen */}
      <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}
        className="sticky top-0 z-20 flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-[13.5px] font-semibold text-text-1 shadow-1 sm:hidden">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={15} className="shrink-0 text-text-3" />
      </button>
      {sheet && (
        <div role="dialog" aria-modal="true" aria-label="Houses"
          className="fixed z-40 flex flex-col bg-bg px-4 pb-[env(safe-area-inset-bottom)] pt-[calc(0.75rem+env(safe-area-inset-top))] max-sm:inset-0 sm:hidden">
          <div className="flex items-center justify-between pb-1">
            <p className="text-[15px] font-semibold text-text-1">Houses</p>
            <button type="button" onClick={() => setSheet(false)} aria-label="Close the houses"
              className="grid h-9 w-9 place-items-center rounded-md text-text-2 hover:bg-surface-2">
              <X size={17} />
            </button>
          </div>
          <RailList {...props} onPick={(loc) => { setSheet(false); props.onPick(loc) }} onTop={() => setSheet(false)} />
        </div>
      )}
      <aside aria-label="Houses" className="hidden w-[240px] shrink-0 flex-col rounded-lg border border-border bg-surface shadow-1 sm:flex">
        <RailList {...props} />
      </aside>
    </>
  )
}

function RailList({
  sections, current, onPick, filter, onFilter, loading, failed, note, top, openBy, showDrafts = true, draftsUnread = false,
  onTop,
}: RailProps & { onTop?: () => void }) {
  return (
    <>
      <div className="relative m-2.5">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
        <input value={filter} onChange={(e) => onFilter(e.target.value)} placeholder="Filter houses by name or code…"
          aria-label="Filter houses"
          className="h-9 w-full rounded-full border border-border bg-surface-2 pl-8 pr-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 sm:max-h-[calc(100vh-260px)]">
        {top && <div onClickCapture={onTop}>{top}</div>}
        {loading && (
          <p className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-text-3">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </p>
        )}
        {failed && <p className="px-3 py-2 text-[12px] leading-5 text-text-3">{failed}</p>}
        {sections.map((s) => (
          <div key={s.title}>
            <p className="mx-2 mb-0.5 mt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-3">{s.title}</p>
            {s.houses.map((h) => (
              <RailRow key={h.location} house={h} mine={s.mine} active={current === h.location}
                open={openBy?.get(h.location) ?? 0} showDrafts={showDrafts}
                draftsUnread={draftsUnread && s.mine && Boolean(h.may_edit)} onPick={onPick} />
            ))}
          </div>
        ))}
        {!loading && !failed && sections.every((s) => s.houses.length === 0) && (
          <p className="px-3 py-4 text-center text-[12px] text-text-3">No houses match.</p>
        )}
        {note && <div className="px-3 py-2 text-[11.5px] leading-4 text-text-3">{note}</div>}
      </div>
    </>
  )
}

function RailRow({ house: h, mine, active, open, showDrafts, draftsUnread, onPick }: {
  house: House
  mine: boolean
  active: boolean
  open: number
  showDrafts: boolean
  draftsUnread: boolean
  onPick: (location: string) => void
}) {
  const managers = (h.managers?.length ? h.managers.join(', ') : h.manager) || 'no house manager named'
  const short = houseShort(h.location)
  const code = houseCode(h.location)
  const drafts = showDrafts && typeof h.drafts === 'number' ? h.drafts : 0
  return (
    <button type="button" onClick={() => onPick(h.location)} aria-current={active ? 'true' : undefined}
      title={h.location}
      className={cn('flex w-full flex-col gap-1 rounded-[10px] border px-2.5 py-2 text-left transition-colors',
        active ? 'border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-primary-soft' : 'border-transparent hover:bg-surface-2')}>
      <span className="flex w-full items-center gap-1.5 text-[13px] font-medium text-text-1">
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', TINT_BG[houseTint(h.location)])} />
        {mine ? <Home size={12} className="shrink-0 text-text-3" />
          : <Lock size={11} className="shrink-0 text-text-3" aria-label="read-only" />}
        <span className="min-w-0 truncate">{short}</span>
        {code && code !== short.toUpperCase() && (
          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-3">{code}</span>
        )}
      </span>
      <span className="clamp-1 text-[11px] text-text-3">
        {h.staff} staff · {managers}{!h.may_edit && ' · read-only'}
      </span>
      {(open > 0 || drafts > 0 || (showDrafts && draftsUnread)) && (
        <span className="flex flex-wrap gap-1">
          {open > 0 && (
            <span className="rounded-full bg-tint-danger px-2 text-[11px] font-medium text-tint-fg-danger">{open} open</span>
          )}
          {drafts > 0 && (
            <span className="rounded-full bg-tint-warning px-2 text-[11px] font-medium text-tint-fg-warning"
              title={`${drafts} drafted cell${drafts === 1 ? '' : 's'} not yet published`}>
              {drafts} draft
            </span>
          )}
          {showDrafts && draftsUnread && (
            <span className="rounded-full bg-tint-warning px-2 text-[11px] font-medium text-tint-fg-warning"
              title="The drafts could not be counted just now; this is not saying there are none">
              drafts —
            </span>
          )}
        </span>
      )}
    </button>
  )
}
