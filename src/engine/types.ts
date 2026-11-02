// asa.
// — engine contracts.
import type { PageGate } from '@/lib/pageGate'

export type TintName = 'mint' | 'peach' | 'lavender' | 'pink' | 'blue' | 'amber' | 'green'

export type PageType =
  | 'dashboard'
  | 'sheet'
  | 'pipeline'
  | 'documents'
  | 'videos'
  | 'schedule'
  | 'detail'
  | 'board'
  // More MODELS matter more than more apps: a page type is reusable by every app that follows.
  | 'gallery'    // the content is the picture (Image Bank, house photos)
  | 'checklist'  // walk through it and tick it off (house audits, handovers)
  | 'timeline'   // what happened to this person / client / house

// Known resources keep autocomplete; any new resource string is also valid (wave-2 agents add datasets via…
export type ResourceName =
  | 'people'
  | 'candidates'
  | 'documents'
  | 'helpfulContacts'
  | 'videos'
  | 'events'
  | 'notifications'
  | 'apps'
  | 'activity'
  | (string & {})

export type DataSource = {
  resource: ResourceName
  action?: string
  params?: Record<string, unknown>
}

export type PageSchema = {
  id: string
  type: PageType
  title: string
  icon?: string
  dataSource: DataSource
  /** per-type options, handed to the template unchanged (see engine/README.md) */
  config: Record<string, unknown>
  /** a page narrower than its app (lib/pageGate); absent means the app's own reach */
  gate?: PageGate
  /** an App Control control that must open the page (lib/featureAccess, `<appId>.<control>`); absent means none */
  feature?: string
}

// `sheet` page config — typed surface for the sheet template's options (PageSchema.config stays a loose record…
export type SheetConfig = {
  /** show the CSV / Excel (.xls) / TXT ExportMenu in the toolbar (default true) */
  exportable?: boolean
  /** download filename base for exports (default: page title) */
  exportName?: string
  [key: string]: unknown
}

/** Built-in categories keep autocomplete, but the registry accepts any new category string. */
export type AppCategory = 'Workspace' | 'Manage' | 'Library' | (string & {})

export type AppManifest = {
  id: string
  name: string
  tagline: string
  icon: string // lucide icon name, e.g. "git-branch"
  accent: TintName
  category: AppCategory
  version: string
  isNew?: boolean
  enabled: boolean
  // ABSORBED — it stopped being a rung and did NOT stop existing.
  unlisted?: boolean
  pages: PageSchema[]
  notifications?: string[]
  // A NOTIFICATION APP — one with practically no interface of its own: it is an app of notifications, so its…
  interfaceless?: boolean
  settingsAnchor?: string
  // Where the manifest came from.
  source?: string
  // Visibility audience — OR-matched entries, filtered by `visibleManifests()` in src/lib/audience.ts (Sidebar, App…
  audience?: ('all' | 'client' | 'staff' | 'director' | 'form' | 'project' | 'house' | 'onboarding' | 'admin' | 'manager')[]
  // FOCUS AUDIENCE — the Person Focus Mode gate's own array, and the ONLY thing that gate reads when a manifest…
  focusAudience?: ('all' | 'client' | 'staff' | 'director' | 'form' | 'project' | 'house')[]
  // "Drag & drop name" — whether the real names this app shows can be dragged onto the sidebar's focus slot…
  dragFocus?: boolean
}

/* ---------- resource models ---------- */

export type Person = {
  id: string
  name: string
  role: string
  department: 'Engineering' | 'Design' | 'Ops' | 'G&A'
  email: string
  location: string
  avatar: string
  status: 'active' | 'away' | 'off'
  startDate: string // ISO
  skills: string[]
}

export type CandidateStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired'

export type Candidate = {
  id: string
  name: string
  role: string
  avatar: string
  stage: CandidateStage
  source: string
  daysInStage: number
  score: number // 0..5
  tags: string[]
  appliedAt: string // ISO
  email: string
}

export type DocBlock =
  | { kind: 'h2' | 'h3'; text: string; id: string }
  | { kind: 'p'; text: string }
  | { kind: 'callout'; tint: TintName; text: string }
  | { kind: 'code'; text: string }

export type Doc = {
  id: string
  title: string
  excerpt: string
  collection: string
  cover: string
  authorIds: string[]
  updatedAt: string // ISO
  readMinutes: number
  body: DocBlock[]
}

export type Video = {
  id: string
  title: string
  channel: string
  thumb: string
  durationSec: number
  views: number
  watched: number // 0..1 progress
  publishedAt: string // ISO
  description: string
  // Google Drive file id.
  driveId?: string
  // width / height of the source, when known — phone footage is portrait and letterboxes badly in a 16:9 stage.
  aspect?: number
  // the server holds the file (Python's listing): it plays from there, never from Drive's preview
  kept?: boolean
  keptMime?: string
}

export type CalEvent = {
  id: string
  title: string
  personId: string // resource (column) owner
  date: string // ISO yyyy-mm-dd
  start: string // "HH:mm"
  durationMin: number
  type: string // key into schedule config eventTypes
  attendees: string[] // person ids
  notes?: string
  // A MIRROR of something written elsewhere (the estate roster) — it has no row of its own to patch, so the…
  readOnly?: boolean
  /** display name of the column owner, when the row carries it (derived rows) */
  personName?: string
}

export type NotificationType = 'mention' | 'system' | 'app' | 'reminder'

export type AppNotification = {
  id: string
  type: NotificationType
  appId?: string
  actorId?: string
  title: string
  body: string
  createdAt: string // ISO
  read: boolean
  href?: string
  priority: 'low' | 'normal' | 'high'
  /** a company notice's weight (lib/noticesApi) */
  tone?: 'urgent' | 'good'
}

export type ActivityItem = {
  id: string
  actorId?: string
  actorName: string
  action: string // e.g. "moved Tom Becker to Offer"
  createdAt: string // ISO
  tint: TintName
}
