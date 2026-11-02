/** Shared types for the `documents` template (moved verbatim from DocumentsTemplate.tsx). */
import type { TintName } from '@/engine/types'

export type CollectionCfg = { id: string; label: string; icon: string; tint: TintName }
export type ReaderCfg = {
  showToc?: boolean
  showMeta?: boolean
  allowPrint?: boolean
  /** Which side the "On this page" rail stands on. Default: right. */
  tocSide?: 'left' | 'right'
  // The action that turns THIS document into a filed PDF, when a page has one (ISP Library: `ispPlanPdf`).
  pdfAction?: string
}

/* ---------------- record extensions (course / draft fields ride along from seed) ---------------- */

export type CourseModule = { id: string; title: string; minutes: number }
export type DocExt = { kind?: 'course'; modules?: CourseModule[]; status?: 'draft' }

export type SortKey = 'updated' | 'title' | 'read'
