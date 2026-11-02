// Shift Board · Cards — per-person shift summary cards (reference design a): round face (photo or tinted initials)…
// Search + ordering (name / shift count).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { motion } from 'framer-motion'
import { ArrowDownWideNarrow, ArrowUpRight } from 'lucide-react'
import type { ShiftCard } from '@/lib/seed-shifts2'
import { visits } from '@/lib/seed-expansion'
import { recordMatchesFocus, writePersonDrag } from '@/lib/focus'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { useContextStore } from '@/stores/useContextStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import type { TintName } from '@/engine/types'
import Avatar from '@/components/shared/Avatar'
import PageHeader from '@/components/shared/PageHeader'
import SearchInput from '@/components/shared/SearchInput'
import ContextBanner from '@/components/shared/ContextBanner'
import EmptyState from '@/components/shared/EmptyState'
import { kindChipClasses } from './shiftUi'
import { PUBLISHED_RING, publishedLine } from './publishedMark'
import ShiftPersonProfile from './ShiftPersonProfile'
import StaleRosterNote from './StaleRosterNote'
import ClockTimesToggle from './ClockTimesToggle'
import { useClockTimes } from './clockPref'
import { cellText } from './cellClock'
import { useUiPrefsStore } from '@/stores/useUiPrefsStore'
import { useShiftData, type MatrixCell } from './useShiftData'
import { cn } from '@/lib/utils'

type Ordering = 'az' | 'za' | 'most' | 'fewest'

const ORDER_OPTIONS: { id: Ordering; label: string }[] = [
  { id: 'az', label: 'Name A→Z' },
  { id: 'za', label: 'Name Z→A' },
  { id: 'most', label: 'Most shifts' },
  { id: 'fewest', label: 'Fewest shifts' },
]

const workedDays = (c: ShiftCard) => c.week.filter((w) => w.kind !== 'off' && w.kind !== 'ro').length

/* ---------- detail panel (standard shell panel + real upcoming shifts) ---------- */

function openCardDetail(card: ShiftCard, matrix: MatrixCell[]) {
  // "Next shift" counts from OHIO's today — the roster is Ohio's, so a reader abroad must not skip tonight's card.
  const todayISO = format(ohioWall(new Date()) as Date, 'yyyy-MM-dd')
  // The panel is opened by a click, not rendered by a hook, so the Time switch is read where the click happens.
  const clock = useUiPrefsStore.getState().calendarClockTimes
  const entries = matrix
    .filter(
      (m) => m.staffName === card.personName && m.date >= todayISO
        && m.kind !== 'off' && m.kind !== 'ro',
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12)
    .map((m, i) => ({
      time: format(new Date(`${m.date}T12:00:00`), 'EEE MMM d'),
      text: `${cellText(m.code, clock)} · ${m.houseName}`,
      tint: (['blue', 'mint', 'lavender', 'amber'] as TintName[])[i % 4],
    }))
  useDetailPanelStore.getState().openDetail({
    record: {
      ...card,
      role: 'Direct Support Pro',
      weekCodes: card.week.map((w) => `${w.day} · ${cellText(w.code, clock)}`),
    },
    config: {
      header: { avatar: 'avatar', title: 'personName', subtitle: 'role' },
      stats: [
        { label: 'Shifts (window)', value: card.totalShifts, icon: 'calendar-days', tint: 'blue' },
        { label: 'Houses', value: card.houseCount, icon: 'house', tint: 'mint' },
        { label: 'This week', value: `${workedDays(card)}/7`, icon: 'clock', tint: 'lavender' },
        { label: 'Next', value: cellText(card.next.code, clock), icon: 'arrow-right', tint: 'amber' },
      ],
      sections: [
        { kind: 'chips', title: 'This week (SAT → SUN)', itemsField: 'weekCodes', icon: 'calendar-days', tints: ['blue', 'mint', 'lavender', 'pink', 'amber', 'peach'] },
        ...(entries.length ? [{ kind: 'timeline', title: 'Upcoming shifts', entries } as const] : []),
      ],
      footer: [
        // deep-links back into this page (?profile=<cardId>) → full profile modal
        { label: 'Open full profile', variant: 'secondary', icon: 'arrow-up-right', href: `/app/calendarbuilder/cards?profile=${card.id}` },
      ],
    },
  })
}

/* ---------- card ---------- */

