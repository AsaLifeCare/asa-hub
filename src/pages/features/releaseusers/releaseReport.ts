// RELEASE USERS — what the two answers mean, in the screen's words.
// Kept apart from the screen so each outcome can be held to a fixture: the release's answers and its refusals, and…

// THE LETTER FIRST, THE PASSWORD AFTER.
export type ReleaseResult = {
  cleared: string[]
  emailed: boolean
  held?: boolean
  // WHICH BRAKE, in one word.
  held_reason?: string
  outcome?: 'sent' | 'already_sent' | 'held' | 'nothing_sent' | 'refused' | 'rearm_failed'
  test_mode?: 'on' | 'off' | 'unknown'
  /** the master chose to rearm knowing nothing reached the person */
  released_anyway?: boolean
  /** null when the sessions could not all be ended — unknown, never zero */
  sessions_ended?: number | null
  /** what the release could not finish after the rearm; the rearm stands */
  warnings?: string[]
  /** the 409 answer carries this instead: nothing was changed */
  blocked_by?: string
  /** which legs ran, e.g. ['email', 'sms (held)'] */
  legs?: string[]
  /** why a leg did not run — an account with no number, a shared line */
  why?: string[]
  /** a failed rearm (500 `rearm_failed`): what the write threw */
  rearm_error?: string
  /** a failed rearm: true when every written cell was put back; absent is unknown, never "put back" */
  restored?: boolean
}

/** appReleaseAnnounce's answer — one page of the letter run. */
export type AnnounceResult = {
  app_id: string
  title: string
  // who was ADDRESSED: the badges open the app AND the master released the account; absent when nothing ran (the…
  eligible?: number
  /** everybody the badges open the app to, addressed or not */
  matched?: number
  /** matched, but never released — counted so the gap is never silent */
  not_released?: number
  /** released badge holders a letter already reached — skipped, never written twice */
  already_told?: number
  /** the send door answered "this exact letter already left" */
  already_sent?: number
  sent: number
  // letters a switch held — test mode, the sending switch, a row that records.
  held: number
  /** the letters a switch held, counted by the switch that held each */
  held_by?: Record<string, number>
  /** letters the quiet window held; `quiet_owed` says the morning list keeps them */
  held_quiet?: number
  quiet_owed?: boolean
  /** people who asked not to be contacted — nothing ever releases these */
  declined?: number
  /** people not written to because the opt-out list could not be read */
  unchecked?: number
  failed: number
  /** the sentence that stopped the run — a situation switched off mid-run */
  stopped?: string
  /** when this app was last announced to everybody it addressed, or '' — it never refuses a press */
  announced_before?: string
  /** false when the told-log did not land: whoever the run reached is not known as told */
  log_written?: boolean
  done: boolean
  resume: number
}

/** The sentence for a hold, from the word the send door gave — never guessed. */
export const HELD_WORDS: Record<string, string> = {
  rehearsal: 'held by test mode — the words were written down and nobody was contacted',
  recorded_to: 'written into its own house — this row records instead of sending',
  opted_out: 'this person asked not to be contacted, and no switch changes that',
  /* a read that did not land — nobody said stop, and nobody could check */
  opt_out_unreadable: 'not sent — the opt-out list could not be read, so nobody could check whether ' +
    'this person asked not to be contacted',
  quiet_hours: 'held by the quiet window — it goes out at 08:00',
  send_switch_off: 'the sending switch is off, so nothing leaves the platform',
}

export function heldSentence(reason?: string): string {
  return HELD_WORDS[String(reason || '')] || 'held by a brake before it reached anybody'
}

/** The held letters of an announcement, each count beside the brake that held it — never one guessed word. */
export function heldSummary(out: Pick<AnnounceResult, 'held' | 'held_by'>): string {
  const by = out.held_by || {}
  const parts = Object.keys(by).filter((k) => by[k] > 0).map((k) => `${by[k]} ${heldSentence(k)}`)
  if (parts.length) return parts.join(' · ')
  return out.held ? `${out.held} ${heldSentence('')}` : ''
}

