/** The black band: who is off now and soon, what waits, what is scheduled; an unread figure is "—", never 0. */
import { motion } from 'framer-motion'
import { AlertTriangle, RotateCw } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { heroBand } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { alertLine, heroFigures, spanWords, type HeroEntry, type Scope, type TimeOffFeed } from './timeOffModel'

const EYEBROW: Record<Scope, string> = {
  refused: 'your own', own: 'your own', houses: 'your houses', all: 'the whole company',
}

const BANDS: { id: 'scheduled' | 'waiting' | 'review'; label: string; tint: 'mint' | 'amber' | 'slate' }[] = [
  { id: 'scheduled', label: 'Scheduled', tint: 'mint' },
  { id: 'waiting', label: 'Waiting', tint: 'amber' },
  { id: 'review', label: 'Needs review', tint: 'slate' },
]

function People({ title, entries, empty, onOpen }: {
  title: string; entries: HeroEntry[]; empty: string; onOpen: (ref: string) => void
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{title}</p>
      {entries.length ? (
        <ul className="mt-2 grid gap-1.5">
          {entries.slice(0, 6).map((e) => (
            <li key={e.ref}>
              <button type="button" onClick={() => onOpen(e.ref)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/40">
                <Avatar name={e.person} size="xs" ring />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/85">
                  {e.person} <span className="text-white/50">· {spanWords(e.start, e.end)}</span>
                </span>
                {e.houses.slice(0, 2).map((h) => (
                  <span key={h.code} className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/70">{h.label}</span>
                ))}
              </button>
            </li>
          ))}
          {entries.length > 6 && <li className="px-1 text-[11.5px] text-white/45">and {entries.length - 6} more</li>}
        </ul>
      ) : <p className="mt-2 text-[12px] text-white/50">{empty}</p>}
    </div>
  )
}

export default function TimeOffHero({ feed, failed, isAdmin, reachScope, compact, onOpen, onRetry }: {
  feed: TimeOffFeed | null
  failed: string
  isAdmin: boolean
  /** the SPA's own first guess, until the feed says whose rows these are */
  reachScope?: Scope
  compact?: boolean
  onOpen: (ref: string) => void
  onRetry: () => void
}) {
  const figures = heroFigures(feed)
  const red = failed && !feed
    ? 'Time off could not be read — this screen is not saying nobody is off.'
    : alertLine(feed, isAdmin)
  const bar = feed?.hero?.bar
  const total = bar ? bar.scheduled + bar.waiting + bar.review : 0
  const scope: Scope = feed?.me?.scope ?? reachScope ?? 'own'
  return (
    <section aria-label="Time off at a glance" aria-busy={!feed && !failed}
      className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
        Time off · {EYEBROW[scope] ?? 'your own'}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <p className="font-stat text-[34px] leading-none text-white">{f.value}</p>
            <p className="mt-1.5 text-[12px] font-medium text-white/80">{f.label}</p>
            {f.sub && <p className="mt-0.5 text-[11.5px] leading-[1.45] text-white/50">{f.sub}</p>}
          </div>
        ))}
      </div>

      {!compact && bar && (
        <div className="mt-6">
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
            {total > 0 && BANDS.map((b) => (bar[b.id] ? (
              <motion.span key={b.id} title={`${bar[b.id]} · ${b.label}`}
                initial={{ width: 0 }} animate={{ width: `${(bar[b.id] / total) * 100}%` }}
                transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
                className="h-full first:rounded-l-full last:rounded-r-full" style={{ background: heroBand(b.tint) }} />
            ) : null))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/65">
            {BANDS.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: heroBand(b.tint) }} />
                {b.label} <span className="font-stat text-white/90">{bar[b.id]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!compact && feed?.hero && (
        <div className="mt-6 grid gap-5 border-t border-white/10 pt-4 md:grid-cols-2">
          <People title="Off now" entries={feed.hero.off_now} empty="Nobody is off today." onOpen={onOpen} />
          <People title="Upcoming (14 days)" entries={feed.hero.upcoming} empty="Nothing starts in the next two weeks."
            onOpen={onOpen} />
        </div>
      )}

      {red && (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[12.5px] font-semibold leading-[1.5]"
          style={{ background: 'rgba(139,0,0,0.35)', color: heroBand('danger') }}>
          <AlertTriangle size={14} className="shrink-0" />
          <span>{red}</span>
          {failed && (
            <button type="button" onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white/85 hover:bg-white/15">
              <RotateCw size={11} /> Try again
            </button>
          )}
        </p>
      )}
      {failed && feed && (
        <p className="mt-2 text-[12px] leading-[1.55] text-white/60">
          The last read failed ({failed}) — these figures are from the read before it.
        </p>
      )}
    </section>
  )
}
