// THE PHASES, AS ONE VOCABULARY — and it is CODE, not configuration.
// This began as a settings screen, and the rule that undid it a day later is why it is not one any more: what in…
import type { TintName } from '@/engine/types'
import { STAGES, STAGE_LABEL, STAGE_TINT } from '@/pages/features/hiring/flow/shared'

export function usePhases(): {
  stages: { id: string; label: string; tint: TintName; blurb: string }[]
  label: Record<string, string>
  tint: Record<string, TintName>
} {
  return { stages: STAGES, label: STAGE_LABEL, tint: STAGE_TINT }
}
