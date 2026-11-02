/** Record-value resolution helper (moved verbatim from DetailTemplate.tsx). */
import { format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import type { SharePayload } from '@/stores/useShareStore'

// Split a stored field into its real parts.
export function splitBullets(value: unknown): string[] {
  const s = value == null ? '' : String(value).trim()
  if (!s) return []
  // ISP prose is newline-first; only fall back to middot/semicolon when one line.
  const parts = s.includes('\n')
    ? s.split(/\n+/).map((p) => p.replace(/^[\s•·\-–]+/, '').trim()).filter(Boolean)
    : s.split(/\s+·\s+|\s*;\s+/).map((p) => p.trim()).filter(Boolean)
  return parts.filter((p) => p.length > 2)
}

// Turn a detail panel's own header + sections into the payload the share sheet needs.
export function shareFromPanel(config: any, record: any): SharePayload {
  const title = String(resolve(record, config?.header?.title) ?? 'Record')
  const subtitle = config?.header?.subtitle ? String(resolve(record, config.header.subtitle) ?? '') : undefined
  const lines: string[] = []
  for (const stat of config?.stats ?? []) {
    const v = resolve(record, stat.value)
    if (v != null && String(v).trim()) lines.push(`${stat.label}: ${v}`)
  }
  for (const section of config?.sections ?? []) {
    const rows: string[] = []
    if (section.kind === 'fields' || section.kind === 'bullets') {
      for (const f of section.fields ?? []) {
        const v = resolve(record, f.value)
        const text = v == null ? '' : f.icon === 'phone' ? formatPhoneDisplay(v) : String(v).trim()
        if (!text) continue
        const parts = splitBullets(text)
        if (parts.length > 1) {
          rows.push(`${f.label}:`)
          parts.forEach((p) => rows.push(`  • ${p}`))
        } else {
          rows.push(`${f.label}: ${text}`)
        }
      }
    }
    if (rows.length > 0) {
      lines.push('', section.title ? `— ${section.title} —` : '—', ...rows)
    }
  }
  return { title, subtitle, text: lines.join('\n'), filename: title, icon: config?.shareIcon }
}

export function resolve(record: any, value: any): any {
  if (value == null || typeof value !== 'string') return value
  if (!record) return value
  if (value in record) {
    const v = record[value]
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      // Ohio's clock decides the day: a bare `yyyy-mm-dd` comes back as itself, a full stamp is re-read there.
      const d = ohioWall(v)
      if (d) return format(d, 'MMM d, yyyy')
    }
    return v
  }
  if (value.includes('.')) {
    const v = value.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), record)
    if (v != null && typeof v !== 'object') {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        const d = ohioWall(v)
        if (d) return format(d, 'MMM d, yyyy')
      }
      return v
    }
    return undefined
  }
  // Missing field — never echo the template key as displayed data.
  return undefined
}
