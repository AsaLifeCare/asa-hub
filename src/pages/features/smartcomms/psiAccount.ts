// WHICH PSIANYWHERE ACCOUNT THE RELAY READS AS — one line, for the Punch board and the Desk.
// The rule: keep using the line already in hand (ADM) and, twice a day, as a setup inside the software, try to log…

/** Ty's day on the relay's login clock. */
export type TyStatus = {
  configured?: boolean
  active?: boolean
  slots?: string[]
  next_slot?: string
  tries_today?: number
  tries_per_day?: number
  last_at?: string
  last_answer?: string
  last_slot?: string
  last_slot_said?: string
  refused?: string
}

// DOWN by the lane's definition — a failed read AND a failed login right after it — while it lasts.
export type DownStatus = { since?: string; why?: string; retry_at?: string; retries?: number }

/** An instant as "Sep 22, 10:15 AM", New York. */
const when = (iso: string): string => {
  const d = new Date(iso || '')
  return Number.isNaN(d.getTime())
    ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                       timeZone: 'America/New_York' })
}

// The account in use and Ty's last try with its answer, or '' from a relay that does not say yet.
export function accountText(s: { account?: string; ty?: TyStatus }): string {
  if (!s.account) return ''
  const who = s.account === 'ty' ? "Ty's account" : 'the ADM line'
  const ty = s.ty
  let tyPart: string
  if (!ty || !ty.configured) {
    tyPart = 'the Ty account has no credential on the relay, so its twice-daily try is idle'
  } else if (ty.active) {
    tyPart = `a Ty try signed in${ty.last_at ? ` (${when(ty.last_at)})` : ''} — the ADM line is the fallback`
  } else {
    const last = ty.last_at ? `last Ty try ${when(ty.last_at)}: ${ty.last_answer || 'no answer'}` : 'Ty not tried yet'
    const next = ty.next_slot ? `; next try ${when(ty.next_slot)}` : ''
    tyPart = `${last}${next} (${ty.tries_today ?? 0} of ${ty.tries_per_day ?? 2} today)`
  }
  return `PsiAnywhere is read as ${who} · ${tyPart}.`
}

/** DOWN in one line, or ''. */
export function downText(down?: DownStatus | null): string {
  if (!down) return ''
  const retry = down.retry_at ? ` — next health retry ${when(down.retry_at)} (the service first, a login only if it answers)` : ''
  return `PsiAnywhere is down since ${when(down.since || '')}${retry}.`
}
