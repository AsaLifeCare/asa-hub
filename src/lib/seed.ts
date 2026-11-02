// asa.
// — mock dataset (§12).
import { addDays, addHours, addMinutes, startOfWeek, subDays, subHours, subMinutes } from 'date-fns'
import type {
  ActivityItem,
  AppNotification,
  CalEvent,
  Doc,
  Person,
  Video,
} from '@/engine/types'
import { withTenant } from '@/lib/tenancy'
/** The drawn set the seed rotates through — see lib/animalAvatars. */
const SEED_ANIMALS = ['fox', 'cat', 'dog', 'bear', 'owl', 'rabbit', 'panda', 'frog',
                      'fox-wink', 'cat-tail', 'owl-blink', 'frog-hop']


const iso = (d: Date) => d.toISOString()
const now = new Date()

/* ---------------- people (48) ---------------- */

const FIRST = [
  'Maya', 'Tom', 'Priya', 'Daniel', 'Sofia', 'James', 'Aisha', 'Lucas',
  'Elena', 'Marcus', 'Hana', 'Oliver', 'Nina', 'Rafael', 'Grace', 'Ethan',
  'Ingrid', 'Samuel', 'Clara', 'David', 'Amara', 'Felix', 'Zoe', 'Nathan',
  'Lena', 'Oscar', 'Ruby', 'Victor', 'Isla', 'Kai', 'Marta', 'Jonas',
  'Tara', 'Leo', 'Bianca', 'Adam', 'Yuki', 'Peter', 'Camille', 'Omar',
  'Freya', 'Julian', 'Naomi', 'Henrik', 'Alicia', 'Theo', 'Rosa', 'Simon',
]
const LAST = [
  'Chen', 'Becker', 'Nair', 'Osei', 'Morales', 'Whitfield', 'Rahman', 'Silva',
  'Petrova', 'Bell', 'Tanaka', 'Nolan', 'Kovacs', 'Ortiz', 'Lindgren', 'Cole',
  'Haas', 'Adeyemi', 'Moreau', 'Kim', 'Nwosu', 'Braun', 'Hale', 'Brooks',
  'Fischer', 'Lindqvist', 'Park', 'Rossi', 'Weber', 'Ferrara', 'Holt',
  'Marsh', 'Dubois', 'Yamamoto', 'Iversen', 'Laurent', 'Haddad',
  'Solberg', 'Vega', 'Okafor', 'Berg', 'Santos', 'Reyes', 'Keller', 'Ford',
]
const DEPARTMENTS: Person['department'][] = ['Engineering', 'Design', 'Ops', 'G&A']
const ROLES: Record<Person['department'], string[]> = {
  Engineering: ['Frontend Engineer', 'Backend Engineer', 'Engineering Manager', 'DevOps Engineer', 'QA Engineer', 'Staff Engineer'],
  Design: ['Product Designer', 'Design Lead', 'UX Researcher', 'Brand Designer'],
  Ops: ['Operations Manager', 'People Partner', 'Office Coordinator', 'Finance Analyst', 'Recruiter'],
  'G&A': ['Account Executive', 'Legal Counsel', 'IT Administrator', 'Chief of Staff'],
}
const LOCATIONS = ['London', 'Berlin', 'New York', 'Toronto', 'Lisbon', 'Austin', 'Amsterdam', 'Remote']
const STATUSES: Person['status'][] = ['active', 'active', 'active', 'active', 'away', 'off']
const SKILLS = [
  ['React', 'TypeScript', 'Design systems'],
  ['Node.js', 'Postgres', 'APIs'],
  ['Figma', 'Prototyping', 'Research'],
  ['Hiring', 'Onboarding', 'People ops'],
  ['Roadmapping', 'Analytics', 'SQL'],
  ['Go', 'Kubernetes', 'Infra'],
]
/** Staff tags (care-data wave) — 2-3 realistic tags per person. */
const TAGS = [
  ['Med pass', 'House lead'],
  ['Night shift', 'Driver'],
  ['New hire', 'Med pass'],
  ['Bilingual', 'House lead', 'Driver'],
  ['Med pass', 'Night shift'],
  ['Driver', 'New hire'],
  ['House lead', 'Bilingual'],
  ['Med pass', 'Driver', 'Night shift'],
]

