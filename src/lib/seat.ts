// Ending a visit at a shared seat.
// `onboarding@asalifecare.com` is the laptop in the training room; the `interviewer` account is the laptop in the…
import { gasAction } from '@/features/hiring/shared'
import { invalidateAll } from '@/lib/apiCache'
import { useContextStore } from '@/stores/useContextStore'
import { useOnboardingStore } from '@/stores/useOnboardingStore'
import { forgetSnapshot } from '@/lib/snapshotClient'
import type { SeatFlow } from '@/lib/roleAccess'

export type SeatReleaseResult = {
  /** how many records the server unbound (0 for flows it holds nothing for) */
  released: number
  /** who was released, for the confirmation line */
  people: string[]
  // What a FINISHED visit set off elsewhere — finishing onboarding moves the person to Hired on the hiring board.
  followed?: {
    moved: boolean
    stage?: string
    candidate_id?: string
    reason?: string
    // finished everything, waiting on the signed New Hire packet — the card stays at Onboarding instead of moving…
    held?: boolean
    hold_until?: string
    packet_state?: string
  }[]
}

// Hand the seat back.
export async function releaseSeat({
  flow,
  userId,
  completed = false,
  report,
}: {
  flow: SeatFlow
  /** the seat account's id — what the step ticks were filed under */
  userId?: string
  completed?: boolean
  // THE TWO NUMBERS THE RECORD CANNOT KNOW.
  report?: {
    questionnaire_answered: number
    questionnaire_total: number
    tutorials_seen: number
    tutorials_total: number
  }
}): Promise<SeatReleaseResult> {
  let result: SeatReleaseResult = { released: 0, people: [] }
  try {
    result = await gasAction<SeatReleaseResult>('seatRelease', { flow, completed, ...(report ?? {}) })
  } catch {
    // logged server-side; the local wipe below matters more than the report
  } finally {
    clearSeatLocally(userId)
  }
  return result
}

/** Everything one visit leaves in THIS browser. */
export function clearSeatLocally(userId?: string) {
  if (userId) useOnboardingStore.getState().resetUser(userId)
  const ctx = useContextStore.getState()
  ctx.clearFocus()
  ctx.forgetRecents()
  invalidateAll()
  // the snapshot slices this tab pulled belong to the visit that just ended
  forgetSnapshot()
}