/** Why the letter cannot reach them, from the word the backend gave — never guessed. */
export const BLOCKED_WORDS: Record<string, string> = {
  test_mode_unreadable: 'the test-mode switch could not be read, so nothing may be sent',
  situation_off: 'the invite situation (user_release_invite) is switched off in Smart Comms',
  situation_absent: 'the invite situation (user_release_invite) does not exist in Smart Comms',
  situation_wordless: 'the invite situation (user_release_invite) has no letter written on it',
  situation_unreadable: 'the Smart Comms situations could not be read',
  situation_invitation_off:
    'the invitation situation (auth_invitation) is switched off in Smart Comms, and it stops every invitation, the release invite too',
  password_not_named: 'what left does not name the password — the invite’s words in Smart Comms leave it out, and the letter that names it did not go',
  already_sent: 'this press already sent its letter, naming the password that press made — press Release again to send a fresh one',
  opt_out_unreadable: 'the opt-out list could not be read, so nobody can check whether this person asked ' +
    'not to be contacted — press again once it reads',
  no_mailbox: 'the account signs in with a number, so there is no mailbox for the letter',
  no_door: 'the release lane is not loaded',
  not_delivered: 'the send door refused it',
}

export function blockedSentence(word?: string): string {
  const w = String(word || '')
  return BLOCKED_WORDS[w] || (HELD_WORDS[w] ? heldSentence(w) : 'the letter could not reach them')
}

/* ───────────────────────────── the release ───────────────────────────── */

export type ReleaseReportView = {
  /** `danger` is a failed rearm whose cells were not all put back, or not said to be */
  tone: 'mint' | 'amber' | 'danger'
  headline: string
  /** the account was rearmed and nobody was told the new password */
  lockedOut: boolean
}

// A REARM NOBODY WAS TOLD ABOUT IS A PERSON LOCKED OUT, and it is drawn in the colour of a warning.
export function releaseReportView(report: ReleaseResult): ReleaseReportView {
  const rearmed = Array.isArray(report.cleared) && report.cleared.length > 0
  if (report.blocked_by) {
    return { tone: 'amber', headline: `Refused — nothing was changed: ${blockedSentence(report.blocked_by)}`, lockedOut: false }
  }
  if (report.outcome === 'rearm_failed') {
    return {
      tone: report.restored === true ? 'amber' : 'danger',
      headline: report.emailed
        ? 'The invite reached them, but the account could not be rearmed'
        : 'The account could not be rearmed',
      lockedOut: false,
    }
  }
  if (report.outcome === 'already_sent') {
    return { tone: 'mint', headline: 'Released — the invite for this press had already left', lockedOut: false }
  }
  if (report.emailed) {
    return { tone: 'mint', headline: 'Released — the invite is on its way', lockedOut: false }
  }
  if (report.held) {
    return { tone: 'amber', headline: `Rearmed — the invite was ${heldSentence(report.held_reason)}`, lockedOut: rearmed }
  }
  if (rearmed) return { tone: 'amber', headline: 'Rearmed, and nothing could be sent', lockedOut: true }
  return { tone: 'amber', headline: 'Nothing was changed on the account', lockedOut: false }
}

/** A rearm that failed says whether the row was put back; absent is unknown, never "put back". */
export function rearmFailedLine(restored: boolean | undefined): string {
  if (restored === true) return 'every cell was put back — their own password still works'
  if (restored === false) return 'Some cells could not be put back — check their row before anybody signs in'
  return 'whether every cell was put back was not told — check their row before anybody signs in'
}

export type ReleaseRefusal =
  | { kind: 'blocked'; report: ReleaseResult }
  | { kind: 'rearmed'; report: ReleaseResult }
  | { kind: 'rearm_failed'; report: ReleaseResult; message: string }
  | { kind: 'failed'; message: string }

// WHAT A THROWN RELEASE REALLY SAYS (gasAction keeps the envelope on the error).
export function readReleaseRefusal(e: unknown): ReleaseRefusal {
  const env = (e as { envelope?: { data?: ReleaseResult; status?: number } } | null)?.envelope
  const data = env?.data
  const said = (e instanceof Error ? e.message : String(e ?? '')).trim() || 'the release gave no answer'
  if (env?.status === 409 && data && data.blocked_by) return { kind: 'blocked', report: data }
  if (env?.status === 502 && data && Array.isArray(data.cleared) && data.cleared.length > 0) {
    return { kind: 'rearmed', report: data }
  }
  if (data && data.outcome === 'rearm_failed') return { kind: 'rearm_failed', report: data, message: said }
  return { kind: 'failed', message: said }
}

