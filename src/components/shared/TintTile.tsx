import { cn } from '@/lib/utils'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'

const SIZES = {
  sm: { box: 'h-7 w-7 rounded-[8px]', icon: 14 },
  md: { box: 'h-9 w-9 rounded-[10px]', icon: 18 },
  lg: { box: 'h-11 w-11 rounded-[12px]', icon: 20 },
  xl: { box: 'h-14 w-14 rounded-[14px]', icon: 26 },
} as const

/** Icon in a pastel square (§11). 6 tints × 4 sizes. */
export default function TintTile({
  icon,
  tint,
  size = 'md',
  className,
}: {
  icon: string
  tint: TintName
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  return (
    <div className={cn('grid shrink-0 place-items-center', s.box, TINT_BG[tint], className)}>
      <AppIcon name={icon} size={s.icon} className={TINT_FG[tint]} />
    </div>
  )
}
