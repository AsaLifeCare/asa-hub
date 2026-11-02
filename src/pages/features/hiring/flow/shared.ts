// FLOW — the shared vocabulary and helpers of the Flow views (extracted verbatim from FlowPage.tsx, so each section…
// Same ids, labels and tints as the Pipeline board; nothing here decides.
import { ohioToday } from '@/lib/ohio'
import type { TintName } from '@/engine/types'
// The packet chip and the portal chip already own these two shapes and their meanings; the Journey reads the same…
import type { PacketChipValue } from '@/engine/templates/pipeline/PacketChip'
import type { OnboardingWindow } from '@/engine/templates/pipeline/OnboardingWindowChip'

// ------------------------------------------------------------------ shapes — what the candidates slice puts on a…

export type ChecklistItem = {
  id: string
  label: string
  status: 'done' | 'auto' | 'pending' | 'missing'
  owner?: string
  stage?: string
  upload?: boolean
}

export type FlowRow = {
  id: string
  name: string
  stage: string
  phone?: string
  email?: string
  daysInStage?: number
  // THE DAY THEY ARRIVED AT THE STAGE THEY ARE IN, and how long ago that was `daysInStage` above counts from the…
  stageSince?: string
  daysAtStage?: number | null
  // What the parking machine has already SAID about somebody standing at Ready to start — the ask book's count, not…
  parked?: { notices: number; of: number; lastAt: string } | null
  // THE DAY THE ROW WAS CREATED — the record has carried it since it was written (talentRecord_, `appliedAt…
  appliedAt?: string
  score?: number | null
  owner?: string
  source?: string
  city?: string
  state?: string
  resumeLink?: string
  /** The rubric's composite nota — null until a resume was scored. */
  resumeScorecard?: number | null
  summary?: string
  urgency?: 'none' | 'amber' | 'red'
  urgencyWhy?: string
  optedOut?: string
  lastReply?: { at: string; body: string; unread: number } | null
  checklist?: ChecklistItem[]
  // THE FOUR DATES THAT EXISTED AND COULD NOT BE READ (survey).
  screenDate?: string
  screenResult?: string
  screenStatus?: string
  // The day the New Hire Packet was signed, or empty.
  packetSignedAt?: string
  // THE APPLICATION FORM (Recruitment absorbed).
  application?: { srid: string; title: string; status: string; appliedAt: string; signedAt: string } | null
  // The New Hire chip's five states — PacketChip owns what each honestly means, down to why `unknown` is ours to…
  packet?: PacketChipValue | null
  // The onboarding portal's door.
  onboardingWindow?: OnboardingWindow | null
}

// Somebody who LEFT the process, as talentNoNumberList hands them over.
export type ArchivedRow = {
  id: string
  name: string
  stage?: string
  applied_at?: string
  archived?: boolean
  archived_at?: string
  archived_reason?: string
}

export type FlowEvent = {
  id: string
  candidate_id: string
  name: string
  type: string
  type_label: string
  date: string
  time: string
  location: string
  with_name: string
  notes: string
  status: string
  source: 'calendar' | 'interview'
}

// One line of what ACTUALLY happened — hiring_journey, through hiringJourneyList.
export type JourneyLine = {
  id: string
  candidate_id: string
  name: string
  step: string
  title: string
  channel: string
  to: string
  ok: boolean
  detail: string
  rehearsal: boolean
  at: string
  by: string
}

// SOMEBODY WAITING IN THE TALENT PIPELINE, and what the queue held back.
export type CrossingPerson = {
  tp_candidate_id: string
  name: string
  phone?: string
  email?: string
  /** What the legacy had them at — Ready, Hired, Phone Screen. */
  legacy_status?: string
  /** The background check IN ITS OWN WORDS, never reduced to a boolean. */
  cjis?: string
  cjis_report?: string
  nota?: string
  decision?: string
  resume_link?: string
  // WHERE THIS PRESS PUTS THEM — 'new' for a real hiring process, 'ready' for somebody the company already employs…
  landing?: string
  landing_why?: string
  // WHICH BOOK THEY CAME FROM: the legacy roster, or a SIGNED APPLICATION nobody ever picked up — 130 of those…
  source?: string
  srid?: string
  applied_at?: string
  signed_at?: string
}