/* ─────────────────────────── the announcement ─────────────────────────── */

// WHO THE RUN WAS ADDRESSED TO, AND WHO IT SKIPPED.
export function announceAudience(out: AnnounceResult, title: string): string {
  if (out.quiet_owed && out.eligible === undefined) {
    return `Nobody was written to about ${title} yet — the morning pass addresses whoever the badges still open it to`
  }
  const notReleased = out.not_released ?? 0
  const told = out.already_told ?? 0
  return `${out.eligible ?? '—'} released person/people were addressed about ${title}` +
    (told ? ` · ${told} already told, not written to again` : '') +
    (notReleased ? ` · ${notReleased} badge holder(s) not yet released were not written to` : '') +
    (out.quiet_owed ? ' · the rest is owed to the morning pass after 08:00' : '')
}

// EVERYBODY IT ADDRESSES WAS ALREADY TOLD — the one run after which the screen offers the deliberate re-send to…
export function everybodyAlreadyTold(out: AnnounceResult): boolean {
  const n = (v?: number) => Math.max(0, Number(v) || 0)
  return !n(out.sent) && !n(out.already_sent) && !n(out.held) && !n(out.held_quiet) &&
    !n(out.unchecked) && !n(out.failed) && !out.quiet_owed && !out.stopped && out.done &&
    n(out.already_told) > 0 && out.eligible === out.already_told
}

export type AnnounceView = {
  tone: 'mint' | 'info' | 'amber'
  toast: 'success' | 'info' | 'warning'
  title: string
  /** one clause per count the run carried — each hold in its own words */
  parts: string[]
}

// EACH COUNT IN ITS OWN WORDS.
export function announceView(out: AnnounceResult, again = false): AnnounceView {
  const n = (v?: number) => Math.max(0, Number(v) || 0)
  const verb = again ? 'Announced again' : 'Announced'
  if (out.quiet_owed && !out.sent && out.eligible === undefined) {
    return {
      tone: 'info', toast: 'info',
      title: 'Held by the quiet window — it goes out after 08:00',
      parts: ['inside the quiet window nothing reaches a person; the announcement is on the morning list, ' +
              'and the first pass after 08:00 tells whoever it still applies to'],
    }
  }
  const parts: string[] = [`${n(out.sent)} letter(s) sent`, `${out.eligible ?? '—'} addressed`]
  if (n(out.already_sent)) parts.push(`${n(out.already_sent)} had already left`)
  if (n(out.held)) {
    // the switch is named when the answer carried it, and the press is the same either way: nothing sends those…
    const named = Object.values(out.held_by || {}).some((v) => Number(v) > 0)
    parts.push(named
      ? `${heldSummary(out)} — press Announce again once it is off`
      : `${n(out.held)} held by a switch (test mode, the sending switch or a row that records), ` +
        'nobody contacted — press Announce again once it is off')
  }
  if (n(out.held_quiet)) {
    parts.push(`${n(out.held_quiet)} held by the quiet window — ` +
      (out.quiet_owed ? 'owed to the morning pass after 08:00' : 'send again after 08:00'))
  } else if (out.quiet_owed) {
    parts.push('the quiet window began during the run — the rest is owed to the morning pass after 08:00')
  }
  if (n(out.unchecked)) parts.push(`${n(out.unchecked)} not written to — the opt-out list could not be read`)
  if (n(out.declined)) parts.push(`${n(out.declined)} asked not to be contacted`)
  if (n(out.failed)) parts.push(`${n(out.failed)} refused by the transport`)
  if (out.stopped) parts.push(`stopped: ${out.stopped}`)
  if (!out.done) parts.push('the run stopped before the end of the roster')
  const logLost = out.log_written === false
  if (logLost) {
    parts.push('the record of who was told (app_release_log) could not be written — ' +
      'a later press may write to the same people again')
  }

  const owed = n(out.held) + n(out.held_quiet) + n(out.unchecked)
  const reached = n(out.sent) + n(out.already_sent) + n(out.already_told)
  if (n(out.failed) || out.stopped || !out.done || logLost) {
    return {
      tone: 'amber', toast: 'warning',
      title: !out.done
        ? `The run stopped before the end of the roster — ${n(out.sent)} letter(s) sent`
        : out.stopped
          ? `Stopped — ${out.stopped}`
          : n(out.failed)
            ? `${verb} — ${n(out.sent)} sent, ${n(out.failed)} refused`
            : `${verb} — ${n(out.sent)} sent, but who was told could not be recorded`,
      parts,
    }
  }
  if (owed || out.quiet_owed) {
    return {
      tone: 'info', toast: 'info',
      title: n(out.sent)
        ? (owed ? `${verb} — ${n(out.sent)} sent, ${owed} still owed`
                : `${verb} — ${n(out.sent)} sent, the rest owed to the morning pass`)
        : owed
          ? `Nothing left yet — ${owed} letter(s) held, nobody contacted`
          : 'Nothing left yet — the announcement is owed to the morning pass',
      parts,
    }
  }
  if (reached) {
    // nothing left because nobody was owed — said as that, not as "0 letter(s) sent"
    if (everybodyAlreadyTold(out)) {
      return { tone: 'mint', toast: 'success', title: `${verb} — everybody it addresses was already told`, parts }
    }
    return { tone: 'mint', toast: 'success', title: `${verb} — ${n(out.sent)} letter(s) sent`, parts }
  }
  return { tone: 'amber', toast: 'warning', title: `${verb} — nothing was sent`, parts }
}

