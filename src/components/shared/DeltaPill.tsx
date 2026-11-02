import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** +2.4% ▲ green / ▼ red pill (§11). Status color always paired with an arrow icon. */
export default function DeltaPill({ delta, className }: { delta: number; className?: string }) {
  const up = delta >= 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold leading-4',
        up ? 'bg-tint-mint text-tint-fg-mint' : 'bg-tint-pink text-tint-fg-pink',
        className,
      )}
    >
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {up ? '+' : '−'}
      {Math.abs(delta).toFixed(1)}%
    </span>
  )
}
