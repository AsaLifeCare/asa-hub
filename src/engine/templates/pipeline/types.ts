/** Shared types for the `pipeline` template (moved verbatim from PipelineTemplate.tsx). */
import type { TintName } from '@/engine/types'

export type Stage = {
  id: string
  label: string
  tint: TintName
  description?: string
  limit?: number
  /** celebration stage (e.g. "Hired"): tinted cards + party icon */
  celebrate?: boolean
}

/* ---------------- document checklist ---------------- */

export type ChecklistStatus = 'done' | 'pending' | 'missing' | 'auto'
export type ChecklistItem = {
  id: string
  label: string
  status: ChecklistStatus
  owner?: string
  stage: string
  // true = a real document upload; absent/false = analysis checkpoint (status dot only, no Upload button).
  upload?: boolean
}

// WHAT A STAGE ASKS FOR AS A FORM.
export type StageForm = { slug: string; token: string; title?: string }

export const STAGE_FORMS: Record<string, StageForm> = {
  new: {
    slug: 'hiring-pipeline-candidate-pending-1-3',
    token: 'QRPZxQ76oLoCvnrHSacVunpo',
    title: 'Pending here',
  },
}

export type CardMenu = {
  canEdit: boolean
  nextStageLabel?: string
  onAdvance: () => void
  onOpen: () => void
}
