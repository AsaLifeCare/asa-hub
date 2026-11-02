// App-category ordering shared by the sidebar and App Hub.
// Built-in categories keep their canonical order; any new category that appears in the registry (e.g. "Care"…
import type { AppCategory, AppManifest, TintName } from '@/engine/types'

export const KNOWN_CATEGORIES: AppCategory[] = ['Workspace', 'Manage', 'Library']

/** Categories present in `apps`: known ones first (canonical order), then new ones. */
export function orderedCategories(apps: Pick<AppManifest, 'category'>[]): AppCategory[] {
  const seen: AppCategory[] = []
  for (const a of apps) {
    if (!seen.includes(a.category)) seen.push(a.category)
  }
  const known = KNOWN_CATEGORIES.filter((c) => seen.includes(c))
  const extra = seen.filter((c) => !(KNOWN_CATEGORIES as AppCategory[]).includes(c))
  return [...known, ...extra]
}

/* ---------------- category definitions (defaults + custom) ---------------- */

// A sidebar/App Hub category.
export type CategoryDef = {
  /** Stable id — default ids equal the category string used by manifests. */
  id: string
  label: string
  tint: TintName
  /** lucide kebab-case icon name (rendered via <AppIcon/>). */
  icon: string
  custom: boolean
}

// Default (built-in) categories — the three canonical shells plus the categories the seeded app suites register.
export const DEFAULT_CATEGORY_DEFS: CategoryDef[] = [
  { id: 'Workspace', label: 'Workspace', tint: 'mint', icon: 'layout-grid', custom: false },
  { id: 'Manage', label: 'Manage', tint: 'blue', icon: 'briefcase', custom: false },
  { id: 'Library', label: 'Library', tint: 'lavender', icon: 'book-open', custom: false },
  { id: 'Care', label: 'Care', tint: 'pink', icon: 'heart-pulse', custom: false },
  { id: 'Operations', label: 'Operations', tint: 'amber', icon: 'truck', custom: false },
  { id: 'Intelligence', label: 'Intelligence', tint: 'lavender', icon: 'chart-pie', custom: false },
  { id: 'Finance', label: 'Finance', tint: 'green', icon: 'wallet', custom: false },
  // Studio-imported apps (sheet imports, Recruitment, …).
  { id: 'Imported', label: 'Imported', tint: 'peach', icon: 'file-input', custom: false },
]

/** The 6 pastel tints offered when creating a custom category. */
export const CUSTOM_CATEGORY_TINTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber']

/** Apps land here when their assigned category is deleted. */
export const FALLBACK_CATEGORY_ID = 'Manage'

// Defaults first (canonical order above), then custom categories in creation order.
export function mergedCategoryDefs(
  customCategories: CategoryDef[],
  labelOverrides: Record<string, string> = {},
  categoryOrder: string[] = [],
): CategoryDef[] {
  const custom = customCategories.filter((c) => !DEFAULT_CATEGORY_DEFS.some((d) => d.id === c.id))
  const defaults = DEFAULT_CATEGORY_DEFS.map((d) =>
    labelOverrides[d.id] ? { ...d, label: labelOverrides[d.id] } : d,
  )
  const all = [...defaults, ...custom]
  if (!categoryOrder.length) return all
  // Named ids first, in the order they were dragged; anything the list does not know about (a category created on…
  const rank = new Map(categoryOrder.map((id, i) => [id, i]))
  const named = all.filter((d) => rank.has(d.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  const rest = all.filter((d) => !rank.has(d.id))
  return [...named, ...rest]
}

export function categoryDefById(defs: CategoryDef[], id: string): CategoryDef | undefined {
  return defs.find((d) => d.id === id)
}

// The category an app effectively belongs to: a user assignment override wins when it still points at an existing…
export function effectiveCategoryId(
  app: Pick<AppManifest, 'id' | 'category'>,
  appCategory: Record<string, string>,
  defs: CategoryDef[],
): string {
  const override = appCategory[app.id]
  if (override) return defs.some((d) => d.id === override) ? override : FALLBACK_CATEGORY_ID
  return app.category
}

export type CategoryGroup = { def: CategoryDef; apps: AppManifest[] }

// Sorts `list` by a stored id order (admin drag-reorder, see useCategoryStore.appOrder): listed ids first in stored…
export function sortAppsByOrder<T extends Pick<AppManifest, 'id'>>(list: T[], stored: string[] | undefined): T[] {
  if (!stored || stored.length === 0) return list
  const rank = new Map(stored.map((id, i) => [id, i]))
  return [...list].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra === undefined && rb === undefined) return 0
    if (ra === undefined) return 1
    if (rb === undefined) return -1
    return ra - rb
  })
}

