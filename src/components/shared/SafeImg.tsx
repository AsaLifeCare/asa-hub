// SafeImg — the universal image renderer with a guaranteed fallback tile.
// A broken-image icon from the browser can NEVER appear: - `src` missing/empty → fallback tile - `onError` fires →…
import { useState, type CSSProperties, type ReactNode } from 'react'
import { AnimalAvatarSvg, animalIdOf, isAnimalAvatar } from '@/lib/animalAvatars'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppIcon, ICON_GROUPS } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { usePrivateSrc } from '@/lib/privateImage'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** The 6 pastel tint pairs used for deterministic fallback tiles. */
export const FALLBACK_TINTS = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber'] as const
export type FallbackTint = (typeof FALLBACK_TINTS)[number]

/** Deterministic tint from a name (or seed string) — stable across renders. */
export function tintForName(name: string): FallbackTint {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return FALLBACK_TINTS[h % FALLBACK_TINTS.length]
}

/** Parses an `icon:<name>[:<tint>]` avatar ref; null for anything else. */
export function parseIconRef(src?: string | null): { icon: string; tint?: FallbackTint } | null {
  if (typeof src !== 'string' || !src.startsWith('icon:')) return null
  const [icon, tint] = src.slice(5).split(':')
  return {
    icon: icon || 'user',
    tint: FALLBACK_TINTS.includes(tint as FallbackTint) ? (tint as FallbackTint) : undefined,
  }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join('')
}

type SizeProp = number | string

function sizeCls(size?: SizeProp): string | undefined {
  return typeof size === 'string' ? size : undefined
}

function sizeStyle(size?: SizeProp): CSSProperties | undefined {
  return typeof size === 'number' ? { width: size, height: size } : undefined
}

// Icon pixel size for a tile — scales with numeric sizes and with the tailwind height class of string sizes (h-N =…
function iconSize(size?: SizeProp): number {
  if (typeof size === 'number') return Math.max(12, Math.round(size * 0.44))
  if (typeof size === 'string') {
    const m = size.match(/h-\[?(\d+)(?:px\])?/)
    if (m) {
      const px = size.includes('[') ? Number(m[1]) : Number(m[1]) * 4
      return Math.max(12, Math.round(px * 0.44))
    }
  }
  return 18
}

export default function SafeImg({
  src: given,
  name,
  icon = 'image',
  shape = 'round',
  size,
  tint,
  className,
  alt,
  loading = false,
  eager = false,
}: {
  src?: string | null
  /** Used for initials + deterministic tint. */
  name?: string
  /** Lucide name for the icon fallback (when no name). */
  icon?: string
  /** round = rounded-full, square = rounded-xl. */
  shape?: 'round' | 'square'
  /** px number or a tailwind size class (e.g. "h-10 w-10"). */
  size?: SizeProp
  /** Tint override — skips the name hash. */
  tint?: FallbackTint
  className?: string
  alt?: string
  /** When true, erase any previous photo and show a loading overlay. */
  loading?: boolean
  // Fetch the picture NOW instead of when it scrolls into view.
  eager?: boolean
}) {
  // a house photo the relay keeps is read with the session's bearer first (lib/privateImage); any other src as given
  const priv = usePrivateSrc(given)
  const src = priv.src
  // Reset during render, never in an effect: a cached image fires `load` before effects run and would be wiped.
  const [imgState, setImgState] = useState<{ src?: string | null; loaded: boolean; failed: boolean }>(
    { src, loaded: false, failed: false },
  )
  if (imgState.src !== src) setImgState({ src, loaded: false, failed: false })
  const loaded = imgState.loaded
  const failed = imgState.failed || priv.refused
  // BAIL WHEN NOTHING CHANGES.
  const setLoaded = (v: boolean) =>
    setImgState((st) => (st.src === src && st.loaded !== v ? { ...st, loaded: v } : st))
  const setFailed = (v: boolean) =>
    setImgState((st) => (st.src === src && st.failed !== v ? { ...st, failed: v } : st))

  const iconRef = parseIconRef(src)
  // ANIMAL DRAWINGS: `animal:<id>` renders an inline SVG the same way `icon:` renders a lucide glyph — no request…
  const animalId = isAnimalAvatar(src) ? animalIdOf(String(src)) : ''
  const t: FallbackTint = iconRef?.tint ?? tint ?? tintForName(name ?? icon)
  const showImg = !!src && !failed && !iconRef && !animalId && loaded && !loading
  // No initials circle on anything, anywhere: the INITIALS fallback renders as the old platform's square tile…
  const effShape = !showImg && !iconRef && !animalId && name ? 'square' : shape
  const busy = loading || priv.pending || (!!src && !loaded && !failed && !iconRef && !animalId)

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden',
        effShape === 'round' ? 'rounded-full' : 'rounded-lg',
        !showImg && TINT_BG[t],
        sizeCls(size),
        className,
      )}
      style={sizeStyle(size)}
    >
      {src && !iconRef && !loading && (
        <img
          key={src}
          src={src}
          ref={(el) => {
            // already complete when the element reaches us — no event will fire
            if (el && el.complete) {
              if (el.naturalWidth > 0) setLoaded(true)
              else if (el.naturalWidth === 0 && el.currentSrc) setFailed(true)
            }
          }}
          alt={alt ?? name ?? ''}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          // Drive / Googleusercontent sometimes refuse the Hub referrer and return an empty body — the card then…
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth === 0) setFailed(true)
            else setLoaded(true)
          }}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-200',
            showImg ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {!showImg && (
        <span className="grid h-full w-full place-items-center">
          {animalId ? (
            <AnimalAvatarSvg id={animalId} size={typeof size === 'number' ? size : 32} />
          ) : iconRef ? (
            <AppIcon name={iconRef.icon} size={iconSize(size)} className={TINT_FG[t]} />
          ) : name ? (
            <span
              className={cn('font-bold leading-none', TINT_FG[t])}
              style={typeof size === 'number' ? { fontSize: Math.max(9, Math.round(size * 0.36)) } : undefined}
            >
              {initialsOf(name)}
            </span>
          ) : (
            <AppIcon name={icon} size={iconSize(size)} className={TINT_FG[t]} />
          )}
        </span>
      )}
      {busy && (
        <div className="absolute inset-0 grid place-items-center bg-surface/75 backdrop-blur-[1px]">
          <Loader2 size={iconSize(size)} className="animate-spin text-text-2" aria-label="Loading image" />
        </div>
      )}
    </div>
  )
}

