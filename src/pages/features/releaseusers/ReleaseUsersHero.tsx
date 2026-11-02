// THE BLACK HEADER over Release Users — the kit's one dark surface, carrying this screen's own figures.
// MASTER-ONLY, like the screen: it is drawn past the badge gate, so anybody else meets the empty state and never…
import { motion } from 'framer-motion'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { ReleaseFigure, ReleaseFigures } from './releaseUsersModel'

const DASH = '—'

function Figure({ figure, label, tone }: { figure: ReleaseFigure; label: string; tone?: 'amber' }) {
  const colour = tone && figure.value ? { color: heroBand('amber') } : undefined
  return (
    <div className="min-w-0">
      <p className="font-stat text-[34px] leading-none text-white" style={colour}>
        {figure.value === null ? DASH : figure.value.toLocaleString()}
      </p>
      <p className="mt-1.5 text-[12px] font-medium text-white/80">{label}</p>
      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-white/50" style={colour}>{figure.sub}</p>
    </div>
  )
}

export default function ReleaseUsersHero({
  figures,
  place,
  loading,
  failed,
  onRetry,
}: {
  figures: ReleaseFigures
  /** the place whose directory answered, when one is named */
  place?: string
  loading: boolean
  failed: boolean
  onRetry: () => void
}) {
  const bandTotal = figures.band.reduce((n, b) => n + b.n, 0)
  return (
    <section
      aria-label="Release Users — the directory of this place"
      aria-busy={loading}
      className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6"
    >
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
        Release users{place ? ` · ${place}` : ''} · the master's door
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <Figure figure={figures.directory} label="In this directory" />
        <Figure figure={figures.never} label="Never signed in" />
        <Figure figure={figures.unarmed} label="Waiting to be armed" tone="amber" />
        <Figure figure={figures.announceable} label="Enabled apps" />
      </div>

      {bandTotal > 0 && (
        <div className="mt-6">
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
            {figures.band.map((b) => (
              <motion.span
                key={b.key}
                title={`${b.n} · ${b.label}`}
                initial={{ width: 0 }}
                animate={{ width: `${(b.n / bandTotal) * 100}%` }}
                transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ background: heroBand(b.tint) }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/65">
            {figures.band.map((b) => (
              <span key={b.key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: heroBand(b.tint) }} />
                {b.label}
                <span className="font-stat text-white/90">{b.n.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-white/10 pt-3.5">
        <p className="text-[12px] leading-[1.6] text-white/55" style={failed ? { color: heroBand('amber') } : undefined}>
          {figures.note}
        </p>
        {failed && (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] leading-[1.55]" style={{ color: heroBand('amber') }}>
            <AlertTriangle size={13} className="shrink-0" />
            <button
              type="button"
              onClick={onRetry}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white/85 hover:bg-white/15 disabled:opacity-50"
            >
              <RotateCw size={11} /> Try again
            </button>
          </p>
        )}
      </div>
    </section>
  )
}
