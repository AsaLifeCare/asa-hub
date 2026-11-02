/** The transfer doors every screen calls; the relay works out sides from the session (lane_handoff_*). */
import { toast } from '@/stores/useToastStore'
import { post } from './laneFetch'
import type { HandoffView } from './requestsLogic'

export const CANDIDATES_PATH = '/hub-lanes/shift-handoff/candidates'
export const OFFER_PATH = '/hub-lanes/shift-handoff'
export const ANSWER_PATH = '/hub-lanes/shift-handoff/answer'
export const WITHDRAW_PATH = '/hub-lanes/shift-handoff/withdraw'

/** The candidates door for one shift; `fromStaff` only for another person's shift. */
export function candidatesUrl(location: string, colIso: string, fromStaff = ''): string {
  const q = new URLSearchParams({ location, col_iso: colIso })
  if (fromStaff) q.set('from_staff', fromStaff)
  return `${CANDIDATES_PATH}?${q.toString()}`
}

/** Answer or withdraw a transfer, and say what it came to. */
export async function actOnHandoff(h: HandoffView, act: 'yes' | 'no' | 'withdraw'): Promise<HandoffView> {
  const res = act === 'withdraw'
    ? await post<HandoffView>(WITHDRAW_PATH, { handoff_id: h.id })
    : await post<HandoffView>(ANSWER_PATH, { handoff_id: h.id, word: act })
  const accepting = h.may_accept
  // NOTHING RECORDED IS NOT AN ANSWER: the door answers 200 with `changed: false` when that consent was already…
  if (act !== 'withdraw' && res.changed === false) {
    toast({ type: 'warning', title: 'Nothing was recorded',
            body: 'That answer had already been given — the swap keeps the name that gave it.' })
    return res
  }
  toast({
    type: act === 'yes' ? 'success' : 'info',
    title: act === 'withdraw' ? 'Transfer withdrawn'
      : act === 'yes' ? (accepting ? 'Shift accepted' : 'Transfer approved')
        : (accepting ? 'Passed' : 'Not approved'),
    body: act === 'withdraw' ? `The ${h.value} shift stays with ${h.from_staff}.`
      : res.state === 'done' ? `Done — ${h.to_staff} has the ${h.value} shift; the calendar says so now.`
        : res.state === 'dead' ? `The transfer ended${res.why ? ` — ${res.why}` : ''}.`
          : act === 'yes' && res.why ? `All three agreed — ${res.why}`
            : act === 'yes' ? (accepting ? 'It is yours once it is approved.' : `${h.to_staff} takes it once they accept.`)
              : `The ${h.value} shift stays with ${h.from_staff}.`,
  })
  return res
}
