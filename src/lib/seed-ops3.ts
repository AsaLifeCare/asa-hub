// Client-ops seed (clientops-suite wave): call-offs, doctor appointments and UI (unusual incident) reports — the…
// seed-extra.ts is off-limits for this wave, so this module SELF-REGISTERS: at import time it appends its datasets…
import { addDays, subDays } from 'date-fns'
import { withTenant } from '@/lib/tenancy'
import { extraSeeds } from '@/lib/seed-extra'
import { people } from '@/lib/seed'
import { clients as careClients } from '@/lib/seed-care'

const day = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')

/** Staff pool (names + avatars) shared with every other ops dataset. */
const STAFF = people.slice(0, 12)

/** Group-home codes (Canton, OH street-address style). */
export const HOUSE_CODES = [
  'CAN-38TH-ABD2005',
  'CAN-12TH-HLC1130',
  'CAN-MARKET-MRK0412',
  'CAN-TUSC-TSC2210',
  'CAN-WESTF-WFD0874',
  'CAN-ARLINGTON-ARL0908',
]

export const SHIFT_CODES = ['8A-8P', '2P-10P', '6A-2P', '10P-6A', '47TH', 'WKND-8A-8P']

export const CALL_OFF_REASONS = ['Sick', 'Family emergency', 'Car trouble', 'No childcare', 'Weather', 'Other'] as const

/* ---------------- callOffs (14) — same-day staffing call-offs ---------------- */

export type CallOffStatus = 'open' | 'covered' | 'uncoverable'
export type CallOffReason = (typeof CALL_OFF_REASONS)[number]

export type CallOff = {
  id: string
  date: string // yyyy-mm-dd (this week)
  staffName: string
  avatar: string
  shiftCode: string
  houseCode: string
  reason: CallOffReason
  calledAt: string // "HH:mm"
  status: CallOffStatus
  coveredBy?: string
  notes?: string
}

// [daysFromNow, reasonIdx, status, calledAt hour:min, note?]
const CALL_OFF_ROWS: Array<[number, number, CallOffStatus, string, string?]> = [
  [0, 0, 'open', '05:48', 'Texted the house manager — fever overnight.'],
  [0, 3, 'covered', '06:12', 'Float staff confirmed by 07:15.'],
  [0, 2, 'open', '06:42', 'Car would not start; waiting on a tow.'],
  [0, 0, 'covered', '04:55'],
  [-1, 1, 'covered', '21:30', 'Called the on-call line the evening before.'],
  [-1, 0, 'open', '06:05'],
  [-1, 4, 'uncoverable', '07:20', 'Snow emergency — county roads closed. Shift absorbed by house lead.'],
  [-2, 0, 'covered', '05:37'],
  [-2, 5, 'covered', '12:10', 'Court appointment ran long — covered from 14:00.'],
  [-2, 3, 'uncoverable', '05:59', 'No float available on the south side.'],
  [-3, 1, 'covered', '06:26'],
  [-3, 0, 'covered', '05:41'],
  [-4, 2, 'open', '06:58', 'Flat tire en route; rideshare refused the trip.'],
  [-4, 0, 'covered', '06:02'],
]

export const callOffs: CallOff[] = withTenant(CALL_OFF_ROWS.map(([dOff, reasonIdx, status, calledAt, notes], i) => {
  const staff = STAFF[(i * 5 + 1) % STAFF.length]
  return {
    id: `co-${pad(i + 1)}`,
    date: day(addDays(now, dOff)),
    staffName: staff.name,
    avatar: staff.avatar,
    shiftCode: SHIFT_CODES[i % SHIFT_CODES.length],
    houseCode: HOUSE_CODES[(i * 3 + 1) % HOUSE_CODES.length],
    reason: CALL_OFF_REASONS[reasonIdx % CALL_OFF_REASONS.length],
    calledAt,
    status,
    coveredBy: status === 'covered' ? STAFF[(i * 7 + 4) % STAFF.length].name : undefined,
    notes,
  }
}))

/* ---------------- drAppointments (12) — caregiver-driven medical transports ---------------- */

