// What of the shell this session does not see (myWorkHidesMine, Python's alone): read once per account and held for
// the page's life; until it answers, and when it cannot, every part stays hidden.
import { useEffect, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'

export type ShellHides = {
  add_apps: boolean
  time_off_messages: boolean
  sched_training_legend: boolean
  ssa_documents: boolean
  /** every test mode warning the apps draw */
  test_mode_warnings: boolean
  client_medication: boolean
  client_billing: boolean
  /** My Inbox's alerts about new staff members and the release notes' updates */
  inbox_alerts: boolean
  location_supplies: boolean
  profile_docs: boolean
  /** "<source>: the copy read here was mirrored <day>…" on My Profile › My Requirements and My Work (blanked by the server) */
  copy_mirrored: boolean
  inbox_alerts_subtitle: boolean
  candidates_crumb: boolean
  transport_submenu: boolean
  client_trips: boolean
  staff_calendar_clients: boolean
  /** Staff › Calendar: the line under the title, the count coming up, the week headers and their counts, the badges */
  staff_calendar_details: boolean
  /** Clients › the Client details panel: its title, the Updated line, the intro and the notes under the fields */
  client_edit_notes: boolean
  /** SSA › Activity: the Coordination follow-up section */
  ssa_coordination: boolean
  /** SSA › the Edit details panel: its title, the intro and the notes under the fields */
  ssa_edit_notes: boolean
  /** every New incident panel: its title, the notes under the fields and the Still needed line */
  incident_notes: boolean
  /** Clients › Transportation: the Vehicles tab, the counts and the lines under them */
  client_transport_notes: boolean
  staff_profile_map: boolean
  /** Staff › Staff Profile: the ISTs card and Where they worked */
  staff_profile_ists_worked: boolean
  /** Staff's edit panels (Staff Details, Employment, HR, Compliance, Driver…): the intro and the notes under the fields */
  staff_edit_notes: boolean
  /** the whole Recruiters' Book app (kept to the master by the server: the apps list and every row) */
  recruiters_book: boolean
  /** the progress panel an edit's Apply shows (every edit panel) */
  apply_progress: boolean
  /** Support Requests: the line under the title */
  support_desk_subtitle: boolean
  /** Clients › Care & Support: the Home & equipment tab */
  client_care_home: boolean
  /** My Work › Client training (IST): the booking panel, the directors' approvals and their outcome */
  ist_booking: boolean
  /** the whole Mail app, cut from every other account's lists (the app is the master's alone whatever this says) */
  mail_app: boolean
}

export const SHELL_HIDDEN: ShellHides = {
  add_apps: true, time_off_messages: true, sched_training_legend: true, ssa_documents: true, test_mode_warnings: true,
  client_medication: true, client_billing: true, inbox_alerts: true, location_supplies: true, profile_docs: true,
  copy_mirrored: true, inbox_alerts_subtitle: true, candidates_crumb: true, transport_submenu: true, client_trips: true,
  staff_calendar_clients: true, staff_calendar_details: true, client_edit_notes: true, ssa_coordination: true,
  ssa_edit_notes: true, incident_notes: true, client_transport_notes: true, staff_profile_map: true,
  staff_profile_ists_worked: true, staff_edit_notes: true, recruiters_book: true,
  apply_progress: true,
  support_desk_subtitle: true,
  client_care_home: true, ist_booking: true, mail_app: true,
}

/** Every part shown: the master's own answer. */
export const SHELL_SHOWN: ShellHides = Object.fromEntries(Object.keys(SHELL_HIDDEN).map((k) => [k, false])) as ShellHides

let held: { who: string; value: Promise<ShellHides> } | null = null
// the last answer for an account, drawn at once by the next screen that asks (no flash of a hidden part); '*' any
let known: { who: string; value: ShellHides } | null = null

const knownFor = (who: string): ShellHides | null => (known && (known.who === who || known.who === '*') ? known.value : null)

/** Hands every screen an answer without asking the server (a screen test's own switches). */
export function primeShellHides(value: ShellHides, who = '*'): void {
  known = { who, value }
  held = who === '*' ? null : { who, value: Promise.resolve(value) }
}

/** The parts one answer names; anything it does not say true or false stays hidden. */
export function shellHidesOf(raw: unknown): ShellHides {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries((Object.keys(SHELL_HIDDEN) as (keyof ShellHides)[]).map((k) => [k, o[k] !== false])) as ShellHides
}

/** The session's own answer, asked once per account; a refusal or a failure reads as everything hidden. */
export function readShellHides(who: string): Promise<ShellHides> {
  if (held && held.who === who) return held.value
  const primed = knownFor(who)
  if (primed) return Promise.resolve(primed)
  const value = gasAction<unknown>('myWorkHidesMine', {}).then(shellHidesOf, () => SHELL_HIDDEN)
    .then((h) => {
      known = { who, value: h }
      return h
    })
  held = { who, value }
  return value
}

export function useShellHides(): ShellHides {
  const who = useAuthStore((s) => s.user?.id || s.user?.email || '')
  const [hides, setHides] = useState<ShellHides>(() => knownFor(who) ?? SHELL_HIDDEN)
  useEffect(() => {
    if (!who) {
      setHides(knownFor('') ?? SHELL_HIDDEN)
      return
    }
    let live = true
    void readShellHides(who).then((h) => { if (live) setHides(h) })
    return () => { live = false }
  }, [who])
  return hides
}

/** Whether this session draws no test mode warning: never the master's own; anyone else while the switch hides them. */
export function useTestWarningsHidden(): boolean {
  const master = useEffectiveIsMaster()
  const hides = useShellHides()
  return !master && hides.test_mode_warnings
}

/** A line with its "Test mode" part taken out (My Inbox's item bodies: "… · Test mode"). */
export function withoutTestWords(text: string): string {
  return text.split(' · ').filter((part) => !/^test mode\b/i.test(part.trim())).join(' · ')
}
