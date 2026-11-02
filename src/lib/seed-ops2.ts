// Ops-2 seed (ops-flows wave) — `projects` dataset for the Projects app.
// Cross-program initiatives with progress, ownership and linked documentation.
import { addDays, subDays } from 'date-fns'
import { people } from './seed'
import { withTenant } from '@/lib/tenancy'

const iso = (d: Date) => d.toISOString()
const now = new Date()
const pad = (n: number) => String(n).padStart(3, '0')

export type ProjectDocLink = {
  id: string // knowledge doc id (d-NN) or care doc id (cdoc-NN)
  title: string
  href: string
}

export type ProjectType = 'client' | 'internal' | 'automation'
export type ProjectVisibility = 'all' | 'directors'

export type Project = {
  id: string
  code: string // PRJ-001…
  title: string
  owner: string
  ownerAvatar: string
  avatar: string // mirror of ownerAvatar (sheet avatar+text cell reads row.avatar)
  status: 'on-track' | 'at-risk' | 'blocked' | 'done'
  progress: number // 0..1 (progress-bar column)
  progressPct: number // 0..100 (detail stats)
  due: string // ISO
  house: string
  area: string
  // sweep: automation type + director-only visibility (rows are REMOVED for non-director roles in the sheet's data…
  type: ProjectType
  typeLabel: string // CLIENT / INTERNAL / AUTOMATION chip copy
  visibility: ProjectVisibility
  visibilityLabel: string // ALL STAFF / DIRECTORS ONLY chip copy
  description: string
  docLinks: ProjectDocLink[]
  docCount: number
}

const KNOWLEDGE = '/app/docs/library'
const kdoc = (n: number, title: string): ProjectDocLink => ({
  id: `d-${String(n).padStart(2, '0')}`,
  title,
  href: KNOWLEDGE,
})
const cdoc = (n: number, title: string): ProjectDocLink => ({
  id: `cdoc-${String(n).padStart(2, '0')}`,
  title,
  href: KNOWLEDGE,
})

const ownerAt = (i: number) => {
  const p = people[(i * 7 + 2) % people.length]
  return { owner: p.name, ownerAvatar: p.avatar, avatar: p.avatar }
}