export type DrAppointmentStatus = 'scheduled' | 'completed' | 'missed' | 'rescheduled'
export type TransportMode = 'company-van' | 'staff-car' | 'family'

export const APPT_SPECIALTIES = [
  'Cardiology', 'Primary care', 'Dentist', 'Neurology',
  'Podiatry', 'Psychiatry', 'Vision', 'Dermatology',
] as const
export type ApptSpecialty = (typeof APPT_SPECIALTIES)[number]

export type DrAppointment = {
  id: string
  clientId: string // cl-NN (seed-care)
  clientName: string
  specialty: ApptSpecialty
  doctor: string
  date: string // yyyy-mm-dd
  time: string // "HH:mm"
  address: string
  driverStaffName: string // the caregiver who drives
  status: DrAppointmentStatus
  transport: TransportMode
  notes?: string
}

const DOCTORS: Record<ApptSpecialty, string> = {
  Cardiology: 'Dr. Alan Reyes',
  'Primary care': 'Dr. Megan Foster',
  Dentist: 'Dr. Priya Lane',
  Neurology: 'Dr. Samuel Okafor',
  Podiatry: 'Dr. Ellen Marsh',
  Psychiatry: 'Dr. David Ortiz',
  Vision: 'Dr. Hannah Brooks',
  Dermatology: 'Dr. Victor Hale',
}

const APPT_ADDRESSES = [
  'Riverside Heart Center, 1220 Market Ave N, Canton, OH 44702',
  'Meadowlane Family Health, 4708 Meadowlane Dr NW, Canton, OH 44718',
  'SmileWorks Dental, 2210 34th St NW, Canton, OH 44709',
  'NeuroCare Clinic, 2600 6th St SW, Canton, OH 44710',
  'Foot & Ankle Partners, 1320 Mercy Dr NW, Canton, OH 44708',
  'Behavioral Wellness Center, 908 Arlington Ave NW, Canton, OH 44708',
  'ClearView Eye Care, 4230 Belden Village St NW, Canton, OH 44718',
  'Skin Health Associates, 7740 Kenwood Rd, North Canton, OH 44720',
]

const APPT_NOTES = [
  'Bring med list and insurance card.',
  'Fasting labs before the visit — no breakfast.',
  'Guardian will meet staff at the clinic.',
  'Wheelchair van required.',
  'Follow-up from last quarter.',
  undefined,
]

// [daysFromNow, clientIdx, specialtyIdx, time, status, transportIdx, driverIdx]
const APPT_ROWS: Array<[number, number, number, string, DrAppointmentStatus, number, number]> = [
  [1, 0, 1, '09:30', 'scheduled', 0, 1],
  [2, 3, 2, '10:15', 'scheduled', 1, 5],
  [3, 5, 0, '13:00', 'scheduled', 0, 3],
  [4, 1, 6, '08:45', 'scheduled', 2, 0],
  [5, 8, 4, '11:20', 'scheduled', 1, 9],
  [6, 2, 3, '14:10', 'rescheduled', 0, 2],
  [8, 6, 5, '15:30', 'scheduled', 1, 6],
  [10, 9, 7, '09:00', 'scheduled', 0, 11],
  [-1, 4, 1, '10:40', 'completed', 1, 4],
  [-2, 7, 2, '13:25', 'completed', 0, 8],
  [-3, 10, 0, '08:30', 'missed', 1, 7],
  [-5, 11, 6, '11:05', 'completed', 2, 10],
]

export const drAppointments: DrAppointment[] = withTenant(APPT_ROWS.map(([dOff, cIdx, sIdx, time, status, tIdx, drvIdx], i) => {
  const client = careClients[cIdx % careClients.length]
  const specialty = APPT_SPECIALTIES[sIdx % APPT_SPECIALTIES.length]
  return {
    id: `dra-${pad(i + 1)}`,
    clientId: client.id,
    clientName: client.name,
    specialty,
    doctor: DOCTORS[specialty],
    date: day(addDays(now, dOff)),
    time,
    address: APPT_ADDRESSES[sIdx % APPT_ADDRESSES.length],
    driverStaffName: STAFF[drvIdx % STAFF.length].name,
    status,
    transport: (['company-van', 'staff-car', 'family'] as TransportMode[])[tIdx % 3],
    notes: APPT_NOTES[i % APPT_NOTES.length],
  }
}))