function ShiftCardTile({
  card,
  index,
  draggable,
  onOpen,
  onProfile,
}: {
  card: ShiftCard
  index: number
  draggable: boolean
  onOpen: () => void
  onProfile: () => void
}) {
  const worked = workedDays(card)
  const overflow = Math.max(0, card.totalShifts - worked)
  // The Time switch.
  const clock = useClockTimes()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.02, 0.3) }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group relative flex cursor-pointer flex-col rounded-lg border border-border bg-surface p-4 text-left shadow-1 transition-shadow duration-150 hover:shadow-2"
    >
      {/* native wrapper: framer's motion props shadow the HTML5 drag events */}
      <div
        draggable={draggable}
        onDragStart={(e) =>
          draggable &&
          writePersonDrag(e.dataTransfer, {
            type: 'staff',
            id: card.personId,
            name: card.personName,
            subtitle: 'Direct Support Pro',
          })
        }
        title={draggable ? 'Drag onto the top-left corner to focus the platform on this person' : undefined}
        className="flex min-w-0 flex-col"
      >
      {/* hover action row → full profile modal */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onProfile()
        }}
        aria-label={`Open full profile for ${card.personName}`}
        className="absolute right-2 top-2 flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] font-semibold text-text-2 opacity-0 shadow-1 transition-all duration-150 hover:bg-surface-2 hover:text-text-1 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <ArrowUpRight size={12} /> Full profile
      </button>
      <div className="flex items-center gap-3">
        {/* round, always — photo when we have one, tinted initials when not */}
        <Avatar src={card.avatar} name={card.personName} size="md" className="h-11 w-11 text-[15px]" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-text-1">{card.personName}</p>
          <p className="text-[12px] text-text-3">
            {card.totalShifts} shifts · {card.houseCount} houses
          </p>
        </div>
      </div>

      {/* week chips (SAT → SUN) + overflow */}
      <div className="mt-3.5 flex items-end gap-1">
        {card.week.map((w) => (
          <div key={w.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-text-3">{w.day}</span>
            <span
              className={cn(
                'w-full truncate rounded-sm px-0.5 py-1 text-center font-mono text-[9.5px] font-semibold leading-3',
                kindChipClasses(w.kind),
                w.published && PUBLISHED_RING,
              )}
              title={[`${w.day} · ${cellText(w.code, clock)}`, publishedLine(w.published)]
                .filter(Boolean).join('\n')}
            >
              {w.code}
            </span>
          </div>
        ))}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="text-[9px] text-transparent">·</span>
          <span className="rounded-sm bg-surface-2 px-1 py-1 font-mono text-[9.5px] font-semibold leading-3 text-text-2">
            +{overflow}
          </span>
        </div>
      </div>

      <p className="mt-3 border-t border-border pt-2.5 font-mono text-[11px] text-text-3">
        next: {card.next.date} · {cellText(card.next.code, clock)} · {card.next.houseCode}
      </p>
      </div>
    </motion.div>
  )
}

/* ---------- page ---------- */

export default function ShiftCardsPage({ embedded = false }: { embedded?: boolean }) {
  const [q, setQ] = useState('')
  const [order, setOrder] = useState<Ordering>('az')
  const [profileId, setProfileId] = useState<string | null>(null)
  const focus = useContextStore((s) => s.focus)
  const [searchParams, setSearchParams] = useSearchParams()
  const { cards, matrix, houses, loading, stale, error } = useShiftData()
  const dragEnabled = useDragFocusEnabled('shiftboard')

  // detail-panel footer deep-link: /app/calendarbuilder/cards?profile=<cardId> → open the full profile modal, close…
  useEffect(() => {
    const pid = searchParams.get('profile')
    if (pid && cards.some((c) => c.id === pid)) {
      setProfileId(pid)
      useDetailPanelStore.getState().closeDetail()
      const next = new URLSearchParams(searchParams)
      next.delete('profile')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, cards])

  const profileCard = profileId ? cards.find((c) => c.id === profileId) ?? null : null

  const focusFiltered = useMemo(() => {
    if (!focus) return { rows: cards, matched: false }
    if (focus.type === 'staff') {
      const rows = cards.filter(
        (c) => recordMatchesFocus(c.personName, focus) || recordMatchesFocus(c.personId, focus),
      )
      return { rows: rows.length ? rows : cards, matched: rows.length > 0 }
    }
    if (focus.type === 'client') {
      // link-resource scoping: staff with EVV visits for the focused client
      const staffNames = new Set(
        visits.filter((v) => recordMatchesFocus(v.client, focus)).map((v) => v.staff),
      )
      const rows = cards.filter((c) => staffNames.has(c.personName))
      return { rows: rows.length ? rows : cards, matched: rows.length > 0 }
    }
    return { rows: cards, matched: false }
  }, [focus, cards])

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    let rows = focusFiltered.rows
    if (query) rows = rows.filter((c) => c.personName.toLowerCase().includes(query))
    const sorted = [...rows]
    switch (order) {
      case 'az': sorted.sort((a, b) => a.personName.localeCompare(b.personName)); break
      case 'za': sorted.sort((a, b) => b.personName.localeCompare(a.personName)); break
      case 'most': sorted.sort((a, b) => b.totalShifts - a.totalShifts); break
      case 'fewest': sorted.sort((a, b) => a.totalShifts - b.totalShifts); break
    }
    return sorted
  }, [focusFiltered, q, order])

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Shift Cards"
          subtitle={`Per-person roster summaries · ${cards.length} staff · ${houses.length} houses`}
        />
      )}
      <ContextBanner filtered={focus ? focusFiltered.matched : undefined} />
      {stale && <StaleRosterNote />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search staff…" className="w-full sm:w-72" />
        <label className="flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-3">
          <ArrowDownWideNarrow size={14} className="shrink-0 text-text-3" />
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as Ordering)}
            className="bg-transparent text-[13px] text-text-1 outline-none"
            aria-label="Order cards"
          >
            {ORDER_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
        {/* the switch lives on every Shift Board tab — a card's week chips are
            too narrow to spell a range, but the choice must still be here to
            press and to undo, and it spells the lines that do have room */}
        <ClockTimesToggle className="rounded-sm" />
      </div>

      {error ? (
        <EmptyState title="The roster did not load" body={error} />
      ) : loading ? (
        <EmptyState title="Loading the roster…" body="Serving the latest schedule." />
      ) : visible.length === 0 ? (
        <EmptyState title="No matching staff" body="Try a different search or clear the person focus." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((card, i) => (
            <ShiftCardTile
              key={card.id}
              card={card}
              index={i}
              draggable={dragEnabled}
              onOpen={() => openCardDetail(card, matrix)}
              onProfile={() => setProfileId(card.id)}
            />
          ))}
        </div>
      )}

      <ShiftPersonProfile card={profileCard} onClose={() => setProfileId(null)} />
    </div>
  )
}