// Groups apps by their effective category, ordered by `defs` (defaults in canonical order, customs appended).
export function groupedApps(
  apps: AppManifest[],
  appCategory: Record<string, string>,
  defs: CategoryDef[],
  order?: Record<string, string[]>,
): CategoryGroup[] {
  const byCat = new Map<string, AppManifest[]>()
  for (const a of apps) {
    const cid = effectiveCategoryId(a, appCategory, defs)
    const list = byCat.get(cid)
    if (list) list.push(a)
    else byCat.set(cid, [a])
  }
  const groups: CategoryGroup[] = []
  for (const def of defs) {
    const list = byCat.get(def.id)
    if (list && list.length > 0) groups.push({ def, apps: sortAppsByOrder(list, order?.[def.id]) })
  }
  // Categories present in apps but absent from defs (e.g. a category typed straight into an apps-tab row) still…
  for (const [cid, list] of byCat) {
    if (!defs.some((d) => d.id === cid)) {
      groups.push({
        def: { id: cid, label: cid, tint: 'blue', icon: 'layout-grid', custom: false },
        apps: sortAppsByOrder(list, order?.[cid]),
      })
    }
  }
  return groups
}

/* ---------------- the shelf, as the server holds it ---------------- */

/** What `appShelfGet` answers and `appShelfSet` takes. */
export type ShelfSection = { id: string; label: string; tint: string; icon: string }
export type ShelfState = {
  customCategories: CategoryDef[]
  labelOverrides: Record<string, string>
  categoryOrder: string[]
  appCategory: Record<string, string>
  appOrder: Record<string, string[]>
}

// Server rows → the five fields every surface already reads.
export function shelfToState(data: {
  sections?: ShelfSection[]
  placement?: Record<string, string>
  order?: Record<string, string[]>
}): ShelfState {
  const sections = data.sections ?? []
  const customCategories: CategoryDef[] = []
  const labelOverrides: Record<string, string> = {}
  const categoryOrder: string[] = []
  for (const s of sections) {
    if (!s || !s.id) continue
    categoryOrder.push(s.id)
    const builtIn = DEFAULT_CATEGORY_DEFS.find((d) => d.id === s.id)
    if (builtIn) {
      if (s.label && s.label !== builtIn.label) labelOverrides[s.id] = s.label
      continue
    }
    customCategories.push({
      id: s.id,
      label: s.label || s.id,
      tint: (s.tint || 'blue') as TintName,
      icon: s.icon || '',
      custom: true,
    })
  }
  return {
    customCategories,
    labelOverrides,
    categoryOrder,
    appCategory: { ...(data.placement ?? {}) },
    appOrder: { ...(data.order ?? {}) },
  }
}

// The five fields → what the server stores.
export function shelfPayload(state: ShelfState, defs: CategoryDef[]): {
  sections: ShelfSection[]
  placement: { app_id: string; section_id: string }[]
} {
  const sections = defs.map((d) => ({ id: d.id, label: d.label, tint: d.tint, icon: d.icon }))
  const sectionOf = new Map<string, string>()
  for (const [appId, sectionId] of Object.entries(state.appCategory)) sectionOf.set(appId, sectionId)
  for (const [sectionId, ids] of Object.entries(state.appOrder)) {
    for (const appId of ids) if (!sectionOf.has(appId)) sectionOf.set(appId, sectionId)
  }
  const placement: { app_id: string; section_id: string }[] = []
  for (const section of sections) {
    const mine = [...sectionOf.entries()].filter(([, sid]) => sid === section.id).map(([id]) => id)
    for (const appId of sortAppsByOrder(mine.map((id) => ({ id })), state.appOrder[section.id])) {
      placement.push({ app_id: appId.id, section_id: section.id })
    }
  }
  // An app pointing at a section that no longer exists still travels, under the fallback — dropping it here would…
  for (const [appId, sectionId] of sectionOf) {
    if (!sections.some((s) => s.id === sectionId)) {
      placement.push({ app_id: appId, section_id: FALLBACK_CATEGORY_ID })
    }
  }
  return { sections, placement }
}

/** Slug for a new custom category id. */
export function categorySlug(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category'
  )
}