export type CrossingQueue = {
  migrated: boolean
  ready: CrossingPerson[]
  /** Why the others are not here: declined · review · disqualified · unreadable. */
  held?: Record<string, number>
  duplicates_hidden?: number
  already_here?: number
  total?: number
  /** How many of `ready` are signed applications rather than roster rows. */
  from_applications?: number
  // THE PEOPLE WHO STARTED THE FORM AND STOPPED — pending, or declined.
  unfinished?: UnfinishedApplication[]
}

export type UnfinishedApplication = {
  srid: string
  name: string
  email: string
  phone: string
  location: string
  status: 'pending' | 'declined'
  applied: string
}

// FlowAction and deriveActions RETIRED.

// ------------------------------------------------------------------ vocabulary — same ids, labels and tints as the…

// THE BUILT-IN PHASES — and now the FALLBACK rather than the only answer.
export const STAGES: { id: string; label: string; tint: TintName; blurb: string }[] = [
  { id: 'new', label: 'New', tint: 'blue', blurb: 'CJIS and resume decisions' },
  { id: 'phone-screen', label: 'Phone Screen', tint: 'lavender', blurb: 'Outreach, attempts, decisions' },
  { id: 'interview', label: 'Interview', tint: 'amber', blurb: 'Scheduling and evaluation' },
  { id: 'onboarding', label: 'Onboarding', tint: 'peach', blurb: 'Docs, training, background' },
  { id: 'hired', label: 'Hired', tint: 'mint', blurb: 'Account, password, Employee DB' },
  { id: 'ready', label: 'Ready to start', tint: 'blue', blurb: 'Waiting on the manager' },
]
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]))
export const STAGE_TINT = Object.fromEntries(STAGES.map((s) => [s.id, s.tint])) as Record<string, TintName>

// The phases as THIS installation calls them: `usePhases`, in the store — this file stays constants, the way its…
export { usePhases } from '@/stores/useFlowPhasesStore'

// Today as YYYY-MM-DD on OHIO's calendar (promoted to @/lib/ohio) — the board rings the day the HOUSES are on.
export const todayKey = ohioToday

/** A candidate's open conditions — what the board card wears as chips. */
export function openConditions(r: FlowRow): ChecklistItem[] {
  return (r.checklist ?? []).filter((c) => c.status === 'pending' || c.status === 'missing')
}

// The CURRENT stage's steps only — they are never cumulative: at Interview the card talks about the interview, not…
export function stageItems(r: FlowRow): ChecklistItem[] {
  return (r.checklist ?? []).filter((c) => c.stage === r.stage)
}

// The document map and its opener MOVED INTO THE ENGINE when the Pipeline card learned to open a finished item too.
export { DOC_ID_FOR, itemViewable, viewItemDoc } from '@/engine/templates/pipeline/viewDoc'

// Blue at 7 and above, red below — informational always: the nota never gates a stage move.
export const SCORECARD_PASS = 7

/** Every name and avatar on this page is a door to the full profile. */
export const profileRoute = (id: string) => '/app/hiring/candidate?id=' + encodeURIComponent(String(id))

export const inputCls = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-1 outline-none focus:border-primary'
export const btnCls = 'rounded-md border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2'

// The declared cut — the calendar shows the interview and the first day; phone screens and onboarding are workflow…
export const EVENT_TYPES: { id: string; label: string }[] = [
  { id: 'in_person_interview', label: 'In-person interview' },
  { id: 'start_date', label: 'Start date' },
]

export const EVENT_TINT: Record<string, TintName> = {
  in_person_interview: 'lavender',
  start_date: 'mint',
}

// Which event the CURRENT stage is waiting on — the calendar's inbox.
export const MISSING_SPEC: Record<string, { field: string; need: string[]; schedule: string }> = {
  interview: { field: 'Interview date', need: ['in_person_interview'], schedule: 'in_person_interview' },
  hired: { field: 'Start date', need: ['start_date'], schedule: 'start_date' },
  ready: { field: 'Start date', need: ['start_date'], schedule: 'start_date' },
}
