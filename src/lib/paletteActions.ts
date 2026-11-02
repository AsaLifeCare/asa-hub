// WHAT ⌘K CAN DO.
// The "Search apps, pages, actions" bar had to be brought to life, with thorough work on the actions that can be…
import type { AppManifest } from '@/engine/types'
import type { TintName } from '@/engine/types'

export type PaletteAction = {
  id: string
  label: string
  /** Right-hand context — which app or section this belongs to. */
  hint?: string
  /** lucide kebab-case name, drawn through <TintTile/>. */
  icon: string
  tint: TintName
  /** Extra words the search should match (never displayed). */
  keywords?: string
  /** A destination, or a verb. Exactly one of the two. */
  href?: string
  run?: () => void
  /** Said after a verb runs. Destinations stay silent — arriving is the proof. */
  toast?: string
}

/* ---------------- 2. the create doors, derived from the registry ---------------- */

type PrimaryAction = { label?: string; form?: unknown; icon?: string; action?: string }

// "New <thing>" for every page that really has a create form.
export function createActions(apps: AppManifest[]): PaletteAction[] {
  const out: PaletteAction[] = []
  for (const app of apps) {
    for (const page of app.pages) {
      const primary = (page.config as Record<string, unknown> | undefined)?.primaryAction as PrimaryAction | undefined
      if (!primary?.form) continue
      const label = String(primary.label ?? '').trim() || `New ${page.title}`
      out.push({
        id: `create:${app.id}/${page.id}`,
        label,
        hint: app.name,
        icon: primary.icon ?? 'plus',
        tint: app.accent,
        keywords: `new create add ${page.title} ${app.name}`,
        href: `/app/${app.id}/${page.id}?new=1`,
      })
    }
  }
  // Two apps can both call it "Add client"; the hint says which, and the id keeps them distinct in the list.
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/* ---------------- 4. people ---------------- */

// THE PEOPLE, FROM THE DIRECTORY THE TAB ALREADY HAS.
export type PalettePerson = {
  id: string
  name: string
  title?: string
  email?: string
  active?: boolean
}

export function peopleMatches(rows: Record<string, unknown>[], query: string, limit = 6): PalettePerson[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const out: PalettePerson[] = []
  const starts = (s: string) => s.toLowerCase().split(/[\s.@_-]+/).some((w) => w.startsWith(q))
  for (const r of rows) {
    const name = String(r.display_name ?? '').trim()
    const email = String(r.email ?? '').trim()
    if (!name && !email) continue
    if (!starts(name) && !starts(email)) continue
    out.push({
      id: String(r.id ?? ''),
      name: name || email,
      title: String(r.title ?? '') || undefined,
      email: email || undefined,
      active: r.active !== false,
    })
    if (out.length >= limit) break
  }
  return out
}

/* ---------------- 3. the settings sections ---------------- */

export function settingsActions(sections: { id: string; icon: string; label: string }[]): PaletteAction[] {
  return sections.map((s) => ({
    id: `settings:${s.id}`,
    label: s.label,
    hint: 'Settings',
    icon: s.icon,
    tint: 'lavender' as TintName,
    keywords: `settings configuration ${s.label}`,
    href: `/settings#${s.id}`,
  }))
}
