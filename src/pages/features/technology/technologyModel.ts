// TECHNOLOGY — the shapes the three reads answer with, the formatting the screen shares with its black header, and…
// The figures live here rather than inside the header so they can be held to a fixture without drawing a screen.
import type { ExtendedTintName } from '@/lib/tints'

/* ── slice row shapes (server/technology_slices.py) ── */
export interface TechProject {
  id?: string
  name?: string
  category?: string
  status?: string
  status_default?: string
  status_source?: string
  blurb?: string
  strengths?: string   // ' · '-joined, the hub `projects` resource convention
  gaps?: string        // ' · '-joined
  file_count?: number
  size_bytes?: number
  recent_files?: string // ', '-joined
  assessed?: string
  platform?: string
  live?: string
  manual?: string
}

export interface TechEngRow {
  id?: string
  kind?: 'meta' | 'figure' | 'strength' | 'issue'
  // meta
  version?: string
  audit_date?: string
  verified_date?: string
  state?: string
  recently_fixed?: string
  open_gaps?: number
  // figure
  label?: string
  value?: string
  hint?: string
  // strength / issue
  title?: string
  detail?: string
  section?: string
  severity?: string
  area?: string
  evidence?: string
  status?: string
  verified?: string
}

/* ── Drive listing shapes (the techDocs slice) ── */
export interface TechDoc {
  id?: string
  name?: string
  rel?: string
  category?: string
  case?: string
  trail?: string
  ext?: string // pdf | word | image | sheet | text | video
  size_bytes?: number
  modified_time?: string
  web_view_link?: string
  /** the server holds its own copy (the app on Python): it opens and downloads from there, never from Drive */
  kept?: boolean
  /** the server's copy (or its PDF) can be shown in the reader */
  viewable?: boolean
  mime?: string
}

/** A kept document's bytes, as techDocFile hands them over. */
export interface TechDocBytes {
  name?: string
  mime?: string
  size?: number
  exported?: boolean
  b64?: string
}

export interface TechDocsListing {
  configured?: boolean
  reason?: string
  folder_id?: string
  folder_name?: string
  folder_url?: string
  updated_at?: string
  truncated?: boolean
  /** some folder listings failed: every file listed is real, but not every file was listed */
  partial?: boolean
  partial_reason?: string
  files?: TechDoc[]
}

/** What one of the three reads is doing right now. */
export type TechRead =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'failed'; why: string }

/* ── formatting shared by the screen and its header ── */
export function fmtSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* project status → tint (the portfolio's vocabulary plus its dropdown choices) */
export const PROJ_STATUS_TINT: Record<string, ExtendedTintName> = {
  live: 'mint', operational: 'blue', in_use: 'blue', framework: 'lavender',
  experimental: 'amber', early: 'peach', archived: 'slate', unassessed: 'pink',
  'not started': 'slate', 'in progress': 'amber', concluded: 'mint',
  'on hold': 'peach',
}

export const projTint = (status?: string): ExtendedTintName =>
  PROJ_STATUS_TINT[(status || '').toLowerCase()] ?? 'slate'

// THE WRITE LANES COME INSIDE.
export const TECH_STATUSES = ['Not started', 'In progress', 'Blocked', 'Done', 'Retired'] as const

export const projLabel = (status?: string): string => {
  const s = (status || '').toLowerCase()
  if (s === 'in_use') return 'In use'
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unassessed'
}

/* ── the headline figures ── */

// One figure: a number this screen read, or `null` with the reason it has none.
export type TechFigure = { value: number | null; sub: string; atLeast?: boolean }

/** One slice of the status band — a partition of the portfolio, never overlapping. */
export type TechBand = { label: string; tint: ExtendedTintName; n: number }

export type TechFigures = {
  projects: TechFigure
  files: TechFigure
  gaps: TechFigure
  documents: TechFigure
  band: TechBand[]
  /** the line under the figures: when each read last answered, and what did not */
  note: string
}

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many)

