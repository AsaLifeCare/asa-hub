// LIVE-RESOURCE BINDING + SCHEMA CHECK.
// A playground page's data source is either a NEW TAB (the default — publish mints `pg_<slug>` and the server…
import type { AppManifest, PageType } from '@/engine/types'

/* ---------------- bindable resources ---------------- */

/** A resource a playground page can bind to, with the apps that already read it. */
export type BindableResource = { resource: string; usedBy: string[] }

// Every resource the live registry references, minus playground-owned tabs (`pg_*` — binding to another playground…
export function listBindableResources(apps: AppManifest[]): BindableResource[] {
  const byResource = new Map<string, Set<string>>()
  for (const app of apps) {
    for (const page of app.pages ?? []) {
      const resource = page.dataSource?.resource
      if (!resource || resource.startsWith('pg_')) continue
      const set = byResource.get(resource) ?? new Set<string>()
      set.add(app.name)
      byResource.set(resource, set)
    }
  }
  return [...byResource.entries()]
    .map(([resource, usedBy]) => ({ resource, usedBy: [...usedBy].sort() }))
    .sort((a, b) => a.resource.localeCompare(b.resource))
}

// A draft resource that is neither empty nor `pg_*` is a BINDING to a live resource; anything else means "mint a…
export const isBoundResource = (resource: string): boolean =>
  Boolean(resource) && !resource.startsWith('pg_')

/* ---------------- schema check ---------------- */

/** One row-key reference found in a page config, labelled for the warning. */
export type KeyRef = {
  /** Human label for the warning, e.g. `config column 'owner'`. */
  where: string
  /** The row key the config expects. */
  key: string
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

// The row keys a page config REFERENCES, per template family: - sheet → columns[].key - pipeline / board →…
export function configKeyRefs(type: PageType, config: Record<string, unknown>): KeyRef[] {
  const refs: KeyRef[] = []
  const push = (where: string, key: unknown) => {
    const k = str(key)
    if (k) refs.push({ where, key: k })
  }

  if (type === 'sheet') {
    const cols = Array.isArray(config.columns) ? config.columns : []
    for (const c of cols) {
      const key = str((c as { key?: unknown })?.key)
      if (key) push(`config column '${key}'`, key)
    }
  }

  if (type === 'pipeline' || type === 'board') {
    push(`stageField '${str(config.stageField) ?? ''}'`, config.stageField)
    const cf = (config.cardFields ?? {}) as Record<string, unknown>
    push(`cardFields.title '${str(cf.title) ?? ''}'`, cf.title)
    push(`cardFields.subtitle '${str(cf.subtitle) ?? ''}'`, cf.subtitle)
    push(`cardFields.tags '${str((cf.tags as { key?: unknown })?.key) ?? ''}'`, (cf.tags as { key?: unknown })?.key)
    const meta = Array.isArray(cf.meta) ? cf.meta : []
    for (const m of meta) push(`cardFields.meta '${str(m) ?? ''}'`, m)
    push(`cardFields.score '${str((cf.score as { key?: unknown })?.key) ?? ''}'`, (cf.score as { key?: unknown })?.key)
  }

  if (type === 'gallery' || type === 'checklist' || type === 'timeline') {
    for (const [configKey, value] of Object.entries(config)) {
      if (configKey.endsWith('Key') || (type === 'gallery' && configKey === 'groupBy')) {
        push(`${configKey} '${str(value) ?? ''}'`, value)
      }
    }
  }

  if (type === 'detail') {
    const header = (config.header ?? {}) as Record<string, unknown>
    for (const k of ['title', 'subtitle', 'avatar']) push(`header.${k} '${str(header[k]) ?? ''}'`, header[k])
    push(`statusChip field '${str((header.statusChip as { field?: unknown })?.field) ?? ''}'`, (header.statusChip as { field?: unknown })?.field)
    const stats = Array.isArray(config.stats) ? config.stats : []
    for (const s of stats) {
      const value = str((s as { value?: unknown })?.value)
      const label = str((s as { label?: unknown })?.label)
      if (value) push(`stat '${label ?? value}' → '${value}'`, value)
    }
  }

  // the same key referenced twice warns once
  const seen = new Set<string>()
  return refs.filter((r) => !seen.has(r.key) && seen.add(r.key))
}

export type SchemaVerdict =
  | { state: 'clean'; liveKeys: string[] }
  | { state: 'missing'; missing: KeyRef[]; liveKeys: string[] }

/** Compare a config's key references against the keys of one live row. */
export function checkSchema(type: PageType, config: Record<string, unknown>, liveKeys: string[]): SchemaVerdict {
  const live = new Set(liveKeys)
  const missing = configKeyRefs(type, config).filter((r) => !live.has(r.key))
  return missing.length ? { state: 'missing', missing, liveKeys } : { state: 'clean', liveKeys }
}
