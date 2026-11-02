// WHICH BADGES CAN EVER REACH THIS THING — derived from the code, not offered blindly.
// The code already knows that a given feature will never apply to INTERVIEWER, STAFF, CLIENT, FAMILY or…
import type { AppManifest } from '@/engine/types'
import { RESTRICTED_ROLE_APPS } from '@/lib/roleAccess'
import { MASTER_ONLY_APPS } from '@/lib/badgeAccess'

/** The six words that are roles. Everything else on a chip row is a type. */
export const ROLE_WORDS = ['ADMIN', 'MANAGER', 'STAFF', 'CLIENT', 'ONBOARDING', 'INTERVIEWER']

// A role that only ever sees its own allow-list, and loses My asa., Settings, the notification centre and the…
const RESTRICTED = Object.keys(RESTRICTED_ROLE_APPS).map((r) => r.toUpperCase())

export type Reach = {
  /** the badges worth offering — types always, roles only where they arrive */
  badges: string[]
  /** the roles that were dropped, so the screen can say why rather than hide */
  dropped: string[]
  /** one sentence naming the reason, for the row's own tooltip */
  why: string
}

const keep = (all: string[], dropRoles: string[], why: string): Reach => {
  const drop = new Set(dropRoles.map((r) => r.toUpperCase()))
  return {
    badges: all.filter((b) => !drop.has(b)),
    dropped: all.filter((b) => drop.has(b)),
    why,
  }
}

// AN APP ROW.
export function reachForApp(all: string[], app: AppManifest | undefined): Reach {
  if (!app) return { badges: all, dropped: [], why: '' }
  // the one exception to "types are never dropped": no badge at all reaches a master-only app
  if (MASTER_ONLY_APPS.includes(app.id)) return { badges: [], dropped: [...all], why: 'this app is the master’s alone — no badge opens it' }
  const aud = app.audience ?? ['all']
  const drop: string[] = []
  const notes: string[] = []

  if (!aud.includes('client') && !aud.includes('all')) {
    drop.push('CLIENT')
    notes.push("this app's audience does not name clients")
  }
  return keep(all, drop, notes.join('; '))
}

// A SETTINGS SECTION.
export function reachForSection(all: string[], adminOnly: boolean, masterOnly = false): Reach {
  // settingsNavFor gates these on isMaster before any rule is read (MASTER_ONLY_SECTIONS)
  if (masterOnly) return { badges: [], dropped: [...all], why: 'this section is the master’s alone — no badge opens it' }
  const drop = [...RESTRICTED]          // a restricted role has no Settings at all
  const notes = ['trainees and interviewers have no Settings page']
  if (adminOnly) {
    drop.push('MANAGER', 'STAFF', 'CLIENT')
    notes.push('this section is admin-only and a rule can only narrow, never grant')
  }
  return keep(all, drop, notes.join('; '))
}

// A SHELL FEATURE.
export function reachForFeature(all: string[], featureId: string): Reach {
  const drop = [...RESTRICTED]
  const notes = ['trainees and interviewers keep a one-screen shell — this surface is not in it']
  if (featureId === 'franchise') {
    // the places stack is employee chrome; a client stands in one place
    drop.push('CLIENT')
    notes.push('a client has one place to stand, so there is no franchise card to open')
  }
  return keep(all, drop, notes.join('; '))
}
