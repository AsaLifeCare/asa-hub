// THE HERO — the two lines side by side on the one dark surface the kit keeps, what the last thirty days of calls…
// Every number is counted from the calls index on this screen.
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { HotlineSweep, LineKey } from './hotlineApi'
import type { HeroStats, IndexState } from './items'
import { relativeTime } from './join'
import { LINE, MODALITY } from './vocabulary'

const LINE_ORDER: LineKey[] = ['hotline', 'screening']

function sweepPart(sweep: HotlineSweep | null, indexState: IndexState, now: number): string {
  if (indexState === 'refused') return ''
  if (!sweep) {
    return indexState === 'live' ? 'Hotline sweep · the pass clock could not be read' : 'Hotline sweep · pass clock not read yet'
  }
  const at = Date.parse(sweep.at)
  if (!Number.isFinite(at)) return 'Hotline sweep · no pass on record since the app started'
  const ledger = sweep.from === 'cadence' ? ' (from the loop ledger — the app restarted since)' : ''
  return `Hotline sweep · last pass ${relativeTime(at, now)}${ledger}`
}

export default function HotlineHero({
  stats,
  now,
  sweep,
  lastLoggedMs,
  indexState,
  lineNotes,
  unavailable,
  quiet,
  problems,
  live = false,
}: {
  stats: HeroStats | null
  now: number
  sweep: HotlineSweep | null
  /** the newest processing-log line, or null */
  lastLoggedMs: number | null
  indexState: IndexState
  /** why a line shows no numbers, when it is not simply unread */
  lineNotes: Partial<Record<LineKey, string>>
  /** the sentence the mix says when there are no stats */
  unavailable: string
  /** calm facts about the reading, joined with a middle dot */
  quiet: string[]
  /** things that could not be read — each one a sentence */
  problems: string[]
  /** the relay's fast path is armed and this tab hears its live stream */
  live?: boolean
}) {
  const dash = '—'
  return (
    <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
      <div className="grid gap-5 md:grid-cols-2 md:gap-0">
        {LINE_ORDER.map((key, i) => {
          const l = stats?.lines[key] ?? null
          return (
            <div key={key} className={i === 1 ? 'min-w-0 md:border-l md:border-white/10 md:pl-6' : 'min-w-0 md:pr-6'}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: heroBand(LINE[key].heroTint) }} />
                <span className="font-stat text-[13px] text-white/90">{LINE[key].short}</span>
                <span className="truncate text-[12.5px] text-white/55">{LINE[key].label}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-7 gap-y-3">
                <div>
                  <p className="font-stat text-[44px] leading-none text-white">{l ? l.today.toLocaleString() : dash}</p>
                  <p className="mt-1.5 text-[11.5px] text-white/50">calls today</p>
                </div>
                <div>
                  <p className="font-stat text-[24px] leading-none text-white/85">{l ? l.week.toLocaleString() : dash}</p>
                  <p className="mt-1.5 text-[11.5px] text-white/50">last 7 days</p>
                </div>
                <div className="ml-auto min-w-0 text-right">
                  <p className="text-[13px] text-white/80">
                    {!l ? dash : l.lastMs !== null ? relativeTime(l.lastMs, now) : 'no call on record'}
                  </p>
                  <p className="mt-1 text-[11.5px] text-white/45">last call</p>
                </div>
              </div>
              {!l && lineNotes[key] && <p className="mt-2 text-[11.5px] text-white/45">{lineNotes[key]}</p>}
            </div>
          )
        })}
      </div>

      {/* WHAT THE CALLS WERE. A call counts once for each kind of record it
          filed; a call that filed nothing is not in the bar, and a kind whose
          records could not be read is "—" beside it, outside the total. */}
      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
            What the calls were · last 30 days
          </p>
          {stats && (
            <p className="text-[11.5px] text-white/45">
              <span className="font-stat text-white/75">{stats.mixTotal.toLocaleString()}</span> filed
            </p>
          )}
        </div>
        <div className="mt-2.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
          {stats && stats.mixTotal > 0 && stats.mix.map((m) => (m.count ? (
            <motion.span
              key={m.modality}
              title={`${m.count} · ${MODALITY[m.modality].label}`}
              initial={{ width: 0 }}
              animate={{ width: `${(m.count / stats.mixTotal) * 100}%` }}
              transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: heroBand(MODALITY[m.modality].tint) }}
            />
          ) : null))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/65">
          {(stats?.mix ?? []).map((m) => (
            <span
              key={m.modality}
              className="inline-flex items-center gap-1.5"
              title={m.count === null ? 'Not known — its records could not be read here' : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: heroBand(MODALITY[m.modality].tint) }} />
              {MODALITY[m.modality].label}
              <span className="font-stat text-white/90">{m.count === null ? dash : m.count.toLocaleString()}</span>
            </span>
          ))}
          {!stats && <span className="text-white/45">{unavailable}</span>}
          {stats && stats.mixTotal === 0 && (
            <span className="text-white/45">
              {stats.mix.some((m) => m.count === null)
                ? 'No hotline call in the last 30 days filed a record.'
                : 'No call in the last 30 days filed a record.'}
            </span>
          )}
        </div>
      </div>

      {/* THE STATE OF THE READING — quiet when well, amber and named when not */}
      <div className="mt-5 border-t border-white/10 pt-3.5">
        <p className="text-[12px] leading-[1.6] text-white/55">
          {live && indexState === 'live' && (
            <span
              className="mr-2 inline-flex items-center gap-1.5 align-[-1px]"
              title="This screen hears the platform’s live stream: a call shows here as it ends, and again once it is filed."
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span
                  className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
                  style={{ background: heroBand('mint') }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: heroBand('mint') }} />
              </span>
              <span className="font-medium text-white/85">Live</span>
            </span>
          )}
          {[
            sweepPart(sweep, indexState, now),
            lastLoggedMs !== null ? `last filed or refused ${relativeTime(lastLoggedMs, now)}` : '',
            stats ? `${stats.waiting.toLocaleString()} waiting` : '',
            ...quiet,
          ].filter(Boolean).join(' · ')}
        </p>
        {problems.map((p) => (
          <p key={p} className="mt-1.5 flex items-start gap-2 text-[12px] leading-[1.55]" style={{ color: heroBand('amber') }}>
            <AlertTriangle size={13} className="mt-[3px] shrink-0" />
            <span>{p}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
