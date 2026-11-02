// A medication's photo in front of its name — the Medications app's rounded square, for any list that names a drug.
// The photo is the platform's own copy (medImageFor → public/med-images), then the row's own picture URL when it…
import type { ReactNode } from 'react'
import SafeImg, { tintForName } from '@/components/shared/SafeImg'
import { medImageFor } from '@/lib/medImages'
import { cn } from '@/lib/utils'

/** The photo for a drug name: the absorbed copy, else the row's own URL; null draws the pill tile. */
export function medPhotoFor(name: string, image?: string | null): string | null {
  return medImageFor(name) ?? (image || null)
}

export function MedThumb({ name, image, size = 32, eager = false, className }: {
  name: string
  /** the row's own picture URL, when it carries one */
  image?: string | null
  size?: number
  /** above the fold (a panel header): fetch now instead of lazily */
  eager?: boolean
  className?: string
}) {
  return (
    <SafeImg src={medPhotoFor(name, image)} icon="pill" tint={tintForName(name || '?')} shape="square" size={size}
      className={cn(size >= 48 ? 'rounded-lg' : 'rounded-md', className)} alt="" eager={eager} />
  )
}

/** The photo, then the name (or what the caller draws for it), centred on one line. */
export function MedName({ name, image, size = 32, eager = false, className, children }: {
  name: string
  image?: string | null
  size?: number
  eager?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <span className={cn('flex min-w-0 items-center', size >= 48 ? 'gap-3' : 'gap-2.5', className)}
      data-med-photo={medPhotoFor(name, image) ? 'photo' : 'pill'}>
      <MedThumb name={name} image={image} size={size} eager={eager} />
      <span className="min-w-0 break-words">{children ?? name}</span>
    </span>
  )
}