/** The fallback tile standalone — for edit flows that preview the tile itself. */
export function IconTile({
  icon = 'image',
  name,
  tint,
  shape = 'square',
  size = 40,
  className,
}: {
  icon?: string
  /** When given, shows initials instead of the icon (and derives tint). */
  name?: string
  tint?: FallbackTint
  shape?: 'round' | 'square'
  size?: SizeProp
  className?: string
}) {
  const t: FallbackTint = tint ?? tintForName(name ?? icon)
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center',
        shape === 'round' ? 'rounded-full' : 'rounded-xl',
        TINT_BG[t],
        // A deleted or missing photo leaves colour behind, not a hole: the tile shades from its own tint so a…
        'bg-gradient-to-br from-transparent to-black/[0.06] dark:to-white/[0.06]',
        sizeCls(size),
        className,
      )}
      style={sizeStyle(size)}
    >
      {name ? (
        <span
          className={cn('font-bold leading-none', TINT_FG[t])}
          style={typeof size === 'number' ? { fontSize: Math.max(9, Math.round(size * 0.36)) } : undefined}
        >
          {initialsOf(name)}
        </span>
      ) : (
        <AppIcon name={icon} size={iconSize(size)} className={TINT_FG[t]} />
      )}
    </span>
  )
}

/** Curated picker subset: 4 icons per ICON_GROUPS theme + the generic 'image'. */
const PICKER_ICONS: string[] = ['image', ...ICON_GROUPS.flatMap((g) => g.icons.slice(0, 4))]

// TilePicker — popover to swap a fallback tile's lucide icon and its tint.
export function TilePicker({
  icon,
  tint,
  onChange,
  trigger,
  align = 'start',
}: {
  icon: string
  tint: FallbackTint
  onChange: (v: { icon: string; tint: FallbackTint }) => void
  /** Custom trigger; defaults to a small preview tile button. */
  trigger?: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label="Change fallback icon and color"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-150 hover:scale-[1.04]"
          >
            <IconTile icon={icon} tint={tint} size={36} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[248px] bg-surface p-3">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
          Fallback icon
        </p>
        <div className="grid grid-cols-6 gap-1">
          {PICKER_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`Icon ${i}`}
              aria-pressed={icon === i}
              onClick={() => onChange({ icon: i, tint })}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-md text-text-2 ring-2 ring-offset-1 ring-offset-surface transition-colors duration-150 hover:bg-surface-2 hover:text-text-1',
                icon === i ? 'bg-surface-2 ring-primary' : 'ring-transparent',
              )}
            >
              <AppIcon name={i} size={15} />
            </button>
          ))}
        </div>
        <p className="mb-2 mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
          Tile color
        </p>
        <div className="flex items-center gap-1.5">
          {FALLBACK_TINTS.map((t) => (
            <button
              key={t}
              type="button"
              aria-label={`Tint ${t}`}
              aria-pressed={tint === t}
              onClick={() => onChange({ icon, tint: t })}
              className={cn(
                'h-7 w-7 rounded-full ring-2 ring-offset-1 ring-offset-surface transition-transform duration-150 hover:scale-110',
                TINT_BG[t],
                tint === t ? 'ring-primary' : 'ring-transparent',
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
