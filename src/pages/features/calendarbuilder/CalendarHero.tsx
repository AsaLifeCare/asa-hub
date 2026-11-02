/** The black band over the calendar screen: the house, its manager, the view switch, the tiles and the live strip. */
import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { ohioTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import type { CalendarView } from '@/stores/useUiPrefsStore'
import { houseCode, houseShort, type OpenShift } from '@/pages/features/shifts/houseCalTypes'
import { countdown, dayLabel } from '@/pages/features/shifts/requestsLogic'
import type { Tile } from './calendarScreen'
import { useNowTick } from './useNowTick'

export type HeroSwitch = { shown: boolean; enabled: boolean; why: string; drafts: number | null; draftsUnread?: boolean }

export type HeroStrip = {
  /** the live stream is heard now */
  heard: boolean
  /** when the house was last read (ISO) */
  readAt: string
  /** test mode holds roster writes: on, or unreadable (which holds too) */
  testMode: 'on' | 'unreadable' | null
  /** Live, an editor: the Builder's unpublished cells at this house, or 'unread' when they could not be counted */
  draftsHere?: number | 'unread' | null
  /** Builder: transfers waiting on this reader's answer; null when they could not be read */
  transfersWaiting?: number | null
}

export default function CalendarHero({
  view, house, managerText, managerWhy, access, switcher, onView, tiles, onTile, across, onAcross, strip,
  nowMs, ticking = false, today = '', eyebrow, title,
}: {
  view: CalendarView
  /** the open house's full location, or '' before one is open */
  house: string
  /** the Builder's master grid says its own eyebrow and name instead of a house's */
  eyebrow?: string
  title?: string
  /** "Jane Doe", "Jane Doe and Ann Roe", or the relay's sentence when nobody is named; '' before the house is read */
  managerText: string
  managerWhy?: string
  /** the relay's answer for this house; null before a grid arrives */
  access: { edit: boolean; why: string } | null
  switcher: HeroSwitch
  onView: (view: CalendarView) => void
  /** the tiles, or a function of the clock when their captions count down */
  tiles: Tile[] | ((nowMs: number) => Tile[])
  onTile: (id: string) => void
  /** the lists behind the "across your houses" lines, keyed by tile id */
  across?: Record<string, OpenShift[]>
  onAcross?: (shift: OpenShift) => void
  strip: HeroStrip
  /** a fixed clock (tests); otherwise the band keeps its own, ticking each second while `ticking` */
  nowMs?: number
  ticking?: boolean
  today?: string
}) {
  const ticked = useNowTick(ticking)
  const now = nowMs ?? ticked
  const drawn = typeof tiles === 'function' ? tiles(now) : tiles
  const short = house ? houseShort(house) : ''
  const code = house ? houseCode(house) : ''
  const draftEyebrow = `Builder · draft of ${short || 'this house'}: nobody sees these changes until you publish`
  return (
    <section aria-label="Summary" className="mb-4 rounded-[16px] bg-detail-hero p-5 text-white shadow-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: view === 'build' ? heroBand('amber') : 'rgba(255,255,255,.45)' }}>
            {eyebrow ?? (view === 'build' ? draftEyebrow : 'Live · the roster as it is now')}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5 text-[20px] font-medium leading-tight">
            {title ?? (short || 'No house open')}
            {!title && code && code !== short.toUpperCase() && <span className="font-mono text-[13px] text-white/55">{code}</span>}
          </p>
          {house && !title && (managerText || access) && (
            <p className="mt-0.5 text-[13px] text-white/60">
              {managerText && <span title={managerWhy || undefined}>House manager: {managerText}</span>}
              {access && (
                <span>
                  {managerText ? ' · ' : ''}{access.edit ? 'You edit this calendar' : 'Read-only'}
                </span>
              )}
            </p>
          )}
          {/* why they edit or only read, in words a phone shows too */}
          {house && !title && access?.why && (
            <p className="mt-0.5 max-w-[640px] text-[12px] leading-4 text-white/45">{access.why}</p>
          )}
        </div>
        {switcher.shown && (
          <div role="group" aria-label="View" className="flex w-full gap-[3px] self-start rounded-[12px] bg-white/[0.08] p-[3px] sm:inline-flex sm:w-auto">
            <button type="button" aria-pressed={view === 'live'} onClick={() => view !== 'live' && onView('live')}
              className={cn('inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium sm:flex-none',
                view === 'live' ? 'bg-white text-[#131c30]' : 'text-white/60 hover:text-white')}>
              <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: heroBand('mint') }} />
              Live
            </button>
            <button type="button" aria-pressed={view === 'build'} disabled={!switcher.enabled && view !== 'build'}
              title={switcher.enabled ? undefined : switcher.why}
              onClick={() => view !== 'build' && switcher.enabled && onView('build')}
              className={cn('inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none',
                view === 'build' ? 'bg-white text-[#131c30]' : 'text-white/60 hover:text-white')}>
              <Pencil aria-hidden size={12} /> Builder
              {switcher.drafts ? (
                <span className="rounded-full px-1.5 text-[11px] text-[#131c30]" style={{ background: heroBand('amber') }}>
                  {switcher.drafts} draft{switcher.drafts === 1 ? '' : 's'}
                </span>
              ) : switcher.draftsUnread ? (
                <span className="rounded-full px-1.5 text-[11px] text-[#131c30]" style={{ background: heroBand('amber') }}
                  title="The drafts here could not be counted just now; this is not saying there are none">
                  drafts —
                </span>
              ) : null}
            </button>
          </div>
        )}
      </div>

      {/* a phone scrolls the tiles sideways, two rows of two at a time */}
      <div className="mt-4 grid snap-x snap-mandatory auto-cols-[calc(50%-4px)] grid-flow-col grid-rows-2 gap-2 overflow-x-auto pb-1 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:grid-rows-none sm:overflow-visible sm:pb-0 xl:grid-cols-6 [&>*]:snap-start">
        {drawn.map((t) => (
          <HeroTile key={t.id} tile={t} onClick={() => onTile(t.id)}
            list={across?.[t.id]} onPick={onAcross} nowMs={now} today={today} />
        ))}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[12px]">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium',
          strip.heard ? 'bg-white/10 text-white/85' : 'bg-white/[0.06] text-white/55')}>
          <span aria-hidden className="h-[7px] w-[7px] rounded-full"
            style={{ background: strip.heard ? heroBand('mint') : heroBand('slate') }} />
          {strip.heard ? 'Following changes live' : 'Not hearing live changes right now'}
          {strip.readAt ? ` · read ${ohioTime(strip.readAt)}` : ''}
        </span>
        {strip.testMode && (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-medium" style={{ color: heroBand('amber') }}
            title={strip.testMode === 'unreadable' ? 'Test mode could not be read, so it holds' : undefined}>
            TEST MODE: roster writes are held
          </span>
        )}
        {view === 'live' && strip.draftsHere ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 font-medium"
            style={{ color: heroBand('amber') }}>
            {strip.draftsHere === 'unread'
              ? 'The drafts here could not be counted; this is not saying there are none'
              : `${strip.draftsHere} draft edit${strip.draftsHere === 1 ? '' : 's'} here ${strip.draftsHere === 1 ? 'is' : 'are'} NOT on the calendar`}
            {switcher.enabled && (
              <button type="button" onClick={() => onView('build')} className="underline underline-offset-2">→ Builder</button>
            )}
          </span>
        ) : null}
        {view === 'build' && strip.transfersWaiting ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 font-medium"
            style={{ color: heroBand('info') }}>
            {strip.transfersWaiting} transfer{strip.transfersWaiting === 1 ? ' needs' : 's need'} your answer
            <button type="button" onClick={() => onView('live')} className="underline underline-offset-2">→ Live</button>
          </span>
        ) : view === 'build' && strip.transfersWaiting === null ? (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 font-medium text-white/55">
            The transfers could not be read; this is not saying none wait
          </span>
        ) : null}
      </div>
    </section>
  )
}

