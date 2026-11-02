/** Shared constants, motion variants + small helpers (moved verbatim from PipelineTemplate.tsx). */
import { Check, Clock, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { TintName } from '@/engine/types'
import type { ChecklistItem, ChecklistStatus } from './types'

export const isComplete = (i: ChecklistItem) => i.status === 'done' || i.status === 'auto'

export const STATUS_META: Record<ChecklistStatus, { icon: LucideIcon; bg: string; fg: string; tooltip: string }> = {
  done: { icon: Check, bg: TINT_BG.mint, fg: TINT_FG.mint, tooltip: 'Done' },
  pending: { icon: Clock, bg: TINT_BG.amber, fg: TINT_FG.amber, tooltip: 'Pending' },
  missing: { icon: Upload, bg: 'bg-transparent', fg: TINT_FG.pink, tooltip: 'Missing — needs upload' },
  auto: { icon: Sparkles, bg: TINT_BG.blue, fg: TINT_FG.blue, tooltip: 'Auto-generated' },
}

export const OWNER_TINT: Record<string, TintName> = {
  Candidate: 'blue',
  Recruiter: 'lavender',
  HR: 'peach',
  Auto: 'mint',
}

export const MISSING_STYLE = { border: '1px dashed var(--tint-pink-fg)' }

/* ---------------- cards & bands ---------------- */

export const bandContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
export const bandItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } },
}
export const cardItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT_EXPO } },
}

export function agingClass(days: number) {
  if (days <= 7) return 'text-text-3'
  if (days <= 14) return 'text-warning'
  return 'text-danger'
}
