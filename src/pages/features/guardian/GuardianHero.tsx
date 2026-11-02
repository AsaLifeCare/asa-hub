// The black header over Guardian: the verdicts of the checks themselves.
// A CHECK THAT COULD NOT RUN IS NOT A GREEN CHECK.
import AppHero from '@/components/shared/AppHero'
import { heroBand } from '@/lib/tints'
import { heroNumber, type HeroFigure, type HeroRead } from '@/lib/appHero'

export type GuardianFigures = {
  /** every check on the page */
  checks: number
  failing: number
  watching: number
  green: number
  /** checks with no answer yet — part of `watching`, named on their own */
  waiting: number
  /** snapshot slices the browser holds, or null when that read has not landed */
  slices: number | null
  /** where the snapshot index read stands — a pending read is not a failed one */
  slicesRead: SideRead
  stale: number
  errored: number
  /** the build the relay says it is serving */
  build: string
  /** where the relay's health read stands */
  buildRead: SideRead
}

/** A side read of this screen: still running, failed, or answered. */
export type SideRead = 'pending' | 'failed' | 'ready'

const BANDS: { key: 'failing' | 'watching' | 'green'; label: string; tint: 'danger' | 'amber' | 'mint' }[] = [
  { key: 'failing', label: 'Needs action now', tint: 'danger' },
  { key: 'watching', label: 'Watch', tint: 'amber' },
  { key: 'green', label: 'All green', tint: 'mint' },
]

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${heroNumber(n)} ${n === 1 ? one : many}`

export default function GuardianHero({ read, figures, onRetry }: {
  read: HeroRead
  figures: GuardianFigures | null
  onRetry?: () => void
}) {
  const f = figures

  const list: HeroFigure[] = [
    {
      label: 'Checks needing action',
      tint: 'danger',
      value: f ? f.failing : null,
      note: !f ? '' : `of ${plural(f.checks, 'check')} on this screen`,
    },
    {
      label: 'Checks to watch',
      tint: 'amber',
      value: f ? f.watching : null,
      note: !f
        ? ''
        : f.waiting
          ? `${plural(f.waiting, 'check')} have not answered yet — grey is never green`
          : 'warnings only; every check answered',
    },
    {
      label: 'Snapshot slices cached',
      tint: 'blue',
      value: f ? f.slices : null,
      note: !f
        ? ''
        : f.slices !== null
          ? `${heroNumber(f.stale)} stale · ${heroNumber(f.errored)} with errors`
          : f.slicesRead === 'failed'
            ? 'the browser’s own snapshot index did not answer'
            : 'the snapshot index is not read yet',
    },
    {
      label: 'Serving build',
      text: true,
      value: f && f.build ? f.build : null,
      note: !f
        ? ''
        : f.build
          ? 'as the relay reports it'
          : f.buildRead === 'failed'
            ? 'the server did not answer'
            : f.buildRead === 'pending' ? 'the relay is not read yet' : 'the relay named no build',
    },
  ]

  const total = f ? Math.max(1, f.checks) : 1
  return (
    <AppHero
      eyebrow="Guardian · is anything broken"
      label="Guardian — the platform's health"
      read={read}
      figures={list}
      reading="Running the checks…"
      failed="The checks could not be read, so these figures are unknown — not zero."
      sentence={f
        ? f.failing
          ? `${plural(f.failing, 'check')} failing · a person’s job now, not a refresh’s`
          : f.waiting
            ? `Nothing is failing, and ${plural(f.waiting, 'check')} have yet to answer`
            : 'Every check answered, and none of them is failing'
        : undefined}
      onRetry={onRetry}
    >
      {f && (
        <div className="mt-6">
          {/* A ZERO BAND DRAWS NOTHING and still appears in the legend with its
              0, so "none in this band" and "not measured" never look alike. */}
          <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
            {BANDS.map((b) => (f[b.key] ? (
              <span
                key={b.key}
                title={`${f[b.key]} · ${b.label.toLowerCase()}`}
                style={{ width: `${(f[b.key] / total) * 100}%`, background: heroBand(b.tint) }}
                className="h-full first:rounded-l-full last:rounded-r-full"
              />
            ) : null))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/65">
            {BANDS.map((b) => (
              <span key={b.key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: heroBand(b.tint) }} />
                {b.label} <span className="font-stat text-white/90">{heroNumber(f[b.key])}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </AppHero>
  )
}
