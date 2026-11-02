// THE INTAKE STAGES — the six a referral moves through, in order, each with its tint, and the words the…
// The mapping is for display and filtering only: the sheet keeps what it holds.

export type IntakeStageTint = 'blue' | 'amber' | 'lavender' | 'peach' | 'mint' | 'pink'
export type IntakeStage = { id: string; label: string; tint: IntakeStageTint; description: string }

export const INTAKE_STAGES: readonly IntakeStage[] = [
  { id: 'referral', label: 'Referral', tint: 'blue', description: 'Received — nobody has worked it yet' },
  { id: 'discovery', label: 'Discovery', tint: 'amber', description: 'First call with the family or SSA' },
  { id: 'assessment', label: 'Assessment', tint: 'lavender', description: 'Needs assessment & house fit' },
  { id: 'placement-review', label: 'Placement Review', tint: 'peach', description: 'Paperwork, funding and waiver checks' },
  { id: 'ready-for-intake', label: 'Ready for Intake', tint: 'mint', description: 'Cleared — admission can begin' },
  { id: 'closed', label: 'Closed', tint: 'pink', description: 'Chose another provider, deferred or on hold' },
]

/** A stage cell folded: 'Placement Review' → placement-review, 'On hold' → on-hold. */
export const foldStage = (v: unknown): string =>
  (v == null || typeof v === 'object' ? '' : String(v)).trim().toLowerCase().replace(/[\s_-]+/g, '-')

/** The words rows already hold → the stage they show as. A row with no stage has not been moved: a referral. */
const HELD: Record<string, string> = {
  '': 'referral', new: 'referral', scraped: 'referral', read: 'referral', contacted: 'discovery',
  'isp-drafting': 'placement-review', intake: 'placement-review', converted: 'ready-for-intake',
  'on-hold': 'closed', lost: 'closed',
}

/** The intake stage a stage cell shows as; null for a word neither vocabulary knows (drawn as written, under All). */
export function intakeStageOf(v: unknown): IntakeStage | null {
  const s = foldStage(v)
  const id = INTAKE_STAGES.some((x) => x.id === s) ? s : HELD[s]
  return id === undefined ? null : INTAKE_STAGES.find((x) => x.id === id) ?? null
}

/** The Funnel column a stage written here stands in; '' for a Referral (the score decides) or any other word. */
const FUNNEL_COLUMN: Record<string, string> = {
  discovery: 'contacted', assessment: 'assessment', 'placement-review': 'intake', 'ready-for-intake': 'converted',
  closed: 'lost',
}

export const funnelColumnOf = (v: unknown): string => FUNNEL_COLUMN[foldStage(v)] ?? ''
