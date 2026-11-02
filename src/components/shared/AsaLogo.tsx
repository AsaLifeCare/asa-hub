// AsaLogo — the "asa." brand lockup: thin cyan pulse icon (lucide Activity) + Manrope ExtraBold lowercase wordmark…
// No box backgrounds — callers wrap it in tint chips if they want one.
import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

type LogoSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE: Record<LogoSize, { text: string; icon: number; gap: string; subtitle: string; subtitleGap: string }> = {
  sm: { text: 'text-lg', icon: 14, gap: 'gap-1.5', subtitle: 'text-[10px]', subtitleGap: 'mt-0.5' },
  md: { text: 'text-2xl', icon: 18, gap: 'gap-2', subtitle: 'text-xs', subtitleGap: 'mt-1' },
  lg: { text: 'text-4xl', icon: 26, gap: 'gap-2.5', subtitle: 'text-sm', subtitleGap: 'mt-1.5' },
  xl: { text: 'text-7xl', icon: 40, gap: 'gap-3.5', subtitle: 'text-lg', subtitleGap: 'mt-3' },
}

export default function AsaLogo({
  size = 'md',
  onDark = false,
  withIcon = true,
  withSubtitle = false,
  className,
}: {
  size?: LogoSize
  onDark?: boolean
  withIcon?: boolean
  withSubtitle?: boolean
  className?: string
}) {
  const s = SIZE[size]
  return (
    <span className={cn('inline-flex items-center', s.gap, className)}>
      {withIcon && <Activity size={s.icon} strokeWidth={2.25} className="shrink-0 text-primary" aria-hidden />}
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'font-display font-extrabold lowercase leading-none tracking-tight',
            s.text,
            onDark ? 'text-white' : 'text-text-1',
          )}
        >
          asa
          {/* the dot is a small cyan square on the baseline — never a text period */}
          <span aria-hidden className="ml-[0.09em] inline-block h-[0.22em] w-[0.22em] bg-primary" />
        </span>
        {withSubtitle && (
          <span className={cn(s.subtitle, s.subtitleGap, onDark ? 'text-on-band-muted' : 'text-text-3')}>
            Home Healthcare Management
          </span>
        )}
      </span>
    </span>
  )
}
