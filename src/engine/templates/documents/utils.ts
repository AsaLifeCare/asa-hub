/** Pure helpers for the `documents` template (moved verbatim from DocumentsTemplate.tsx). */
import type { Doc, DocBlock, TintName } from '@/engine/types'
import type { CourseModule, DocExt } from './types'

/** stable pseudo-random from a string (reader stats, demo fallbacks) */
export const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0)
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export const ext = (d: Doc) => d as Doc & DocExt
export const isCourse = (d: Doc) => ext(d).kind === 'course' && Array.isArray(ext(d).modules)
export const modulesOf = (d: Doc): CourseModule[] => (isCourse(d) ? (ext(d).modules as CourseModule[]) : [])
export const courseMinutes = (d: Doc) => modulesOf(d).reduce((a, m) => a + m.minutes, 0)
export const fmtMinutes = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${min} min`)

// ---------------- reading any resource in the library layout ---------------- Some records are documents that…
export type DocMapSection = {
  heading: string
  field: string
  /** render as a tinted callout instead of body text — for what must not be missed */
  callout?: TintName
  /** drop the section when the record has no value (default) vs. show "Not recorded" */
  keepEmpty?: boolean
}

export type DocMap = {
  title: string
  subtitle?: string
  excerpt?: string
  updatedAt?: string
  cover?: string
  /** a record field to group by, with an optional id prefix, or a fixed id */
  collection?: string | { field: string; prefix?: string }
  sections: DocMapSection[]
}

/** Split a stored multi-value field the way it was written (" · ", ";", newlines). */
const paragraphs = (value: unknown): string[] =>
  String(value ?? '')
    .split(/\s+·\s+|\s*[;\n]\s*/)
    .map((p) => p.trim())
    .filter(Boolean)

/** Roughly how long this takes to read — 200 wpm, never less than a minute. */
const readMinutes = (text: string) => Math.max(1, Math.round(text.split(/\s+/).length / 200))

export function recordToDoc(record: any, map: DocMap): Doc {
  const body: DocBlock[] = []
  let plain = ''
  for (const s of map.sections) {
    const parts = paragraphs(record?.[s.field])
    if (parts.length === 0 && !s.keepEmpty) continue
    body.push({ kind: 'h2', text: s.heading, id: slug(s.heading) })
    if (parts.length === 0) {
      body.push({ kind: 'p', text: 'Not recorded.' })
      continue
    }
    for (const p of parts) {
      body.push(s.callout ? { kind: 'callout', tint: s.callout, text: p } : { kind: 'p', text: p })
      plain += ` ${p}`
    }
  }
  const collectionId =
    typeof map.collection === 'string'
      ? map.collection
      : map.collection
        ? `${map.collection.prefix ?? ''}${slug(String(record?.[map.collection.field] ?? 'other'))}`
        : 'all'
  const excerptSource = map.excerpt ? record?.[map.excerpt] : plain.trim()
  return {
    id: String(record?.id ?? slug(String(record?.[map.title] ?? 'record'))),
    title: String(record?.[map.title] ?? 'Untitled'),
    excerpt: String(excerptSource ?? '').slice(0, 220),
    collection: collectionId,
    cover: String((map.cover ? record?.[map.cover] : '') ?? ''),
    authorIds: [],
    updatedAt: String((map.updatedAt ? record?.[map.updatedAt] : '') || new Date().toISOString()),
    readMinutes: readMinutes(plain),
    body,
  }
}

/** Collections derived from the records themselves, so the rail is never stale. */
export function collectionsFromRecords(
  records: any[],
  map: DocMap,
  cfg?: { icon?: string; tints?: TintName[]; sort?: 'asc' | 'desc' },
): { id: string; label: string; icon: string; tint: TintName }[] {
  if (!map.collection || typeof map.collection === 'string') return []
  const { field, prefix = '' } = map.collection
  const tints = cfg?.tints ?? (['blue', 'mint', 'lavender', 'peach', 'amber', 'pink'] as TintName[])
  const seen = new Map<string, string>()
  for (const r of records) {
    const label = String(r?.[field] ?? '').trim()
    if (!label) continue
    const id = `${prefix}${slug(label)}`
    if (!seen.has(id)) seen.set(id, label)
  }
  // desc suits date-span rails (newest first); people read A→Z.
  return [...seen.entries()]
    .sort((a, b) => (cfg?.sort === 'asc' ? a[1].localeCompare(b[1]) : b[1].localeCompare(a[1])))
    .map(([id, label], i) => ({ id, label, icon: cfg?.icon ?? 'folder', tint: tints[i % tints.length] }))
}