export const people: Person[]  = withTenant(FIRST.map((first, i) => {
  const last = LAST[i % LAST.length]
  const department = DEPARTMENTS[i % 4]
  const rolePool = ROLES[department]
  return {
    id: `p-${String(i + 1).padStart(2, '0')}`,
    name: `${first} ${last}`,
    role: rolePool[i % rolePool.length],
    department,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@asahub.io`,
    location: LOCATIONS[i % LOCATIONS.length],
    // NO STRANGERS' FACES — the images of people who are unknown and are not part of the system are removed.
    avatar: `animal:${SEED_ANIMALS[i % SEED_ANIMALS.length]}`,
    status: STATUSES[i % STATUSES.length],
    startDate: iso(subDays(now, 30 + ((i * 47) % 1400))),
    skills: SKILLS[i % SKILLS.length],
    tags: TAGS[i % TAGS.length],
  } as Person & { tags: string[] }
}))

// ---------------- candidates (18, home-healthcare funnel) ---------------- Real recruiting funnel: New → Phone…

export type ChecklistStatus = 'done' | 'pending' | 'missing' | 'auto'
export type ChecklistOwner = 'Candidate' | 'Recruiter' | 'HR' | 'Auto'
export type ChecklistItem = {
  id: string
  label: string
  status: ChecklistStatus
  owner?: ChecklistOwner
  stage: string
  /** true = a real document upload; absent = analysis checkpoint (dot only). */
  upload?: boolean
}
export type HiringCandidate = {
  id: string
  name: string
  role: string
  avatar: string
  stage: string
  source: string
  daysInStage: number
  score: number // 0..5
  appliedAt: string // ISO
  email: string
  checklist: ChecklistItem[]
  /* Fields also emitted by the live talent adapter (optional in mock) */
  phone?: string
  owner?: string
  ownerAvatar?: string
  resumeLink?: string
  resumeFileLabel?: string
  summary?: string
  summaryTimeline?: Array<{ time: string; text: string; tint: string }>
}

const C_STAGE_ORDER = ['new', 'phone-screen', 'interview', 'onboarding', 'hired'] as const

/** Items appended to the checklist when a candidate ENTERS the stage. */
const CHECK_PLAN: Record<string, Array<{ id: string; label: string; owner?: ChecklistOwner; upload?: boolean }>> = {
  new: [
    { id: 'resume', label: 'Resume', owner: 'Candidate', upload: true },
    { id: 'cjis', label: 'CJIS / Background result', owner: 'HR', upload: true },
    { id: 'resume-decision', label: 'Resume decision', owner: 'Recruiter' },
  ],
  'phone-screen': [
    { id: 'transcript', label: 'Transcript', owner: 'Auto' },
    { id: 'ai-report', label: 'AI report', owner: 'Auto' },
    { id: 'screen-details', label: 'Screen details', owner: 'Recruiter' },
    { id: 'advance-decision', label: 'Advance decision', owner: 'Recruiter' },
  ],
  interview: [
    { id: 'scorecard', label: 'Interview scorecard', owner: 'Recruiter' },
    { id: 'references', label: 'References checked', owner: 'HR' },
  ],
  // New-hire packet — the 7 required uploads.
  onboarding: [
    { id: 'dropbox-link', label: 'Dropbox link', owner: 'Candidate', upload: true },
    { id: 'dodd-cert', label: '8-Hr DODD Training Certificate', owner: 'Candidate', upload: true },
    { id: 'cpr-cert', label: 'CPR / First Aid Certificate', owner: 'Candidate', upload: true },
    { id: 'med-cert', label: 'Med Delivery Certificate', owner: 'Candidate', upload: true },
    { id: 'drivers-license', label: "Driver's License / ID", owner: 'Candidate', upload: true },
    { id: 'diploma', label: 'HS Diploma / GED', owner: 'Candidate', upload: true },
    { id: 'ss-card', label: 'SS Card / Birth Certificate', owner: 'Candidate', upload: true },
  ],
  hired: [],
}

// Builds a candidate's cumulative checklist: items from every stage up to and including the current one.
function buildChecklist(stageId: string, tweaks: Record<string, ChecklistStatus> = {}): ChecklistItem[] {
  const depth = C_STAGE_ORDER.indexOf(stageId as (typeof C_STAGE_ORDER)[number])
  const items: ChecklistItem[] = []
  C_STAGE_ORDER.slice(0, depth + 1).forEach((sid) => {
    const current = sid === stageId
    for (const p of CHECK_PLAN[sid] ?? []) {
      const status: ChecklistStatus = p.owner === 'Auto' ? 'auto' : current ? 'pending' : 'done'
      items.push({ ...p, stage: sid, status })
    }
  })
  return items.map((it) => (tweaks[it.id] ? { ...it, status: tweaks[it.id] } : it))
}

const ONBOARD_ALL_DONE: Record<string, ChecklistStatus> = {
  'dropbox-link': 'done',
  'dodd-cert': 'done',
  'cpr-cert': 'done',
  'med-cert': 'done',
  'drivers-license': 'done',
  diploma: 'done',
  'ss-card': 'done',
}

// Icon avatars (no people photos) — deterministic neutral icon per candidate.
const AVATAR_ICONS = [
  'user', 'user-check', 'contact', 'smile', 'heart-pulse', 'stethoscope',
  'clipboard-list', 'star', 'sparkles', 'shield', 'briefcase', 'heart',
]

const mk = (
  i: number,
  first: string,
  last: string,
  role: string,
  stage: (typeof C_STAGE_ORDER)[number],
  source: string,
  daysInStage: number,
  score: number,
  tweaks: Record<string, ChecklistStatus> = {},
): HiringCandidate => ({
  id: `c-${String(i).padStart(2, '0')}`,
  name: `${first} ${last}`,
  role,
  avatar: `icon:${AVATAR_ICONS[(i * 5 + 2) % AVATAR_ICONS.length]}`,
  stage,
  source,
  daysInStage,
  score,
  appliedAt: iso(subDays(now, daysInStage + 4 + ((i * 7) % 20))),
  email: `${first.toLowerCase()}.${last.toLowerCase()}@mail.example`,
  phone: `+1 330 555 0${String(100 + i)}`,
  summaryTimeline: [
    { time: iso(subDays(now, daysInStage + 4 + ((i * 7) % 20))).slice(0, 10), text: `Applied via ${source}`, tint: 'blue' },
  ],
  checklist: buildChecklist(stage, tweaks),
})

export const candidates: HiringCandidate[]  = withTenant([
  /* New — resume on file / missing, CJIS + decision still open */
  mk(1, 'Jordan', 'Avery', 'Direct Support Professional', 'new', 'Indeed', 2, 3, { resume: 'done', cjis: 'pending' }),
  mk(2, 'Casey', 'Whitfield', 'Direct Support Professional', 'new', 'Careers page', 5, 4, { resume: 'missing', cjis: 'missing' }),
  mk(3, 'Riley', 'Okafor', 'Nurse', 'new', 'Referral', 1, 5, { resume: 'done', cjis: 'pending' }),
  mk(4, 'Morgan', 'Delgado', 'Coordinator', 'new', 'Job fair', 9, 3, { resume: 'done', cjis: 'missing' }),
  mk(5, 'Taylor', 'Nguyen', 'Direct Support Professional', 'new', 'Indeed', 4, 2, { resume: 'missing', cjis: 'pending' }),

  /* Phone Screen — transcript + AI report auto-generated, decision pending */
  mk(6, 'Alex', 'Marsh', 'Direct Support Professional', 'phone-screen', 'Indeed', 3, 4, { 'screen-details': 'done' }),
  mk(7, 'Sam', 'Whitaker', 'House Manager', 'phone-screen', 'Careers page', 6, 3, { 'screen-details': 'done' }),
  mk(8, 'Jamie', 'Osei', 'Nurse', 'phone-screen', 'Agency', 12, 4, { 'screen-details': 'pending' }),
  mk(9, 'Quinn', 'Tanaka', 'Direct Support Professional', 'phone-screen', 'Referral', 2, 5, { 'screen-details': 'done' }),

  /* Interview — scorecard + references in flight */
  mk(10, 'Drew', 'Callahan', 'House Manager', 'interview', 'Referral', 4, 4, { scorecard: 'done' }),
  mk(11, 'Blake', 'Ferreira', 'Direct Support Professional', 'interview', 'Indeed', 8, 3, {}),
  mk(12, 'Rowan', 'Adeyemi', 'Nurse', 'interview', 'Careers page', 15, 5, { scorecard: 'done', references: 'pending' }),
  mk(13, 'Skyler', 'Rossi', 'Coordinator', 'interview', 'Job fair', 5, 4, { scorecard: 'pending', references: 'done' }),

  /* Onboarding — new-hire packet, partial uploads */
  mk(14, 'Charlie', 'Vega', 'Direct Support Professional', 'onboarding', 'Referral', 6, 4, {
    'dropbox-link': 'done', 'dodd-cert': 'done', 'cpr-cert': 'done',
    'med-cert': 'missing', 'drivers-license': 'missing', diploma: 'missing', 'ss-card': 'missing',
  }),
  mk(15, 'Emerson', 'Holt', 'Nurse', 'onboarding', 'Agency', 11, 5, {
    'dropbox-link': 'done', 'dodd-cert': 'done', 'cpr-cert': 'done', 'med-cert': 'done', 'drivers-license': 'done',
    diploma: 'pending', 'ss-card': 'missing',
  }),
  mk(16, 'Finley', 'Brooks', 'House Manager', 'onboarding', 'Indeed', 3, 4, {
    'dropbox-link': 'done', 'drivers-license': 'done',
    'dodd-cert': 'missing', 'cpr-cert': 'missing', 'med-cert': 'missing', diploma: 'missing', 'ss-card': 'missing',
  }),

  /* Hired — packet complete */
  mk(17, 'Harper', 'Lindqvist', 'Direct Support Professional', 'hired', 'Careers page', 1, 5, ONBOARD_ALL_DONE),
  mk(18, 'Ellis', 'Moreau', 'Coordinator', 'hired', 'Referral', 4, 4, ONBOARD_ALL_DONE),
])


/* ---------------- documents (9, 2 converted to courses) ---------------- */

/** course module metadata — merged onto selected docs as extra fields (Doc type untouched) */
export type CourseModule = { id: string; title: string; minutes: number }

const COURSE_META: Record<string, { title?: string; modules: CourseModule[] }> = {
  'd-05': {
    title: 'New Hire Orientation',
    modules: [
      { id: 'welcome-mission', title: 'Welcome & company mission', minutes: 15 },
      { id: 'workspace-tools', title: 'Your workspace & tools', minutes: 25 },
      { id: 'care-standards', title: 'Care standards & client visits', minutes: 30 },
      { id: 'first-week', title: 'Your first week, hour by hour', minutes: 20 },
      { id: 'buddies-checkins', title: 'Buddies, managers & check-ins', minutes: 10 },
    ],
  },
  'd-02': {
    modules: [
      { id: 'scorecards', title: 'Scorecards & role definition', minutes: 20 },
      { id: 'sourcing', title: 'Sourcing & screening', minutes: 15 },
      { id: 'interview-loop', title: 'Running the interview loop', minutes: 35 },
      { id: 'debriefs', title: 'Debriefs & decisions', minutes: 20 },
      { id: 'offers', title: 'Offers & closing', minutes: 15 },
    ],
  },
}

const docBody = (topic: string): Doc['body'] => [
  { kind: 'h2', id: 'overview', text: 'Overview' },
  { kind: 'p', text: `${topic} This document is the single source of truth for the topic. It is reviewed quarterly by the owning team and kept short on purpose — link out rather than duplicate.` },
  { kind: 'callout', tint: 'mint', text: 'If anything here conflicts with a signed agreement, the agreement wins. Flag discrepancies in #docs-feedback.' },
  { kind: 'h2', id: 'principles', text: 'Principles' },
  { kind: 'p', text: 'We optimise for clarity over completeness. Every rule should be explainable in one sentence, and every exception should have an owner and an expiry date.' },
  { kind: 'h3', id: 'ownership', text: 'Ownership' },
  { kind: 'p', text: 'Each section names an owner. Owners answer questions within two business days and run the review cycle. Unowned sections are deleted, not archived.' },
  { kind: 'h2', id: 'process', text: 'Process' },
  { kind: 'p', text: 'Propose changes as suggestions, not edits. The owning team resolves open threads weekly, publishes a changelog entry, and announces material changes in the all-hands notes.' },
  { kind: 'code', text: 'review-cadence: quarterly\nowner: listed per section\nescalation: #docs-feedback' },
]

const BASE_DOCUMENTS: Doc[] = [
  { id: 'd-01', title: 'Remote Work Policy', excerpt: 'Where we work, core hours, and how we keep distributed teams in sync.', collection: 'policies', cover: '/assets/docs/cover-01.jpg', authorIds: ['p-01', 'p-20'], updatedAt: iso(subHours(now, 2)), readMinutes: 6, body: docBody('Our remote-first operating model.') },
  { id: 'd-02', title: 'Hiring Playbook', excerpt: 'End-to-end guide: scorecards, interview loops, debriefs, and offers.', collection: 'playbooks', cover: '/assets/docs/cover-02.jpg', authorIds: ['p-03'], updatedAt: iso(subHours(now, 26)), readMinutes: 12, body: docBody('How we run a fair, fast hiring loop.') },
  { id: 'd-03', title: 'Design System Principles', excerpt: 'Tokens, radius, motion, and the rules that keep the product calm.', collection: 'design', cover: '/assets/docs/cover-03.jpg', authorIds: ['p-02', 'p-06'], updatedAt: iso(subDays(now, 2)), readMinutes: 8, body: docBody('The design language behind asa.') },
  { id: 'd-04', title: 'Incident Response Runbook', excerpt: 'Severity levels, paging rotations, and comms templates for bad days.', collection: 'engineering', cover: '/assets/docs/cover-04.jpg', authorIds: ['p-04'], updatedAt: iso(subDays(now, 3)), readMinutes: 10, body: docBody('What to do when things break.') },
  { id: 'd-05', title: 'Onboarding: First 30 Days', excerpt: 'A week-by-week plan for new joiners and their managers.', collection: 'playbooks', cover: '/assets/docs/cover-01.jpg', authorIds: ['p-05'], updatedAt: iso(subDays(now, 4)), readMinutes: 7, body: docBody('Making the first month count.') },
  { id: 'd-06', title: 'Expense & Travel Policy', excerpt: 'What you can expense, per-diems, and approval thresholds.', collection: 'policies', cover: '/assets/docs/cover-02.jpg', authorIds: ['p-28'], updatedAt: iso(subDays(now, 6)), readMinutes: 5, body: docBody('Spend company money like it is your own.') },
  { id: 'd-07', title: 'API Style Guide', excerpt: 'Naming, versioning, errors, and pagination across our services.', collection: 'engineering', cover: '/assets/docs/cover-03.jpg', authorIds: ['p-08', 'p-12'], updatedAt: iso(subDays(now, 8)), readMinutes: 9, body: docBody('Boring, predictable, versioned APIs.') },
  { id: 'd-08', title: 'Brand Voice & Tone', excerpt: 'How ASA sounds: calm, direct, helpful. With before/after examples.', collection: 'design', cover: '/assets/docs/cover-04.jpg', authorIds: ['p-10'], updatedAt: iso(subDays(now, 11)), readMinutes: 4, body: docBody('Writing that sounds like us.') },
  { id: 'd-09', title: 'Security Awareness Handbook', excerpt: 'Phishing, device hygiene, access reviews, and travel security.', collection: 'policies', cover: '/assets/docs/cover-01.jpg', authorIds: ['p-36'], updatedAt: iso(subDays(now, 14)), readMinutes: 11, body: docBody('Security is everyone\u2019s job.') },
]

/** merge course/draft metadata onto base docs (extra fields ride along at runtime) */
export const documents: Doc[]  = withTenant(BASE_DOCUMENTS.map((d) => {
  const meta = COURSE_META[d.id]
  const isDraft = d.id === 'd-08'
  if (!meta && !isDraft) return d
  const out: Doc & { kind?: 'course'; modules?: CourseModule[]; status?: 'draft' } = {
    ...d,
    ...(meta?.title ? { title: meta.title } : {}),
    ...(meta ? { kind: 'course' as const, modules: meta.modules } : {}),
    ...(isDraft ? { status: 'draft' as const } : {}),
  }
  return out
}))

/* ---------------- videos (12) ---------------- */

/** uploader metadata — merged onto videos as extra fields (Video type untouched) */
type VideoSeedMeta = {
  instructorId?: string
  postedById?: string
  visibility?: 'all' | 'managers' | 'admins'
  tags?: string[]
}

const VIDEO_META: Record<string, VideoSeedMeta> = {
  'v-01': { instructorId: 'p-05', postedById: 'p-05', tags: ['onboarding', 'basics'] },
  'v-02': { instructorId: 'p-05', postedById: 'p-01', tags: ['onboarding'] },
  'v-03': { instructorId: 'p-04', postedById: 'p-04', tags: ['product', 'dashboards'] },
  'v-04': { instructorId: 'p-03', postedById: 'p-03', visibility: 'managers', tags: ['hiring', 'interviews'] },
  'v-05': { instructorId: 'p-36', postedById: 'p-36', tags: ['security'] },
  'v-06': { instructorId: 'p-01', postedById: 'p-02', tags: ['design', 'tokens'] },
  'v-07': { instructorId: 'p-03', postedById: 'p-03', tags: ['hiring'] },
  'v-08': { instructorId: 'p-04', postedById: 'p-04', visibility: 'managers', tags: ['product', 'facilitation'] },
  'v-09': { instructorId: 'p-36', postedById: 'p-05', tags: ['security', 'privacy'] },
  'v-10': { instructorId: 'p-08', postedById: 'p-08', visibility: 'admins', tags: ['engineering', 'schema'] },
  'v-11': { instructorId: 'p-02', postedById: 'p-02', tags: ['design', 'feedback'] },
  'v-12': { instructorId: 'p-05', postedById: 'p-05', tags: ['onboarding', 'people'] },
}

const BASE_VIDEOS: Video[] = [
  { id: 'v-01', title: 'Welcome to asa.: Your First Week', channel: 'onboarding', thumb: '/assets/videos/thumb-01.jpg', durationSec: 482, views: 1240, watched: 1, publishedAt: iso(subDays(now, 30)), description: 'A friendly tour of the workspace, the app launcher, and where to find help.' },
  { id: 'v-02', title: 'Setting Up Your Profile & Notifications', channel: 'onboarding', thumb: '/assets/videos/thumb-01.jpg', durationSec: 305, views: 860, watched: 0.6, publishedAt: iso(subDays(now, 28)), description: 'Tune the bell, the badge, and dark-at-night mode in five minutes.' },
  { id: 'v-03', title: 'Reading the Workspace Activity Dashboard', channel: 'product', thumb: '/assets/videos/thumb-02.jpg', durationSec: 654, views: 540, watched: 0.25, publishedAt: iso(subDays(now, 21)), description: 'KPIs, trends, and how the weekly goal ring is computed.' },
  { id: 'v-04', title: 'Running a Great Interview Loop', channel: 'hiring', thumb: '/assets/videos/thumb-03.jpg', durationSec: 743, views: 410, watched: 0, publishedAt: iso(subDays(now, 18)), description: 'Scorecards, structured debriefs, and avoiding groupthink.' },
  { id: 'v-05', title: 'Security Essentials: Phishing & Access', channel: 'security', thumb: '/assets/videos/thumb-04.jpg', durationSec: 588, views: 1930, watched: 1, publishedAt: iso(subDays(now, 45)), description: 'The ten-minute habits that stop most incidents.' },
  { id: 'v-06', title: 'Design Tokens & Theming Deep Dive', channel: 'design', thumb: '/assets/videos/thumb-05.jpg', durationSec: 912, views: 320, watched: 0.45, publishedAt: iso(subDays(now, 14)), description: 'How one token set powers light, dark, and every pastel tint.' },
  { id: 'v-07', title: 'Shipping with the Pipeline Board', channel: 'hiring', thumb: '/assets/videos/thumb-03.jpg', durationSec: 421, views: 260, watched: 0, publishedAt: iso(subDays(now, 10)), description: 'Drag, drop, and keep the funnel honest.' },
  { id: 'v-08', title: 'Quarterly Retro Facilitation Guide', channel: 'product', thumb: '/assets/videos/thumb-06.jpg', durationSec: 690, views: 185, watched: 0, publishedAt: iso(subDays(now, 8)), description: 'A format that surfaces real signal in 45 minutes.' },
  { id: 'v-09', title: 'Data Privacy Basics for Everyone', channel: 'security', thumb: '/assets/videos/thumb-04.jpg', durationSec: 533, views: 720, watched: 0.1, publishedAt: iso(subDays(now, 7)), description: 'What personal data is, and the two rules that matter.' },
  { id: 'v-10', title: 'Building a Page from a Schema', channel: 'product', thumb: '/assets/videos/thumb-02.jpg', durationSec: 805, views: 290, watched: 0, publishedAt: iso(subDays(now, 5)), description: 'The page-type engine explained: config in, UI out.' },
  { id: 'v-11', title: 'Crit Sessions that Actually Help', channel: 'design', thumb: '/assets/videos/thumb-05.jpg', durationSec: 462, views: 150, watched: 0, publishedAt: iso(subDays(now, 3)), description: 'Feedback norms for calmer, sharper design reviews.' },
  { id: 'v-12', title: 'Meet the Team: Ops & People', channel: 'onboarding', thumb: '/assets/videos/thumb-06.jpg', durationSec: 374, views: 610, watched: 0, publishedAt: iso(subDays(now, 1)), description: 'Faces, names, and who to ask for what.' },
]

export const videos: Video[]  = withTenant(BASE_VIDEOS.map((v) => ({ ...v, ...(VIDEO_META[v.id] ?? {}) })))

/* ---------------- events (home-care shifts & appointments, ±2 weeks) ---------------- */

const weekStart = startOfWeek(now, { weekStartsOn: 1 })
const ev = (
  id: string, title: string, personIdx: number, dayOffset: number,
  start: string, durationMin: number, type: string, attendees: number[], notes?: string,
): CalEvent => ({
  id, title,
  personId: people[personIdx].id,
  date: iso(addDays(weekStart, dayOffset)).slice(0, 10),
  start, durationMin, type,
  attendees: attendees.map((i) => people[i].id),
  notes,
})

const HOUSES = ['Meadowlane', 'Orchard Dale', '49th St'] as const

let evSeq = 0
const nid = () => `e-${String(++evSeq).padStart(2, '0')}`

/* shift roster: morning 7–3 daily, evening 3–11 every 3rd day, overnight 11–7 every 5th day */
const shiftRoster: CalEvent[] = []
for (let d = -14; d <= 13; d++) {
  const n = d + 14 // 0..27
  const mh = HOUSES[n % 3]
  shiftRoster.push(ev(nid(), `Morning shift · ${mh}`, n % 5, d, '07:00', 480, 'shift', [], `House: ${mh}. Morning routine, breakfast and med pass (7:00 AM – 3:00 PM).`))
  if (n % 3 === 0) {
    const eh = HOUSES[(n + 1) % 3]
    shiftRoster.push(ev(nid(), `Evening shift · ${eh}`, (n * 2 + 1) % 5, d, '15:00', 480, 'shift', [], `House: ${eh}. Dinner, evening routine and handoff notes (3:00 – 11:00 PM).`))
  }
  if (n % 5 === 2) {
    const oh = HOUSES[(n + 2) % 3]
    shiftRoster.push(ev(nid(), `Overnight shift · ${oh}`, (n + 3) % 5, d, '23:00', 60, 'shift', [], `House: ${oh}. Overnight coverage 11:00 PM – 7:00 AM (shown at shift start).`))
  }
}

/* appointments, trainings, 1:1s and weekly team meetings (team meeting = Monday) */
const careEvents: CalEvent[] = [
  ev(nid(), 'Team meeting', 0, -14, '09:00', 45, 'meeting', [1, 2, 3, 4], 'Weekly all-staff huddle: coverage swaps, incidents and celebrations.'),
  ev(nid(), 'Team meeting', 0, -7, '09:00', 45, 'meeting', [1, 2, 3, 4], 'Weekly all-staff huddle: coverage swaps, incidents and celebrations.'),
  ev(nid(), 'Team meeting', 0, 0, '09:00', 45, 'meeting', [1, 2, 3, 4], 'Weekly all-staff huddle: coverage swaps, incidents and celebrations.'),
  ev(nid(), 'Team meeting', 0, 7, '09:00', 45, 'meeting', [1, 2, 3, 4], 'Weekly all-staff huddle: coverage swaps, incidents and celebrations.'),
  ev(nid(), 'CPI refresher', 1, -10, '14:00', 90, 'training', [2, 4], 'Crisis prevention recertification, community room at Meadowlane.'),
  ev(nid(), 'Medication admin recert', 3, -3, '13:00', 60, 'training', [0, 2], 'Med-admin recertification with the county RN.'),
  ev(nid(), 'Positive behavior supports', 4, 5, '15:00', 90, 'training', [0, 1], 'PBS workshop for the Meadowlane team.'),
  ev(nid(), '1:1 supervision — Tom', 1, -12, '16:00', 30, 'one-on-one', [0], 'Monthly supervision with Maya.'),
  ev(nid(), '1:1 supervision — Priya', 2, -5, '16:30', 30, 'one-on-one', [0], 'Monthly supervision with Maya.'),
  ev(nid(), '1:1 supervision — Daniel', 3, 2, '16:00', 30, 'one-on-one', [4], 'Monthly supervision with Sofia.'),
  ev(nid(), '1:1 supervision — Sofia', 4, 9, '16:30', 30, 'one-on-one', [0], 'Monthly supervision with Maya.'),
  ev(nid(), 'Doctor visit · Dr. Patel', 2, -11, '10:00', 90, 'appointment', [0], 'Cardiology follow-up for a Meadowlane resident — bring the med list.'),
  ev(nid(), 'Doctor visit · Dr. Nguyen', 4, -2, '11:00', 60, 'appointment', [], 'Annual physical for an Orchard Dale resident.'),
  ev(nid(), 'Doctor visit · Dr. Patel', 1, 8, '09:30', 90, 'appointment', [2], 'Post-op check for a 49th St resident — wheelchair van booked.'),
  ev(nid(), 'Therapy · Speech', 0, -13, '13:00', 60, 'appointment', [], 'Speech therapy session — Meadowlane.'),
  ev(nid(), 'Therapy · Occupational', 3, -6, '14:00', 60, 'appointment', [], 'Occupational therapy — Orchard Dale.'),
  ev(nid(), 'Therapy · Physical', 2, 10, '13:30', 60, 'appointment', [], 'Physical therapy — 49th St.'),
  ev(nid(), 'Day program drop-off', 1, -9, '09:30', 45, 'appointment', [], 'Drop-off and check-in at the community day program (49th St).'),
  ev(nid(), 'Day program drop-off', 4, -4, '09:30', 45, 'appointment', [], 'Drop-off and check-in at the community day program (Meadowlane).'),
  ev(nid(), 'Day program drop-off', 0, 4, '09:30', 45, 'appointment', [], 'Drop-off and check-in at the community day program (Orchard Dale).'),
]

export const events: CalEvent[]  = withTenant([...shiftRoster, ...careEvents])

/* ---------------- notifications (14) ---------------- */

const n = (
  id: string, type: AppNotification['type'], title: string, body: string,
  at: Date, read: boolean, extra?: Partial<AppNotification>,
): AppNotification => ({ id, type, title, body, createdAt: iso(at), read, priority: 'normal', ...extra })

export const notifications: AppNotification[]  = withTenant([
  n('n-01', 'mention', 'Maya Chen mentioned you', '"@Alex can you check the offer numbers before the debrief?" — Hiring Playbook', subMinutes(now, 12), false, { appId: 'docs', actorId: 'p-01', href: '/app/docs/library', priority: 'high' }),
  n('n-02', 'app', 'Tom Becker moved to Offer', 'Priya Nair advanced a candidate in the Hiring Pipeline.', subMinutes(now, 38), false, { appId: 'hiring', actorId: 'p-03', href: '/app/hiring/pipeline', priority: 'high' }),
  n('n-03', 'reminder', 'Design review in 30 minutes', 'Today 09:30 · with Daniel, Elena and Hana.', subHours(now, 1), false, { appId: 'schedule', href: '/app/schedule/week' }),
  n('n-04', 'system', 'Academy was added to your workspace', 'Version 1.0 — 12 courses across 4 channels are ready.', subHours(now, 2), false, { appId: 'academy', href: '/app/academy/videos' }),
  n('n-05', 'app', '5 people added to People', 'Bulk import finished — 48 profiles are now in the directory.', subHours(now, 4), true, { appId: 'people', href: '/app/people/directory' }),
  n('n-06', 'mention', 'Priya Nair replied to your comment', '"Agreed — let\u2019s move the crit to Thursday." — Design System Principles', subHours(now, 6), true, { appId: 'docs', actorId: 'p-03', href: '/app/docs/library' }),
  n('n-07', 'app', 'New video: Security Essentials', 'The most-watched course this month just got a refresh.', subHours(now, 9), true, { appId: 'academy', href: '/app/academy/videos' }),
  n('n-08', 'reminder', 'Weekly goal: 18 of 25 interviews', '7 more interviews to hit this week\u2019s hiring goal.', subHours(now, 22), true, { appId: 'hiring', href: '/app/hiring/pipeline' }),
  n('n-09', 'system', 'Scheduled maintenance this weekend', 'The platform will be read-only Saturday 02:00–03:00 UTC.', subDays(now, 1), true, {}),
  n('n-10', 'app', 'Expense report approved', 'Your October report (€312.40) was approved by Ops.', subDays(now, 1), true, { appId: 'expenses' }),
  n('n-11', 'mention', 'James Whitfield mentioned you', '"@Alex the runbook draft is ready for a pass." — Incident Response', subDays(now, 2), true, { appId: 'docs', actorId: 'p-06', href: '/app/docs/library' }),
  n('n-12', 'app', 'Sofia Morales applied to Product Designer', 'New candidate in Applied — sourced via Referral.', subDays(now, 2), true, { appId: 'hiring', href: '/app/hiring/pipeline' }),
  n('n-13', 'system', 'Dark-at-night mode is on', 'Theme switches automatically between 19:00 and 07:00. Change in Settings.', subDays(now, 3), true, { href: '/settings' }),
  n('n-14', 'reminder', 'Quarterly access review due Friday', '12 accounts need a manager sign-off.', subDays(now, 3), true, { appId: 'people', href: '/app/people/directory' }),
])

/* ---------------- activity feed ---------------- */

export const activity: ActivityItem[]  = withTenant([
  { id: 'a-01', actorId: 'p-03', actorName: 'Priya Nair', action: 'moved Tom Becker to Offer', createdAt: iso(subMinutes(now, 12)), tint: 'mint' },
  { id: 'a-02', actorName: 'System', action: 'Academy v1.0 was installed', createdAt: iso(subHours(now, 1)), tint: 'lavender' },
  { id: 'a-03', actorId: 'p-01', actorName: 'Maya Chen', action: 'published "Remote Work Policy"', createdAt: iso(subHours(now, 3)), tint: 'peach' },
  { id: 'a-04', actorId: 'p-04', actorName: 'Daniel Osei', action: 'scheduled 6 interviews for this week', createdAt: iso(subHours(now, 5)), tint: 'blue' },
  { id: 'a-05', actorId: 'p-20', actorName: 'Amara Nwosu', action: 'added 5 people to the directory', createdAt: iso(subHours(now, 8)), tint: 'pink' },
  { id: 'a-06', actorId: 'p-02', actorName: 'Tom Becker', action: 'commented on "Design System Principles"', createdAt: iso(addHours(addMinutes(now, 0), -11)), tint: 'amber' },
])