// The four figures of the Technology header, each from the read that owns it: the portfolio slice, the same slice's…
export function technologyFigures(input: {
  projects: TechProject[] | null
  projectsRead: TechRead
  eng: TechEngRow[] | null
  engRead: TechRead
  listing: TechDocsListing | null
  docsRead: TechRead
}): TechFigures {
  const { projectsRead, engRead, docsRead } = input
  const rows = input.projects ?? []
  const engRows = input.eng ?? []

  const projectsFigure: TechFigure = projectsRead.state === 'failed'
    ? { value: null, sub: `The portfolio could not be read — ${projectsRead.why}` }
    : projectsRead.state === 'loading'
      ? { value: null, sub: 'Reading the portfolio…' }
      : {
        value: rows.length,
        sub: rows.length
          ? `${rows.filter((p) => p.assessed === 'yes').length} assessed · ` +
            `${rows.filter((p) => p.manual === 'yes').length} hand-tracked`
          : 'Nothing on the portfolio yet',
      }

  // A LISTING THAT CARRIES A REASON IS A LISTING THAT FAILED.
  const listingWhy = String(input.listing?.reason ?? '').trim()
  const listingFailed = !!input.listing && input.listing.configured !== false && !!listingWhy
  const partialWhy = input.listing?.partial
    ? String(input.listing.partial_reason ?? '').trim() || 'some folder listings failed'
    : ''
  const listingDown = docsRead.state === 'failed' || listingFailed || input.listing?.configured === false

  const fileCount = rows.reduce((s, p) => s + (Number(p.file_count) || 0), 0)
  const fileBytes = rows.reduce((s, p) => s + (Number(p.size_bytes) || 0), 0)
  const withFiles = rows.filter((p) => (Number(p.file_count) || 0) > 0).length
  // the project file counts are cut from the same Drive listing: with that listing down, a total of 0 is the failed…
  const filesFigure: TechFigure = projectsRead.state !== 'ready'
    ? { ...projectsFigure, sub: projectsFigure.sub }
    : !fileCount && listingDown
      ? { value: null, sub: 'The project files come from the Drive listing, which could not be read' }
      : {
        value: fileCount,
        atLeast: !!partialWhy || undefined,
        sub: fileCount
          ? `${partialWhy ? 'at least — ' : ''}${fmtSize(fileBytes) || 'size unknown'} across ` +
            `${withFiles} ${plural(withFiles, 'project')}`
          : 'No project folder has been walked yet',
      }

  const meta = engRows.find((r) => r.kind === 'meta') ?? null
  const issues = engRows.filter((r) => r.kind === 'issue').length
  const gapsFigure: TechFigure = engRead.state === 'failed'
    ? { value: null, sub: `The engineering assessment could not be read — ${engRead.why}` }
    : engRead.state === 'loading'
      ? { value: null, sub: 'Reading the engineering assessment…' }
      : !meta
        ? { value: null, sub: 'No assessment is on file yet' }
        : {
          value: Number(meta.open_gaps) || 0,
          sub: [
            `${issues} ${plural(issues, 'issue')} listed`,
            meta.audit_date ? `audit ${meta.audit_date}` : '',
          ].filter(Boolean).join(' · '),
        }

  const files = Array.isArray(input.listing?.files) ? input.listing.files.filter((f) => f && f.name) : []
  const docBytes = files.reduce((s, f) => s + (Number(f.size_bytes) || 0), 0)
  const documentsFigure: TechFigure = docsRead.state === 'failed'
    ? { value: null, sub: `The technology folder could not be listed — ${docsRead.why}` }
    : input.listing && input.listing.configured === false
      ? { value: null, sub: listingWhy || 'The technology folder is not configured yet' }
      : listingFailed
        ? { value: null, sub: `The technology folder could not be listed — ${listingWhy}` }
        : docsRead.state === 'loading' || !input.listing
          ? { value: null, sub: 'Listing the technology folder…' }
          : {
            value: files.length,
            atLeast: !!partialWhy || undefined,
            sub: [
              partialWhy ? `at least — ${partialWhy}` : '',
              fmtSize(docBytes),
              input.listing.updated_at ? `listed ${fmtDate(input.listing.updated_at)}` : '',
              input.listing.truncated ? 'the folder holds more than this list' : '',
            ].filter(Boolean).join(' · ') || 'Every file in the technology Drive folder',
          }

  /* the band partitions the portfolio by its status word — one project, one slice */
  const byStatus = new Map<string, number>()
  if (projectsRead.state === 'ready') {
    for (const p of rows) {
      const key = projLabel(p.status)
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1)
    }
  }
  const band: TechBand[] = [...byStatus.entries()]
    .map(([label, n]) => ({ label, tint: projTint(label === 'In use' ? 'in_use' : label), n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))

  const missed = [
    projectsRead.state === 'failed' ? 'the portfolio' : '',
    engRead.state === 'failed' ? 'the engineering assessment' : '',
    docsRead.state === 'failed' || listingFailed ? 'the document folder' : '',
  ].filter(Boolean)
  const note = missed.length
    ? `${missed.join(', ')} could not be read — the figures above are unknown, not zero`
    : partialWhy
      ? `The document folder was only partly listed (${partialWhy}) — its counts are a floor, not the total`
      : 'The portfolio, the platform assessment and the Drive folder, each read on its own'

  return { projects: projectsFigure, files: filesFigure, gaps: gapsFigure, documents: documentsFigure, band, note }
}