/* ---------------- uiIncidents (10) — unusual incidents (NOT MUIs) ---------------- */

export type UiIncidentCategory =
  | 'Fall - no injury'
  | 'Medication - self admin error'
  | 'Behavior - minor'
  | 'Property damage'
  | 'Missing item'
  | 'Other'

export type UiIncident = {
  id: string
  date: string // ISO
  clientId: string // cl-NN
  clientName: string
  type: 'UI'
  category: UiIncidentCategory
  reportedBy: string // staff name
  location: string // house code
  severity: 'low' | 'moderate'
  status: 'open' | 'under-review' | 'closed'
  summary: string
  linkedMui?: boolean
}

export const UI_CATEGORIES: UiIncidentCategory[] = [
  'Fall - no injury',
  'Medication - self admin error',
  'Behavior - minor',
  'Property damage',
  'Missing item',
  'Other',
]

const UI_SUMMARIES: Record<UiIncidentCategory, string> = {
  'Fall - no injury': 'Client lost balance transferring from wheelchair; assisted to the floor per protocol. No injury observed, vitals normal, physician notified as precaution.',
  'Medication - self admin error': 'Client took evening dose from the self-admin box 40 minutes early. Dose verified against MAR; delegating nurse advised monitoring, no adverse effects.',
  'Behavior - minor': 'Brief verbal outburst during schedule change; de-escalated within 10 minutes using BSP strategies. No property damage or injury.',
  'Property damage': 'Bedroom window blind pulled down during independent time. Maintenance ticket filed; client unharmed.',
  'Missing item': 'Client reports a missing hoodie after day-program transport. Program contacted; log entry opened pending recovery.',
  Other: 'Unusual odor reported from kitchen appliance; unplugged and tagged out. Fire dept not required; maintenance reviewing.',
}

// [daysAgo, clientIdx, categoryIdx, severityIdx, statusIdx, reporterIdx]
const UI_ROWS: Array<[number, number, number, number, number, number]> = [
  [0, 2, 0, 1, 0, 3],
  [1, 5, 2, 0, 0, 7],
  [2, 0, 1, 1, 1, 1],
  [4, 8, 3, 0, 1, 5],
  [6, 1, 4, 0, 0, 9],
  [9, 6, 2, 1, 2, 2],
  [12, 9, 0, 0, 2, 6],
  [16, 3, 5, 0, 2, 10],
  [21, 7, 1, 1, 2, 4],
  [27, 10, 3, 0, 2, 8],
]

export const uiIncidents: UiIncident[] = withTenant(UI_ROWS.map(([dAgo, cIdx, catIdx, sevIdx, stIdx, repIdx], i) => {
  const client = careClients[cIdx % careClients.length]
  const category = UI_CATEGORIES[catIdx % UI_CATEGORIES.length]
  return {
    id: `ui-${pad(i + 1)}`,
    date: subDays(now, dAgo).toISOString(),
    clientId: client.id,
    clientName: client.name,
    type: 'UI',
    category,
    reportedBy: STAFF[repIdx % STAFF.length].name,
    location: HOUSE_CODES[(i * 5 + 2) % HOUSE_CODES.length],
    severity: (['low', 'moderate'] as const)[sevIdx % 2],
    status: (['open', 'under-review', 'closed'] as const)[stIdx % 3],
    summary: UI_SUMMARIES[category],
    linkedMui: false,
  }
}))

/* ---------------- self-registration (seed-extra.ts is off-limits this wave) ---------------- */

// Append these datasets to the shared registrar so the API mock driver serves them.
if (!extraSeeds.callOffs) extraSeeds.callOffs = callOffs
if (!extraSeeds.drAppointments) extraSeeds.drAppointments = drAppointments
if (!extraSeeds.uiIncidents) extraSeeds.uiIncidents = uiIncidents
