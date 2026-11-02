// Where each House Tool lands.
// The targets live here and nowhere else, so a place that moves (the Time Off app arriving) is repointed in one…
import { houseCalLink } from '@/pages/features/shifts/houseCalTypes'

export type ToolMode = 'staff' | 'client'

/** The estate sheet a tile files into, in place, without opening its app. */
export type FileTarget = 'uiIncidents' | 'workOrders'

export type HouseTool = {
  key: 'incident' | 'maintenance' | 'timeoff' | 'suggestion' | 'calendar' | 'contacts'
  label: string
  icon: string
  /** the in-platform route; absent while the place does not exist yet */
  href?: string
  /** a client files from the house page itself; the apps' lists stay staff's */
  file?: FileTarget
  note: string
}

export const TIME_OFF_APP = 'timeoff'
export const TIME_OFF_PATH = '/app/timeoff/board'

/** Time Off with this house's form prefilled. */
export function timeOffLink(house: { code: string }): string {
  return house.code ? `${TIME_OFF_PATH}?house=${encodeURIComponent(house.code)}` : TIME_OFF_PATH
}

/** The house's calendar on Calendar Builder → Live, through the one link helper. */
export function houseCalendarLink(house: { code: string; calendar_location?: string }): string {
  return houseCalLink(house.calendar_location || house.code)
}

/** The tiles for a house. A client files incidents and repairs in place, and otherwise gets only what the portal may open. */
export function houseTools(
  house: { code: string; calendar_location?: string },
  mode: ToolMode,
  opts: { timeOff: boolean },
): HouseTool[] {
  const suggestion: HouseTool = { key: 'suggestion', label: 'Submit Suggestion', icon: 'lightbulb', href: '/app/suggestions/box', note: 'Suggestions' }
  if (mode === 'client') {
    return [
      { key: 'incident', label: 'Report Incident', icon: 'triangle-alert', file: 'uiIncidents', note: 'Filed with the staff' },
      { key: 'maintenance', label: 'Request Maintenance', icon: 'wrench', file: 'workOrders', note: 'Filed with maintenance' },
      suggestion,
      { key: 'contacts', label: 'Emergency Contacts', icon: 'phone-call', href: '/app/suggestions/box', note: 'Helpful contacts' },
    ]
  }
  return [
    { key: 'incident', label: 'Report Incident', icon: 'triangle-alert', href: '/app/ui-incidents/log', note: 'UI Reports' },
    { key: 'maintenance', label: 'Request Maintenance', icon: 'wrench', href: '/app/house-repair/orders', note: 'House Repair' },
    opts.timeOff
      ? { key: 'timeoff', label: 'Time Off', icon: 'calendar-off', href: timeOffLink(house), note: 'Time Off' }
      : { key: 'timeoff', label: 'Time Off', icon: 'calendar-off', note: 'Coming soon' },
    suggestion,
    { key: 'calendar', label: 'Calendar', icon: 'calendar-days', href: houseCalendarLink(house), note: 'Calendar Builder' },
    { key: 'contacts', label: 'Emergency Contacts', icon: 'phone-call', href: '/app/policy-acks/contacts', note: 'Contact list' },
  ]
}

export type PolicyOpen = { kind: 'in-app'; href: string } | { kind: 'viewer'; url: string }

/** The platform's own copy when the Policies reader holds it, else the document's link in the FileViewer. */
export function policyOpen(p: { url: string; in_app_doc?: string }, mode: ToolMode): PolicyOpen {
  if (p.in_app_doc && mode === 'staff') return { kind: 'in-app', href: '/app/policy-acks/documents' }
  return { kind: 'viewer', url: p.url }
}