/* ─────────────────────────── the letter run ─────────────────────────── */

/** One page's request, as appReleaseAnnounce reads it. */
export type AnnouncePagePayload = {
  app_id: string
  title: string
  objective: string
  again: boolean
  resume: number
  /** what earlier pages left owed — the once-per-app stamp is about the whole run */
  outstanding: number
  /** whom earlier pages reached */
  told_before: number
}

/** A run pages at most this many times; the backend's time budget is minutes per page. */
export const ANNOUNCE_MAX_PAGES = 40

// THE LETTER RUN, PAGED THROUGH THE BACKEND'S TIME BUDGET UNTIL DONE.
export async function runAnnouncement(
  ask: (payload: AnnouncePagePayload) => Promise<AnnounceResult>,
  base: { app_id: string; title: string; objective: string; again: boolean },
): Promise<AnnounceResult> {
  let resume = 0
  let sent = 0, held = 0, failed = 0, told = 0, already = 0
  let quiet = 0, declined = 0, unchecked = 0
  const heldBy: Record<string, number> = {}
  let quietOwed = false
  // one page whose told-log did not land is the run's
  let logLost = false
  let eligible: number | undefined
  let matched: number | undefined
  let notReleased: number | undefined
  let last: AnnounceResult | null = null
  let stopped = ''
  let pages = 0
  for (;;) {
    let out: AnnounceResult
    try {
      out = await ask({
        ...base, resume,
        outstanding: held + quiet + unchecked + failed,
        told_before: sent + told + already,
      })
    } catch (e) {
      if (!last) throw e
      stopped = (e instanceof Error ? e.message : String(e ?? '')).trim() || 'a later page gave no answer'
      break
    }
    last = out
    sent += out.sent || 0
    held += out.held || 0
    failed += out.failed || 0
    told += out.already_told || 0
    already += out.already_sent || 0
    quiet += out.held_quiet || 0
    declined += out.declined || 0
    unchecked += out.unchecked || 0
    for (const [k, v] of Object.entries(out.held_by || {})) heldBy[k] = (heldBy[k] || 0) + (Number(v) || 0)
    quietOwed = quietOwed || !!out.quiet_owed
    logLost = logLost || out.log_written === false
    if (out.eligible !== undefined) eligible = out.eligible
    if (out.matched !== undefined) matched = out.matched
    if (out.not_released !== undefined) notReleased = out.not_released
    const next = Math.max(0, Number(out.resume) || 0)
    if (out.done || next <= resume) break
    resume = next
    pages += 1
    if (pages >= ANNOUNCE_MAX_PAGES) break
  }
  const end = last as AnnounceResult
  return {
    ...end,
    eligible, matched, not_released: notReleased,
    sent, held, failed, already_told: told, already_sent: already, held_quiet: quiet,
    declined, unchecked, quiet_owed: quietOwed,
    log_written: logLost ? false : end.log_written,
    // totalled like every other count; absent when no page named a switch
    held_by: Object.keys(heldBy).length ? heldBy : undefined,
    stopped: stopped || end.stopped,
    done: stopped ? false : end.done,
  }
}
