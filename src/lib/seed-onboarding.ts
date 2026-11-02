// Onboarding seed (onboarding-mode wave) — new-hire trainee content.
// Two datasets, registered in src/lib/seed-extra.ts (the wave-2 seam): - onboardingVideos — 6 new-hire tutorials…
import { subDays, subHours } from 'date-fns'
import type { Doc, ResourceName, TintName, Video } from '@/engine/types'
import type { Role } from '@/auth/types'

const now = new Date()
const iso = (d: Date) => d.toISOString()

/* ---------------- onboarding videos (6 new-hire tutorials) ---------------- */

/** record extension fields ride along to the videos template (seed.ts pattern) */
export type OnboardingVideo = Video & {
  visibility?: 'all' | 'managers' | 'admins' | 'onboarding'
  instructorId?: string
  postedById?: string
  tags?: string[]
}

export const onboardingVideos: OnboardingVideo[] = [
  {
    id: 'ov-01',
    title: 'Tracking Times — Clock in/out with PSI Anywhere',
    channel: 'onboarding',
    thumb: '/assets/videos/thumb-01.jpg',
    durationSec: 180,
    views: 96,
    watched: 0,
    publishedAt: iso(subDays(now, 6)),
    description: 'Open PSI Anywhere, clock in at shift start, clock out at the end, and fix a missed punch the right way.',
    visibility: 'onboarding',
    instructorId: 'p-05',
    postedById: 'p-05',
    tags: ['onboarding', 'timekeeping'],
  },
  {
    id: 'ov-02',
    title: 'Documenting Services',
    channel: 'onboarding',
    thumb: '/assets/videos/thumb-02.jpg',
    durationSec: 180,
    views: 88,
    watched: 0,
    publishedAt: iso(subDays(now, 5)),
    description: 'What to write after every visit: objective notes, service codes, and the details billers look for.',
    visibility: 'onboarding',
    instructorId: 'p-03',
    postedById: 'p-03',
    tags: ['onboarding', 'documentation'],
  },
  {
    id: 'ov-03',
    title: 'Reporting Incidents',
    channel: 'onboarding',
    thumb: '/assets/videos/thumb-03.jpg',
    durationSec: 300,
    views: 74,
    watched: 0,
    publishedAt: iso(subDays(now, 4)),
    description: 'When an incident happens: keep everyone safe first, then file the report before your shift ends.',
    visibility: 'onboarding',
    instructorId: 'p-04',
    postedById: 'p-04',
    tags: ['onboarding', 'incidents'],
  },
  {
    id: 'ov-04',
    title: 'HIPAA & Client Privacy Basics',
    channel: 'security',
    thumb: '/assets/videos/thumb-04.jpg',
    durationSec: 240,
    views: 112,
    watched: 0,
    publishedAt: iso(subDays(now, 3)),
    description: 'What protected health information is, where it may live, and the everyday habits that keep it private.',
    visibility: 'onboarding',
    instructorId: 'p-36',
    postedById: 'p-36',
    tags: ['onboarding', 'hipaa', 'privacy'],
  },
  {
    id: 'ov-05',
    title: 'Your First Shift: What to Expect',
    channel: 'onboarding',
    thumb: '/assets/videos/thumb-05.jpg',
    durationSec: 240,
    views: 129,
    watched: 0,
    publishedAt: iso(subDays(now, 2)),
    description: 'Arriving at the house, meeting the team, reading the care plan, and who to call when you need help.',
    visibility: 'onboarding',
    instructorId: 'p-01',
    postedById: 'p-01',
    tags: ['onboarding', 'first-shift'],
  },
  {
    id: 'ov-06',
    title: 'Medication Safety: Look, Don’t Touch',
    channel: 'security',
    thumb: '/assets/videos/thumb-06.jpg',
    durationSec: 270,
    views: 65,
    watched: 0,
    publishedAt: iso(subHours(now, 20)),
    description: 'Until you are med-certified you may not administer medications — here is what you CAN do and how to escalate.',
    visibility: 'onboarding',
    instructorId: 'p-36',
    postedById: 'p-05',
    tags: ['onboarding', 'medications', 'safety'],
  },
]

/* ---------------- onboarding docs (5 company policies) ---------------- */