const PROJECT_DEFS: Array<{
  title: string
  status: Project['status']
  progressPct: number
  dueInDays: number
  house: string
  area: string
  type: ProjectType
  visibility: ProjectVisibility
  description: string
  docLinks: ProjectDocLink[]
}> = [
  {
    title: 'MUI reporting workflow overhaul',
    status: 'on-track',
    progressPct: 72,
    dueInDays: 18,
    house: 'All houses',
    area: 'Compliance',
    type: 'client',
    visibility: 'all',
    description: 'Streamline the 4-hour verbal / 24-hour written MUI reporting path with checklist-driven escalation and automatic SSA notification.',
    docLinks: [kdoc(4, 'Incident Response Runbook'), kdoc(1, 'Remote Work Policy'), cdoc(4, 'BSP — Reducing elopement risk')],
  },
  {
    title: 'Maple House kitchen renovation',
    status: 'at-risk',
    progressPct: 45,
    dueInDays: 26,
    house: 'Maple House',
    area: 'Facilities',
    type: 'internal',
    visibility: 'all',
    description: 'Accessible counters, induction range and roll-under sink. Temporary meal plan runs out of Cedar House during weeks 3–5.',
    docLinks: [kdoc(6, 'Expense & Travel Policy'), kdoc(9, 'Security Awareness Handbook')],
  },
  {
    title: 'EVV compliance cleanup (Q3)',
    status: 'blocked',
    progressPct: 61,
    dueInDays: 9,
    house: 'All houses',
    area: 'Billing',
    type: 'internal',
    visibility: 'all',
    description: 'Reconcile unverified visits against the state aggregator before the quarterly billing attestation. Blocked on Sandata credential renewal.',
    docLinks: [kdoc(7, 'API Style Guide'), kdoc(4, 'Incident Response Runbook')],
  },
  {
    title: 'New-hire onboarding revamp',
    status: 'on-track',
    progressPct: 84,
    dueInDays: 14,
    house: 'All houses',
    area: 'People',
    type: 'internal',
    visibility: 'all',
    description: 'Cut time-to-floor-ready from 21 to 14 days: consolidated packet, DODD orientation scheduling automation and med-pass shadowing tracker.',
    docLinks: [kdoc(5, 'Onboarding: First 30 Days'), kdoc(2, 'Hiring Playbook'), kdoc(1, 'Remote Work Policy')],
  },
  {
    title: 'Medication room standardization',
    status: 'on-track',
    progressPct: 58,
    dueInDays: 33,
    house: 'Cedar House',
    area: 'Nursing',
    type: 'client',
    visibility: 'all',
    description: 'Standardize locked storage, double-count logs and MAR station layout across all four houses ahead of the DODD med-admin audit.',
    docLinks: [kdoc(9, 'Security Awareness Handbook'), cdoc(1, 'ISP — Danny W. (2025)')],
  },
  {
    title: 'Family portal launch',
    status: 'at-risk',
    progressPct: 37,
    dueInDays: 21,
    house: 'All houses',
    area: 'Communications',
    type: 'client',
    visibility: 'all',
    description: 'Monthly updates, outing photos and guardian document signing in one place. Privacy review pending for photo consent flow.',
    docLinks: [kdoc(8, 'Brand Voice & Tone'), cdoc(7, 'Family update — March'), cdoc(9, 'Guardian welcome packet')],
  },
  {
    title: 'Behavior support plan digitization',
    status: 'on-track',
    progressPct: 66,
    dueInDays: 40,
    house: 'Birch House',
    area: 'Clinical',
    type: 'client',
    visibility: 'all',
    description: 'Move paper BSPs into the document library with versioned reviews and 90-day interdisciplinary sign-off reminders.',
    docLinks: [cdoc(4, 'BSP — Reducing elopement risk'), cdoc(5, 'BSP — Self-injury prevention'), cdoc(6, 'BSP — Transition anxiety')],
  },
  {
    title: 'Vehicle fleet GPS & maintenance tracking',
    status: 'done',
    progressPct: 100,
    dueInDays: -12,
    house: 'All houses',
    area: 'Transportation',
    type: 'internal',
    visibility: 'all',
    description: 'Telematics on all four vehicles with odometer-driven maintenance tickets. Completed under budget; report attached.',
    docLinks: [kdoc(6, 'Expense & Travel Policy')],
  },
  {
    title: 'Waiver documentation audit prep',
    status: 'blocked',
    progressPct: 29,
    dueInDays: 12,
    house: 'Willow House',
    area: 'Compliance',
    type: 'client',
    visibility: 'all',
    description: 'Assemble ISP, MAR and service-delivery evidence for the county board accreditation visit. Blocked on two unsigned ISP addenda.',
    docLinks: [cdoc(1, 'ISP — Danny W. (2025)'), cdoc(2, 'ISP — Rosa D. (2025)'), cdoc(3, 'ISP — Kenny M. (2025)')],
  },
  {
    title: 'Staff retention & recognition program',
    status: 'on-track',
    progressPct: 51,
    dueInDays: 55,
    house: 'All houses',
    area: 'People',
    type: 'internal',
    visibility: 'all',
    description: 'Milestone recognition, referral bonuses and stay-interview program targeting first-year DSP turnover below 30%.',
    docLinks: [kdoc(2, 'Hiring Playbook'), kdoc(5, 'Onboarding: First 30 Days'), kdoc(3, 'Design System Principles')],
  },
  // director-only rows are removed for other roles in the data layer
  {
    title: 'Med-delivery sync automation',
    status: 'on-track',
    progressPct: 64,
    dueInDays: 24,
    house: 'All houses',
    area: 'Automation',
    type: 'automation',
    visibility: 'all',
    description: 'Nightly sync between the pharmacy delivery manifest and house MAR stations. Flags mismatched deliveries before the morning med pass.',
    docLinks: [kdoc(7, 'API Style Guide'), kdoc(4, 'Incident Response Runbook')],
  },
  {
    title: 'Shift reconciliation pipeline',
    status: 'on-track',
    progressPct: 48,
    dueInDays: 31,
    house: 'All houses',
    area: 'Automation',
    type: 'automation',
    visibility: 'directors',
    description: 'Directors only — no direct staff contact. Automated payroll reconciliation of scheduled vs. verified EVV hours; exception queue routes to the payroll director.',
    docLinks: [kdoc(6, 'Expense & Travel Policy'), kdoc(7, 'API Style Guide')],
  },
  {
    title: 'EVV auto-verification',
    status: 'at-risk',
    progressPct: 39,
    dueInDays: 17,
    house: 'All houses',
    area: 'Automation',
    type: 'automation',
    visibility: 'all',
    description: 'GPS + schedule cross-check that auto-verifies routine visits and surfaces only true exceptions for manual review.',
    docLinks: [kdoc(7, 'API Style Guide')],
  },
  {
    title: 'Family portal digest',
    status: 'on-track',
    progressPct: 55,
    dueInDays: 28,
    house: 'All houses',
    area: 'Automation',
    type: 'automation',
    visibility: 'directors',
    description: 'Directors only — no direct staff contact. Weekly automated guardian digest assembled from progress notes and outing photos; send-list governance under review.',
    docLinks: [kdoc(8, 'Brand Voice & Tone'), cdoc(7, 'Family update — March')],
  },
]

const TYPE_LABELS: Record<ProjectType, string> = { client: 'CLIENT', internal: 'INTERNAL', automation: 'AUTOMATION' }
const VISIBILITY_LABELS: Record<ProjectVisibility, string> = { all: 'ALL STAFF', directors: 'DIRECTORS ONLY' }

export const projects: Project[]  = withTenant(PROJECT_DEFS.map((def, i) => ({
  id: `prj-${pad(i + 1)}`,
  code: `PRJ-${pad(i + 1)}`,
  title: def.title,
  ...ownerAt(i),
  status: def.status,
  progress: def.progressPct / 100,
  progressPct: def.progressPct,
  due: iso(def.dueInDays >= 0 ? addDays(now, def.dueInDays) : subDays(now, -def.dueInDays)),
  house: def.house,
  area: def.area,
  type: def.type,
  typeLabel: TYPE_LABELS[def.type],
  visibility: def.visibility,
  visibilityLabel: VISIBILITY_LABELS[def.visibility],
  description: def.description,
  docLinks: def.docLinks,
  docCount: def.docLinks.length,
})))
