// Share sheet (global).
// Any table row, detail panel, document or image can ask to be shared without owning a modal: share({ title…
import { create } from 'zustand'
import type { ExportColumn } from '@/lib/exportTable'

export type SharePayload = {
  /** what is being shared — shown big in the sheet header */
  title: string
  subtitle?: string
  /** link to the thing itself (Drive file, PDF, external doc) */
  url?: string
  /** in-app route to this record — defaults to the current location */
  appHref?: string
  /** plain-text rendition (record fields, one per line) for copy + email body */
  text?: string
  /** table/record rows, when the share can also be a file download */
  rows?: any[]
  columns?: ExportColumn[]
  /** download filename base (no extension) */
  filename?: string
  /** lucide icon for the header tile */
  icon?: string
}

type ShareState = {
  payload: SharePayload | null
  share: (p: SharePayload) => void
  closeShare: () => void
}

export const useShareStore = create<ShareState>((set) => ({
  payload: null,
  share: (payload) => set({ payload }),
  closeShare: () => set({ payload: null }),
}))

/** Imperative helper — usable from event handlers outside React components. */
export const share = (p: SharePayload) => useShareStore.getState().share(p)

// Build the plain-text rendition of a record: "Label: value" per line, skipping empty fields.
export function recordToText(record: any, fields: { label: string; key: string }[]): string {
  const lines: string[] = []
  for (const f of fields) {
    const raw = record?.[f.key]
    const v = raw == null ? '' : String(raw).trim()
    if (!v) continue
    const parts = v.split(/\s+·\s+/).filter(Boolean)
    if (parts.length > 1) {
      lines.push(`${f.label}:`)
      parts.forEach((p) => lines.push(`  • ${p}`))
    } else {
      lines.push(`${f.label}: ${v}`)
    }
  }
  return lines.join('\n')
}
