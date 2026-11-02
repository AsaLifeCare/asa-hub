// App Studio — shared form fields for the Import / Edit modals.
// - `IconGridPicker` — searchable ICON_GROUPS grid (same look as the App Builder's step-1 picker).
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppIcon, ICON_GROUPS } from '@/lib/icons'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

/** Accent tints used by manifests (studio subset — matches backend accepts). */
export const STUDIO_ACCENTS: TintName[] = ['green', 'blue', 'lavender', 'peach', 'pink', 'amber']

export function AccentSelect({ value, onChange }: { value: TintName; onChange: (t: TintName) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TintName)}>
      <SelectTrigger className="h-9 w-full text-[13px]" aria-label="Accent tint">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STUDIO_ACCENTS.map((t) => (
          <SelectItem key={t} value={t} className="text-[13px]">
            <span className="flex items-center gap-2">
              <span className={cn('h-3.5 w-3.5 rounded-full', TINT_BG[t])} />
              <span className="capitalize">{t}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function IconGridPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return ICON_GROUPS
    return ICON_GROUPS.map((g) => ({ ...g, icons: g.icons.filter((ic) => ic.includes(needle)) })).filter(
      (g) => g.icons.length > 0,
    )
  }, [query])

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-text-2">Icon</span>
        <div className="relative w-[140px] sm:w-[200px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons…"
            aria-label="Search icons"
            className="h-8 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
          />
        </div>
      </div>
      <div className="scroll-thin max-h-[180px] space-y-3 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="py-6 text-center text-[12px] text-text-3">No icons match “{query}”.</p>
        )}
        {groups.map((g) => (
          <div key={g.id}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.icons.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => onChange(ic)}
                  aria-label={ic}
                  title={ic}
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-sm border text-text-2 transition-colors duration-150',
                    value === ic
                      ? 'border-primary bg-primary-soft text-primary-strong'
                      : 'border-border bg-surface hover:bg-surface-2',
                  )}
                >
                  <AppIcon name={ic} size={16} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
