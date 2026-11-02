// THE BLACK HEADER, drawn once for every app that opens with one.
// Anatomy copied from the Referrals header (the first of its kind): the kit's single dark surface, an eyebrow in…
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { heroAnyFailed, heroFigureRead, heroNote, heroValue, type HeroFigure, type HeroRead } from '@/lib/appHero'

const EYEBROW = 'block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45'

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white/85 hover:bg-white/15"
    >
      <RotateCw size={11} /> Try again
    </button>
  )
}

function Figure({ read, figure }: { read: HeroRead; figure: HeroFigure }) {
  const own = heroFigureRead(read, figure)
  const value = heroValue(own, figure.value)
  const measured = own.state === 'ready' && figure.value !== null
  return (
    <div className="min-w-0">
      {figure.text ? (
        <span className="flex h-[34px] min-w-0 items-end">
          <span className="truncate text-[20px] font-semibold leading-tight text-white" title={value}>{value}</span>
        </span>
      ) : (
        <span
          className="block font-stat text-[34px] leading-none text-white"
          style={measured && figure.tint ? { color: heroBand(figure.tint) } : undefined}
        >
          {value}
        </span>
      )}
      <span className="mt-1.5 block text-[12px] font-medium text-white/80">{figure.label}</span>
      <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-white/50">{heroNote(read, figure)}</span>
    </div>
  )
}

export default function AppHero({
  eyebrow,
  label,
  read,
  figures,
  reading,
  failed,
  sentence,
  onRetry,
  className,
  children,
}: {
  /** the small-capitals line: the app, and what these figures cover */
  eyebrow: string
  /** the section's accessible name */
  label: string
  read: HeroRead
  figures: HeroFigure[]
  /** while the read is in flight */
  reading: string
  /** when it failed — must say the figures are unknown, never zero */
  failed: string
  /** the closing line once the figures are real */
  sentence?: ReactNode
  onRetry?: () => void
  className?: string
  /** a band, a legend, a chip row — whatever this app counts in shapes */
  children?: ReactNode
}) {
  const figureFailed = read.state === 'ready' && heroAnyFailed(read, figures)
  return (
    <section
      aria-label={label}
      aria-busy={read.state === 'loading'}
      className={cn('mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6', className)}
    >
      <p className={EYEBROW}>{eyebrow}</p>

      {figures.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          {figures.map((f) => <Figure key={f.label} read={read} figure={f} />)}
        </div>
      )}

      {children}

      <div className="mt-5 border-t border-white/10 pt-3.5 text-[12px] leading-[1.6] text-white/55">
        {read.state === 'loading' && (
          <p className="inline-flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" /> {reading}
          </p>
        )}
        {read.state === 'failed' && (
          <p className="flex flex-wrap items-center gap-2" style={{ color: heroBand('amber') }}>
            <AlertTriangle size={13} className="shrink-0" />
            <span>{failed}{read.reason ? ` ${read.reason}` : ''}</span>
            {onRetry && <RetryButton onRetry={onRetry} />}
          </p>
        )}
        {/* one figure's own door failing still earns the retry */}
        {read.state === 'ready' && (sentence || (onRetry && figureFailed)) && (
          <p className="flex flex-wrap items-center gap-2">
            {sentence && <span>{sentence}</span>}
            {onRetry && figureFailed && <RetryButton onRetry={onRetry} />}
          </p>
        )}
      </div>
    </section>
  )
}