function HeroTile({ tile, onClick, list, onPick, nowMs, today }: {
  tile: Tile
  onClick: () => void
  list?: OpenShift[]
  onPick?: (shift: OpenShift) => void
  nowMs: number
  today: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [open])
  const tone = tile.tone === 'bad' ? heroBand('danger') : tile.tone === 'warn' ? heroBand('amber') : undefined
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={onClick} title={tile.title}
        className="flex min-h-[78px] w-full min-w-0 flex-col gap-0.5 rounded-[12px] border border-white/[0.06] bg-white/[0.05] px-3 py-2.5 text-left outline-none transition-colors hover:border-white/25 focus-visible:ring-2 focus-visible:ring-white/40">
        <span className="text-[10.5px] uppercase tracking-[0.06em] text-white/55">{tile.label}</span>
        <span className="font-stat text-[24px] leading-tight text-white" style={tone ? { color: tone } : undefined}>
          {tile.value}
        </span>
        <span className="clamp-1 text-[12px] text-white/70">{tile.sub}</span>
      </button>
      {tile.sub2 && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="mt-1 px-1 text-left text-[12px] underline underline-offset-2" style={{ color: heroBand('info') }}>
          {tile.sub2}
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-[min(360px,90vw)] rounded-[12px] border border-border bg-surface p-2 text-text-1 shadow-3 max-sm:fixed max-sm:inset-x-4 max-sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-sm:top-auto max-sm:w-auto">
          <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">{tile.sub2}</p>
          {(list ?? []).length === 0 ? (
            <p className="px-2 py-1.5 text-[12.5px] text-text-3">Nothing waiting at your houses.</p>
          ) : (
            <ul className="grid gap-0.5">
              {(list ?? []).map((s) => (
                <li key={s.ref || s.key + s.location}>
                  <button type="button" onClick={() => { setOpen(false); onPick?.(s) }}
                    className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2">
                    <span className="min-w-0 truncate">
                      {houseShort(s.location)} · {dayLabel(s.col_iso, today)} · {s.code || s.raw}
                    </span>
                    <span className="shrink-0 rounded-full bg-tint-danger px-2 text-[11px] font-medium text-tint-fg-danger">
                      {acrossChip(s, nowMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** The one chip a row of the across-your-houses list carries: its state, the window left, and who applied. */
function acrossChip(s: OpenShift, nowMs: number): string {
  const who = `${s.applicants ?? 0} applied`
  const left = s.pool_state === 'open' && s.window?.closes_at ? countdown(s.window.closes_at, nowMs) : null
  const time = left && left.seconds > 0 ? ` · ${left.label} left` : ''
  if (s.pool_state === 'closed' || s.pool_state === 'manager_only') {
    return `${s.kind_of_open === 'call_off' ? 'call-off · ' : ''}closed · ${who}`
  }
  if (s.kind_of_open === 'call_off') return `call-off${time} · ${who}`
  if (s.window?.reserved) return `regulars only${time} · ${who}`
  return `open${time} · ${who}`
}