const policyBody = (intro: string, callout: string, calloutTint: TintName): Doc['body'] => [
  { kind: 'h2', id: 'overview', text: 'Overview' },
  { kind: 'p', text: `${intro} This policy applies to every new hire from day one — including trainees who have not started shifts yet. It is reviewed annually by the People team.` },
  { kind: 'callout', tint: calloutTint, text: callout },
  { kind: 'h2', id: 'what-we-expect', text: 'What we expect' },
  { kind: 'p', text: 'Read this end to end during onboarding, ask your coordinator about anything unclear, and acknowledge it in your new-hire packet. When the policy changes, we announce it and ask for a fresh acknowledgement.' },
  { kind: 'h3', id: 'questions', text: 'Questions' },
  { kind: 'p', text: 'Your care coordinator answers policy questions within two business days. Urgent safety questions never wait — call the on-call manager right away.' },
]

export const onboardingDocs: Doc[] = [
  {
    id: 'od-01',
    title: 'Welcome Packet',
    excerpt: 'Everything a new hire needs in week one: who we are, how houses run, and where to find help.',
    collection: 'policies',
    cover: '/assets/docs/cover-01.jpg',
    authorIds: ['p-05'],
    updatedAt: iso(subDays(now, 2)),
    readMinutes: 8,
    body: policyBody(
      'Welcome to ASA Lifecare. This packet orients you to our houses, our clients and the people you will work with every day.',
      'Keep this packet handy during your first month — most “how do I…” questions are answered here.',
      'mint',
    ),
  },
  {
    id: 'od-02',
    title: 'Code of Conduct',
    excerpt: 'How we treat clients, families and each other — the standards every ASA team member signs up for.',
    collection: 'policies',
    cover: '/assets/docs/cover-02.jpg',
    authorIds: ['p-03'],
    updatedAt: iso(subDays(now, 5)),
    readMinutes: 6,
    body: policyBody(
      'Our code of conduct sets the bar for respect, dignity and professionalism in every house and office.',
      'Violations of the code are taken seriously and can end employment. When in doubt, ask before acting.',
      'peach',
    ),
  },
  {
    id: 'od-03',
    title: 'HIPAA Overview',
    excerpt: 'Protected health information in plain language: what it is, where it lives, and how to protect it.',
    collection: 'policies',
    cover: '/assets/docs/cover-03.jpg',
    authorIds: ['p-36'],
    updatedAt: iso(subDays(now, 7)),
    readMinutes: 9,
    body: policyBody(
      'HIPAA protects every client’s health information. This overview covers what trainees must know before their first shift.',
      'Never discuss client information in public spaces, group chats or personal devices — no exceptions.',
      'lavender',
    ),
  },
  {
    id: 'od-04',
    title: 'Safety Basics',
    excerpt: 'House safety essentials: emergency exits, incident prevention, lifting, and when to call 911 vs. the on-call manager.',
    collection: 'policies',
    cover: '/assets/docs/cover-04.jpg',
    authorIds: ['p-04'],
    updatedAt: iso(subDays(now, 9)),
    readMinutes: 7,
    body: policyBody(
      'Safety comes before schedules, documentation and everything else. These basics keep clients and staff safe in every house.',
      'Life-threatening emergency? Call 911 first, then the on-call manager. Everything else: on-call manager first.',
      'amber',
    ),
  },
  {
    id: 'od-05',
    title: 'Dress Code',
    excerpt: 'What to wear on shift: practical, professional and safe — plus the few items that are never allowed.',
    collection: 'policies',
    cover: '/assets/docs/cover-01.jpg',
    authorIds: ['p-05'],
    updatedAt: iso(subDays(now, 12)),
    readMinutes: 4,
    body: policyBody(
      'Dress for active, hands-on work: closed-toe shoes, comfortable clothing, and your ASA badge visible at all times.',
      'No open-toed shoes, dangling jewelry or strong fragrances in the houses — they are safety and comfort hazards.',
      'blue',
    ),
  },
]

/* ---------------- role-scoped resource resolver ---------------- */

/** Base resource → onboarding-scoped replacement (trainee content swap). */
const ONBOARDING_RESOURCE_MAP: Record<string, ResourceName> = {
  videos: 'onboardingVideos',
  documents: 'onboardingDocs',
}

// The data-source switch used by PageRenderer: for role 'onboarding', the Academy and Knowledge pages read the…
export function scopedResourceForRole(resource: ResourceName, role: Role | null | undefined): ResourceName {
  if (role === 'onboarding') return ONBOARDING_RESOURCE_MAP[resource] ?? resource
  return resource
}
