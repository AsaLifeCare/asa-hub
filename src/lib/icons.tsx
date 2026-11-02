// Renders a lucide icon by kebab-case name ("layout-grid" → <LayoutGrid/>).
// Used by registry-driven UI (sidebar, palette, tiles) where icons are data.
import { icons, Circle } from 'lucide-react'
import type { LucideProps } from 'lucide-react'

function toPascal(name: string) {
  return name
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}

export function AppIcon({ name, size = 18, ...props }: { name: string } & LucideProps) {
  const Icon = (icons as Record<string, typeof Circle>)[toPascal(name)] ?? Circle
  return <Icon size={size} strokeWidth={1.8} {...props} />
}

/** Curated icon picker groups (theme → kebab-case lucide names). */
export const ICON_GROUPS: { id: string; label: string; icons: string[] }[] = [
  {
    id: 'people',
    label: 'People',
    icons: ['users', 'user', 'user-plus', 'user-check', 'contact', 'smile', 'baby', 'accessibility'],
  },
  {
    id: 'care',
    label: 'Care',
    icons: ['heart-pulse', 'heart', 'stethoscope', 'pill', 'syringe', 'shield-plus', 'bandage', 'activity'],
  },
  {
    id: 'ops',
    label: 'Ops',
    icons: ['truck', 'wrench', 'hammer', 'clipboard-list', 'calendar-days', 'clock', 'map-pin', 'bus', 'house', 'briefcase'],
  },
  {
    id: 'docs',
    label: 'Docs',
    icons: ['file-text', 'book-open', 'notebook', 'folder', 'archive', 'clipboard-check', 'pen-line', 'file-plus'],
  },
  {
    id: 'data',
    label: 'Data',
    icons: ['trending-up', 'chart-pie', 'chart-column', 'gauge', 'database', 'table', 'list-checks', 'layout-grid'],
  },
  {
    id: 'misc',
    label: 'Misc',
    icons: ['rocket', 'wallet', 'target', 'megaphone', 'star', 'zap', 'globe', 'lightbulb', 'flag', 'bookmark', 'sparkles', 'coffee', 'leaf', 'shield', 'lock', 'gift'],
  },
]

/** Flat list of every curated picker icon. */
export const ALL_PICKER_ICONS: string[] = ICON_GROUPS.flatMap((g) => g.icons)
