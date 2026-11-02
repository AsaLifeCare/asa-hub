// THE BLACK HEADER over the Technology Command Center — the kit's one dark surface, carrying this screen's own…
// Four figures, one per read: the portfolio, its files, the platform's open gaps and the documents in the Drive…
import { motion } from 'framer-motion'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { TechFigure, TechFigures } from './technologyModel'

const DASH = '—'

function Figure({ figure, label, tone }: { figure: TechFigure; label: string; tone?: 'amber' }) {
  const colour = tone && figure.value !== null ? { color: heroBand('amber') } : undefined
  return (
    <div className="min-w-0">
      <p className="font-stat text-[34px] leading-none text-white" style={colour}>
        {/* a count from a read that only partly landed is a floor, and says so */}
        {figure.value === null ? DASH : `${figure.value.toLocaleString()}${figure.atLeast ? '+' : ''}`}
      </p>
      <p className="mt-1.5 text-[12px] font-medium text-white/80">{label}</p>
      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-white/50" style={colour}>{figure.sub}</p>
    </div>
  )
}

export default function TechnologyHero({
  figures,
  folderName,
  failed,
  refreshing,
  onRetry,
}: {
  figures: TechFigures
  /** the Drive folder this screen stands on, when the listing named it */
  folderName?: string
  /** true when at least one of the three reads refused */
  failed: boolean
  refreshing: boolean
  onRetry: () => void
}) {
  const bandTotal = figures.band.reduce((n, b) => n + b.n, 0)
  return (
    <section
      aria-label="Technology — the portfolio and the platform's own state"
      aria-busy={refreshing}
      className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6"
    >
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
        Technology command center{folderName ? ` · ${folderName}` : ''}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <Figure figure={figures.projects} label="Projects tracked" />
        <Figure figure={figures.files} label="Project files" />
        <Figure figure={figures.gaps} label="Open gaps" tone="amber" />
        <Figure figure={figures.documents} label="Documents on file" />
      </div>

      {bandTotal > 0 && (
        <div className="mt-6">
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
            {figures.band.map((b) => (
              <motion.span
                key={b.label}
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
              <span key={b.label} className="inline-flex items-center gap-1.5">
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
              disabled={refreshing}
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
