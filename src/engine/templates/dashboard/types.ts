/** Shared types for the `dashboard` template (moved verbatim from DashboardTemplate.tsx). */
import type { TintName } from '@/engine/types'

/* ---------- persisted layout (asa-dash-layout:<pageId>) ---------- */

export type WidgetOverride = { title?: string; tint?: TintName; span?: 1 | 2; hidden?: boolean; note?: string }
export type AddedWidget = { id: string; kind: string; title?: string; span?: 1 | 2; config?: Record<string, any> }
// `catalog` holds the ids of page-suggested widgets the person turned ON — the page computes them live either way…
export type DashLayout = { order: string[]; overrides: Record<string, WidgetOverride>; added: AddedWidget[]; catalog: string[] }

/** `from` filter clause for data-computed widgets (see resolveWidget in utils.ts). */
export type WhereClause = { field: string; eq?: string; in?: string[] }

// A READY-MADE BOARD — a finished dashboard of the company's own information, picked in one selection: a named…
export type BoardPreset = { id: string; title: string; blurb: string; on: string[]; spans?: Record<string, 1 | 2> }
