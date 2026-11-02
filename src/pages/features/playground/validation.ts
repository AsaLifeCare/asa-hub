// Playground JSON validation — live, inline, with best-effort line hints.
// Used by the PAGE SCHEMA and SAMPLE DATA editors and by the publish gate.

import type { PageType } from '@/engine/types'
import type { RearrangeToggles } from './rearrange'
import { PAGE_TYPES } from './starters'

export type JsonCheck =
  | { ok: true; value: any }
  | { ok: false; message: string; line?: number }

/** Parse JSON text; on failure, surface the engine's line hint when available. */
export function checkJson(text: string): JsonCheck {
  if (!text.trim()) return { ok: false, message: 'Empty — paste or type some JSON.' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // V8 (Chrome/Edge/Node ≥20): "… in JSON at position 123 (line 4 column 7)"
    const lc = raw.match(/line (\d+) column (\d+)/)
    if (lc) return { ok: false, message: raw.replace(/\s*\(line \d+ column \d+\)\s*$/, ''), line: Number(lc[1]) }
    // Older V8: "… in JSON at position 123" → derive the line from the offset
    const pos = raw.match(/position (\d+)/)
    if (pos) {
      const offset = Number(pos[1])
      const line = text.slice(0, offset).split('\n').length
      return { ok: false, message: raw, line }
    }
    return { ok: false, message: raw }
  }
}

export type ConfigCheck =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string; line?: number }

/** PAGE SCHEMA config must be a JSON object. */
export function checkConfig(text: string): ConfigCheck {
  const res = checkJson(text)
  if (!res.ok) return res
  const v = res.value
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, message: 'The page config must be a JSON object — { … }.' }
  }
  return { ok: true, config: v }
}

export type RowsCheck =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; message: string; line?: number; index?: number }

// SAMPLE DATA must be an array of objects, each with a unique string `id`.
export function checkRows(text: string): RowsCheck {
  const res = checkJson(text)
  if (!res.ok) return res
  const v = res.value
  if (!Array.isArray(v)) return { ok: false, message: 'Sample data must be a JSON array — [ … ].' }
  const seen = new Set<string>()
  for (let i = 0; i < v.length; i++) {
    const row = v[i]
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, message: `Row ${i} must be an object.`, index: i }
    }
    const id = (row as Record<string, unknown>).id
    if (typeof id !== 'string' || !id) {
      return { ok: false, message: `Row ${i} needs a non-empty string "id".`, index: i }
    }
    if (seen.has(id)) {
      return { ok: false, message: `Row ${i} reuses id "${id}" — ids must be unique.`, index: i }
    }
    seen.add(id)
  }
  return { ok: true, rows: v }
}

/* ---------------- export/import bundle ---------------- */

/** The `kind` marker every playground export carries — imports refuse anything else. */
export const BUNDLE_KIND = 'asa-playground-app'
/** The most pages a bundle may hold (the server's APP_BUILDER_MAX_PAGES). */
export const MAX_BUNDLE_PAGES = 12

/** One page inside an exported bundle — parsed objects, not editor texts. */
export type BundlePage = {
  id: string
  type: PageType
  title: string
  resource: string
  config: Record<string, unknown>
  rows: Record<string, unknown>[]
  toggles?: RearrangeToggles
}

export type PlaygroundBundle = {
  kind: typeof BUNDLE_KIND
  version: number
  exportedAt?: string
  app: {
    name: string
    tagline?: string
    icon?: string
    accent?: string
    category?: string
    audience?: string[]
    pages: BundlePage[]
  }
}

export type BundleCheck =
  | { ok: true; bundle: PlaygroundBundle }
  | { ok: false; message: string; line?: number }

const KNOWN_PAGE_TYPES = new Set<string>(PAGE_TYPES.map((t) => t.id))

// Validate pasted/uploaded bundle JSON.
export function checkBundle(text: string): BundleCheck {
  const res = checkJson(text)
  if (!res.ok) return res
  const v = res.value
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, message: 'The bundle must be a JSON object — { … }.' }
  }
  if (v.kind !== BUNDLE_KIND) {
    return { ok: false, message: `Not a playground bundle — "kind" must be "${BUNDLE_KIND}".` }
  }
  const app = v.app as Record<string, unknown>
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    return { ok: false, message: 'The bundle needs an "app" object.' }
  }
  if (typeof app.name !== 'string' || !app.name.trim()) {
    return { ok: false, message: 'The app needs a non-empty "name".' }
  }
  const pages = app.pages
  if (!Array.isArray(pages) || pages.length === 0) {
    return { ok: false, message: 'The app needs at least one page.' }
  }
  if (pages.length > MAX_BUNDLE_PAGES) {
    return { ok: false, message: `An app holds at most ${MAX_BUNDLE_PAGES} pages; this bundle has ${pages.length}.` }
  }
  const out: BundlePage[] = []
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i] as Record<string, unknown>
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { ok: false, message: `Page ${i + 1} must be an object.` }
    }
    if (typeof p.type !== 'string' || !KNOWN_PAGE_TYPES.has(p.type)) {
      return { ok: false, message: `Page ${i + 1} has an unknown page type "${String(p.type)}".` }
    }
    if (p.config === null || typeof p.config !== 'object' || Array.isArray(p.config)) {
      return { ok: false, message: `Page ${i + 1} needs a config object — { … }.` }
    }
    if (!Array.isArray(p.rows)) {
      return { ok: false, message: `Page ${i + 1} needs a rows array — [ … ].` }
    }
    if (p.toggles !== undefined && (p.toggles === null || typeof p.toggles !== 'object' || Array.isArray(p.toggles))) {
      return { ok: false, message: `Page ${i + 1} has malformed toggles.` }
    }
    out.push({
      id: typeof p.id === 'string' && p.id ? p.id : `page-${i + 1}`,
      type: p.type as PageType,
      title: typeof p.title === 'string' ? p.title : '',
      resource: typeof p.resource === 'string' ? p.resource : '',
      config: p.config as Record<string, unknown>,
      rows: p.rows as Record<string, unknown>[],
      toggles: p.toggles as RearrangeToggles | undefined,
    })
  }
  return {
    ok: true,
    bundle: {
      kind: BUNDLE_KIND,
      version: typeof v.version === 'number' ? v.version : 1,
      exportedAt: typeof v.exportedAt === 'string' ? v.exportedAt : undefined,
      app: {
        name: app.name.trim(),
        tagline: typeof app.tagline === 'string' ? app.tagline : undefined,
        icon: typeof app.icon === 'string' ? app.icon : undefined,
        accent: typeof app.accent === 'string' ? app.accent : undefined,
        category: typeof app.category === 'string' ? app.category : undefined,
        audience: Array.isArray(app.audience) ? app.audience.filter((a): a is string => typeof a === 'string') : undefined,
        pages: out,
      },
    },
  }
}
