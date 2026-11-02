import { useEffect, useState, type CSSProperties } from 'react'
import { Clapperboard } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Guarded thumbnail — onError/missing src swaps to a tinted tile (never a broken image). */
export function Thumb({ src, alt = '', className, style, loading }: { src?: string | null; alt?: string; className?: string; style?: CSSProperties; loading?: 'lazy' | 'eager' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return (
      <div aria-hidden className={cn('grid place-items-center bg-surface-3 text-text-3', className)} style={style}>
        <Clapperboard size={22} />
      </div>
    )
  }
  return <img src={src} alt={alt} loading={loading ?? 'lazy'} decoding="async" onError={() => setFailed(true)} className={className} style={style} />
}
