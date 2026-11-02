// The real-world facts a new hire needs during onboarding: where to get the background check, which training…
// Kept in ONE place on purpose.

export type ContactCard = {
  vendor: string
  /** What the step tells the person, in their own reading order. */
  lead: string
  company: string
  address: string
  /** Kept as written on the door — a person compares it to a sign, not a parser. */
  hours: string
  phone: string
  /** The code the clerk asks for; wrong code = the check is run for nothing. */
  reasonCode?: string
  bring: string
  mapsQuery: string
}

// Background check — confirmed vendor: True Hire, BCI only (no FBI print at this stage), walk-in, no appointment.
export const BACKGROUND_CHECK: ContactCard = {
  vendor: 'True Hire',
  lead: 'Your DODD background check is through True Hire. This is a BCI check only — walk-ins welcome, no appointment needed.',
  company: 'A Brighter Dawn, Inc',
  address: '4650 Hills and Dales Rd NW, Ste. 320, Canton, OH 44708',
  hours: 'Mon–Fri, 8 AM–5 PM (closed 12–1 PM)',
  phone: '(330) 919-7595',
  reasonCode: '5123.081',
  bring: "Bring a valid photo ID (Driver's License or State ID). That's all you need.",
  mapsQuery: '4650 Hills and Dales Rd NW Ste 320, Canton, OH 44708',
}

export function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

// Training providers.
export const TRAINING_LINKS = {
  doddNewEmployee: 'https://dodd.ohio.gov/training/mylearning',
  doddAnnualRenewal: 'https://dodd.ohio.gov/training/mylearning',
  cprRegistration: 'https://1stchoicecpr.enrollware.com/calendar',
} as const
