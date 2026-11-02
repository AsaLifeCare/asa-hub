// ---------------- cover art (icon covers + image covers) ---------------- A cover is either an image path…
// Falsy/broken covers fall back to DEFAULT_COVER, so no broken-image state is reachable.
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

export const DEFAULT_COVER = 'icon:file-text|blue'

/** The 4 generated jpgs that actually exist under /assets/docs. */
const IMAGE_COVERS = [1, 2, 3, 4].map((i) => `/assets/docs/cover-${String(i).padStart(2, '0')}.jpg`)

/** Curated picker vocabulary (~16 icons × 6 tints) for icon covers. */
const COVER_ICONS = [
  'file-text', 'book-open', 'notebook', 'clipboard-list',
  'heart-pulse', 'stethoscope', 'pill', 'shield',
  'users', 'house', 'calendar-days', 'graduation-cap',
  'clipboard-check', 'megaphone', 'star', 'lightbulb',
]
const COVER_TINTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber']

function parseIconCover(cover?: string): { icon: string; tint: TintName } | null {
  if (!cover || !cover.startsWith('icon:')) return null
  const [icon, tint] = cover.slice(5).split('|')
  return {
    icon: icon || 'file-text',
    tint: (COVER_TINTS.includes(tint as TintName) ? tint : 'blue') as TintName,
  }
}

/** Only real image urls make good bookmark thumbnails. */
export const bookmarkableCover = (cover?: string) => (cover && !cover.startsWith('icon:') ? cover : undefined)

// Cover renderer — icon covers become tinted icon tiles; image covers use <img> with an onError swap to the default…
export function CoverArt({ cover, className, iconSize = 30 }: { cover?: string; className?: string; iconSize?: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [cover])
  const icon = parseIconCover(cover) ?? (!cover || failed ? parseIconCover(DEFAULT_COVER) : null)
  if (icon) {
    return (
      <div className={cn('grid place-items-center', TINT_BG[icon.tint], className)}>
        <AppIcon name={icon.icon} size={iconSize} className={TINT_FG[icon.tint]} />
      </div>
    )
  }
  return (
    <img
      src={cover}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('object-cover', className)}
    />
  )
}

// Tabbed cover picker for the create modals: Icon covers (tinted tiles at cover aspect) + Image covers (the 4…
export function CoverPicker({ cover, onChange }: { cover: string; onChange: (c: string) => void }) {
  const current = parseIconCover(cover)
  const [tab, setTab] = useState<'icons' | 'images'>(current ? 'icons' : 'images')
  const iconName = current?.icon ?? 'file-text'
  const iconTint = current?.tint ?? 'blue'
  return (
    <div className="mb-4">
      <div className="mb-2 flex h-8 w-fit items-center rounded-sm border border-border bg-surface p-0.5">
        {(['icons', 'images'] as const).map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-medium capitalize transition-colors duration-150',
              tab === t ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:text-text-2',
            )}
          >
            <AppIcon name={t === 'icons' ? 'shapes' : 'image'} size={13} />
            {t === 'icons' ? 'Icon covers' : 'Image covers'}
          </button>
        ))}
      </div>
      {tab === 'icons' ? (
        <div>
          {/* live preview at cover aspect */}
          <CoverArt cover={`icon:${iconName}|${iconTint}`} iconSize={26} className="mb-2 aspect-[5/2] w-full rounded-[10px]" />
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {COVER_ICONS.map((name) => (
              <button
                key={name}
                aria-label={`Icon ${name}`}
                aria-pressed={current?.icon === name}
                onClick={() => onChange(`icon:${name}|${iconTint}`)}
                className={cn(
                  'grid aspect-square place-items-center rounded-[8px] border transition-colors duration-150',
                  current?.icon === name
                    ? 'border-transparent bg-primary-soft text-primary-strong'
                    : 'border-border bg-surface text-text-3 hover:bg-surface-2 hover:text-text-1',
                )}
              >
                <AppIcon name={name} size={15} />
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {COVER_TINTS.map((t) => (
              <button
                key={t}
                aria-label={`Tint ${t}`}
                aria-pressed={iconTint === t}
                onClick={() => onChange(`icon:${iconName}|${t}`)}
                className={cn(
                  'h-6 w-6 rounded-full transition-transform duration-150',
                  iconTint === t ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100',
                )}
                style={{ background: TINT_VAR[t] }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {IMAGE_COVERS.map((c) => (
            <button
              key={c}
              onClick={() => onChange(c)}
              aria-label="Choose cover"
              aria-pressed={cover === c}
              className={cn(
                'relative overflow-hidden rounded-[10px] ring-2 ring-offset-2 ring-offset-surface transition-all duration-150',
                cover === c ? 'ring-primary' : 'ring-transparent hover:ring-border-strong',
              )}
            >
              <img src={c} alt="" className="aspect-[5/2] w-full object-cover" />
              {cover === c && (
                <span className="absolute inset-0 grid place-items-center bg-black/30">
                  <Check size={16} className="text-white" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
