// Expansion seed (apps-expansion wave) — fictional home-healthcare data for a developmental-disabilities lifecare…
// Registered in src/lib/seed-extra.ts.
import { addDays, subDays } from 'date-fns'
import type { Doc, DocBlock, TintName } from '@/engine/types'
import { withTenant } from '@/lib/tenancy'
// sweep: expansion datasets now reference the SAME people + clients as the core care datasets, so Person Focus Mode…
import { people } from '@/lib/seed'
import { clients as careClients } from '@/lib/seed-care'
import { animalPhoto } from '@/lib/animals'

const iso = (d: Date) => d.toISOString()
const day = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')

/* ---------------- shared vocab ---------------- */

export const HOUSES = ['Maple House', 'Cedar House', 'Birch House', 'Willow House']

// Staff names come from the core directory (p-01…p-12) so a staff focus narrows shifts/visits/MAR; client initials…
const STAFF = people.slice(0, 12).map((p) => p.name)
const CLIENT_NAMES = [
  'James Morris', 'Lena Brooks', 'David Park', 'Ruby Santos', 'Ethan Cole',
  'Grace Weber', 'Leo Marsh', 'Isla Ferrara', 'Nathan Holt', 'Zoe Keller',
  'Adam Vega', 'Tara Berg',
]
const CLIENTS = careClients.map((c) => c.initials)

/* ---------------- leads (14) — CRM referral pipeline ---------------- */

export type LeadStage = 'new' | 'contacted' | 'assessment' | 'intake' | 'converted' | 'lost'

export type Lead = {
  id: string
  name: string // family / guardian contact
  company: string // referring organization
  stage: LeadStage
  value: number // est. monthly revenue $
  source: string
  owner: string
  lastContact: string // ISO
  daysInStage: number
}

const LEAD_STAGES: LeadStage[] = [
  'new', 'new', 'new',
  'contacted', 'contacted', 'contacted',
  'assessment', 'assessment', 'assessment',
  'intake', 'intake',
  'converted', 'converted',
  'lost',
]
const LEAD_SOURCES = ['County SSA', 'Hospital discharge', 'Family referral', 'Physician', 'Website']
const LEAD_ORGS = [
  'Franklin County Board of DD', 'Cuyahoga DD Services', 'OhioHealth Care Coordination',
  'Nationwide Children’s Hospital', 'Hamilton County DD Board', 'Private family',
]

export const leads: Lead[]  = withTenant(LEAD_STAGES.map((stage, i) => ({
  id: `lead-${pad(i + 1)}`,
  name: CLIENT_NAMES[(i * 5 + 1) % CLIENT_NAMES.length],
  company: LEAD_ORGS[i % LEAD_ORGS.length],
  stage,
  value: 3200 + ((i * 830) % 3600),
  source: LEAD_SOURCES[i % LEAD_SOURCES.length],
  owner: STAFF[i % STAFF.length],
  lastContact: iso(subDays(now, (i * 3 + 1) % 21)),
  daysInStage: (i * 4 + 2) % 26,
})))

/* ---------------- diseases (42) — diagnosis registry (sweep expansion) ---------------- */

export type DiseaseCategory =
  | 'Developmental' | 'Neurological' | 'Cardiac' | 'Respiratory'
  | 'Metabolic' | 'Psychiatric' | 'Physical' | 'Sensory' | 'Risk'

export type Disease = {
  id: string
  name: string
  category: DiseaseCategory
  icdCode: string // fictional-realistic ICD-10 format
  clientsAffected: number // prevalence count across the client census
  severity: 'mild' | 'moderate' | 'high' // modal severity
  severityDist: { mild: number; moderate: number; high: number } // sums to clientsAffected
  careFlags: string[] // short care instructions
  clientIds: string[] // client linkage (cl-NN) — focus mode filters on this
  notes: string
}

// [name, ICD-10, category, care flags]
const DISEASE_ROWS: Array<[string, string, DiseaseCategory, string[]]> = [
  ['Autism spectrum disorder', 'F84.0', 'Developmental', ['Visual schedules', 'Sensory-friendly spaces', 'Predictable routines']],
  ['Down syndrome', 'Q90.9', 'Developmental', ['Annual thyroid labs', 'Speech therapy support', 'Cardiac screening current']],
  ['Cerebral palsy', 'G80.9', 'Developmental', ['PT positioning schedule', 'Adaptive equipment check', 'Fall precautions']],
  ['ADHD', 'F90.9', 'Developmental', ['Medication timing log', 'Movement breaks', 'Task chunking']],
  ['Spina bifida', 'Q05.9', 'Developmental', ['Skin integrity checks', 'Catheter care protocol', 'Mobility aid maintenance']],
  ['Prader-Willi syndrome', 'Q87.11', 'Developmental', ['Food security lock plan', 'Calorie-controlled menu', 'Behavior plan active']],
  ['Fragile X syndrome', 'Q99.2', 'Developmental', ['Low-arousal environment', 'Speech therapy support', 'Transition warnings']],
  ['Angelman syndrome', 'Q93.51', 'Developmental', ['Seizure watch', 'Communication device', 'Sleep monitoring']],
  ['Tuberous sclerosis', 'Q85.1', 'Developmental', ['Seizure protocol on file', 'Annual renal imaging', 'Skin lesion monitoring']],
  ['Epilepsy', 'G40.909', 'Neurological', ['Seizure protocol on file', 'Rescue med location posted', 'Seizure log current']],
  ['Dementia / Alzheimer’s', 'G30.9', 'Neurological', ['Wander-guard checks', 'Redirection techniques', 'Consistent caregiver rotation']],
  ['Parkinson’s disease', 'G20', 'Neurological', ['Med timing critical', 'Fall precautions', 'Swallow evaluation current']],
  ['Multiple sclerosis', 'G35', 'Neurological', ['Fatigue management', 'Heat sensitivity plan', 'Mobility aid review']],
  ['Muscular dystrophy', 'G71.0', 'Neurological', ['Respiratory function checks', 'Transfer technique trained', 'Equipment weight limits']],
  ['Congestive heart failure', 'I50.9', 'Cardiac', ['Daily weights', 'Fluid restriction', 'Sodium-controlled menu']],
  ['Hypertension', 'I10', 'Cardiac', ['BP log twice weekly', 'Low-sodium diet', 'Med compliance check']],
  ['COPD', 'J44.9', 'Respiratory', ['O2 saturation checks', 'Inhaler technique review', 'No smoking zone']],
  ['Asthma', 'J45.909', 'Respiratory', ['Rescue inhaler on person', 'Trigger avoidance plan', 'Peak flow log']],
  ['Sleep apnea', 'G47.30', 'Respiratory', ['CPAP nightly compliance', 'Filter changes monthly', 'Sleep log review']],
  ['Type 2 diabetes', 'E11.9', 'Metabolic', ['Glucose checks per MAR', 'Carb-counted menu', 'Foot checks weekly']],
  ['GERD', 'K21.9', 'Metabolic', ['Elevate head of bed', 'No late-evening meals', 'Med before breakfast']],
  ['Obesity', 'E66.9', 'Metabolic', ['Portion-controlled menu', 'Activity plan', 'Adaptive seating check']],
  ['Chronic kidney disease', 'N18.9', 'Metabolic', ['Fluid restriction', 'Renal diet', 'Lab schedule current']],
  ['Anxiety disorder', 'F41.9', 'Psychiatric', ['Calming corner access', 'PRN protocol on file', 'Advance notice of changes']],
  ['Major depression', 'F32.9', 'Psychiatric', ['Mood check-ins daily', 'Activity engagement plan', 'Safety assessment current']],
  ['Bipolar disorder', 'F31.9', 'Psychiatric', ['Sleep pattern log', 'Med compliance watch', 'Mania early signs posted']],
  ['Schizophrenia', 'F20.9', 'Psychiatric', ['Med compliance critical', 'Low-stimulation space', 'Crisis plan on file']],
  ['PTSD', 'F43.10', 'Psychiatric', ['Trauma-informed approach', 'No sudden loud voices', 'Safe-person list posted']],
  ['Oppositional defiant disorder', 'F91.3', 'Psychiatric', ['Consistent boundaries', 'Choice-based redirection', 'Behavior plan active']],
  ['Dysphagia', 'R13.10', 'Physical', ['Texture-modified diet', 'Upright 30 min after meals', 'SLT protocol on file']],
  ['Chronic hepatitis (care)', 'B18.1', 'Physical', ['Standard precautions', 'Lab schedule current', 'Nutrition support']],
  ['HIV care', 'B20', 'Physical', ['Standard precautions', 'Med adherence support', 'Confidentiality — restricted chart']],
  ['Mobility impairment', 'R26.9', 'Physical', ['Transfer plan posted', 'Wheelchair maintenance log', 'Fall precautions']],
  ['Chronic pain', 'G89.29', 'Physical', ['Pain scale check-ins', 'Positioning schedule', 'PRN protocol on file']],
  ['Hearing impairment', 'H91.90', 'Sensory', ['Visual alerts in house', 'ASL/basic signs used', 'Hearing aid battery checks']],
  ['Visual impairment', 'H54.7', 'Sensory', ['Verbal orientation cues', 'Clutter-free walkways', 'Large-print materials']],
  ['Nonverbal communication', 'F80.2', 'Sensory', ['AAC device charged', 'Picture cards current', 'Extra response time']],
  ['Aspiration risk', 'J69.0', 'Risk', ['Supervised meals', 'Chin-tuck technique', 'Crushed meds per order']],
  ['Fall risk', 'Z91.81', 'Risk', ['Hip protectors ordered', 'Night lighting on', 'Gait belt for transfers']],
  ['Wound care', 'L97.429', 'Risk', ['Dressing changes per order', 'Reposition every 2 hours', 'Wound photos weekly']],
  ['Ostomy care', 'Z93.3', 'Risk', ['Appliance change schedule', 'Skin barrier checks', 'Supplies stocked']],
  ['Tube feeding', 'Z43.1', 'Risk', ['Feeding pump log', 'Flush before/after meds', 'Site inspection daily']],
]

const DISEASE_NOTES = [
  'Seizure protocol on file', 'Annual specialist review due', 'Dietary plan linked',
  'Behavior plan active', 'OT/PT consult quarterly', 'Medication review pending',
]

export const diseases: Disease[]  = withTenant(DISEASE_ROWS.map(([name, icdCode, category, careFlags], i) => {
  const clientsAffected = 1 + ((i * 7) % 9)
  const high = clientsAffected >= 6 ? 2 : clientsAffected >= 3 ? 1 : 0
  const moderate = Math.floor((clientsAffected - high) / 2)
  const mild = clientsAffected - high - moderate
  return {
    id: `dis-${pad(i + 1)}`,
    name,
    category,
    icdCode,
    clientsAffected,
    severity: (['mild', 'moderate', 'high'] as const)[i % 3],
    severityDist: { mild, moderate, high },
    careFlags,
    clientIds: Array.from({ length: clientsAffected }, (_, k) => careClients[(i * 3 + k) % careClients.length].id),
    notes: DISEASE_NOTES[i % DISEASE_NOTES.length],
  }
}))

/* ---------------- incidents (12) ---------------- */

/** MUI escalation payload (Ohio DODD Major Unusual Incident report). */
export type IncidentEscalation = {
  classification: string // e.g. "MUI — Serious injury"
  immediateActions: string
  notifications: { label: string; name?: string }[]
  reportedBy: string
  reportedAt: string // ISO
  reportDueAt: string // ISO — written report due (default +24h)
}

export type Incident = {
  id: string
  type: 'Fall' | 'Medication error' | 'Behavior' | 'Injury' | 'MUI'
  client: string // initials
  house: string
  date: string // ISO
  severity: 'low' | 'moderate' | 'high'
  status: 'open' | 'in-review' | 'closed'
  reportedBy: string
  /** MUI tracking — set when an incident is being watched or escalated. */
  muiStatus?: 'monitoring' | 'escalated'
  escalation?: IncidentEscalation
}

const INC_TYPES: Incident['type'][] = ['Fall', 'Medication error', 'Behavior', 'Injury', 'MUI', 'Fall', 'Behavior', 'Medication error', 'Fall', 'Injury', 'Behavior', 'MUI']

export const incidents: Incident[]  = withTenant(INC_TYPES.map((type, i) => ({
  id: `inc-${pad(i + 1)}`,
  type,
  client: CLIENTS[(i * 5 + 4) % CLIENTS.length], // sweep: spread across the whole census
  house: HOUSES[i % HOUSES.length],
  date: iso(subDays(now, (i * 5 + 1) % 40)),
  severity: (['low', 'moderate', 'high'] as const)[(i * 2 + 1) % 3],
  status: (['open', 'in-review', 'closed'] as const)[i % 3],
  reportedBy: STAFF[(i * 5 + 3) % STAFF.length],
})))

// MUI wave (ops-flows): two incidents already escalated with full payloads, two more under monitoring so the sheet…
const MUI_ESCALATED: Array<[number, string, number]> = [
  // [index into incidents, classification, days ago escalated]
  [4, 'MUI — Serious injury', 2],
  [11, 'MUI — Medication error w/ harm', 6],
]
for (const [idx, classification, daysAgo] of MUI_ESCALATED) {
  const inc = incidents[idx]
  const at = subDays(now, daysAgo)
  inc.muiStatus = 'escalated'
  inc.status = idx === 4 ? 'open' : 'in-review'
  inc.severity = 'high'
  inc.escalation = {
    classification,
    immediateActions:
      'Client assessed by on-shift nurse and transported for medical evaluation. House manager and on-call supervisor notified immediately; staffing coverage backfilled for the remainder of the shift.',
    notifications: [
      { label: 'County DD board SSA', name: 'Karen Doyle' },
      { label: 'Guardian', name: 'Guardian on file' },
      { label: 'House manager' },
      { label: 'On-call supervisor' },
      { label: 'DODD hotline', name: 'Ohio DODD MUI hotline' },
    ],
    reportedBy: inc.reportedBy,
    reportedAt: iso(at),
    reportDueAt: iso(addDays(at, 1)),
  }
}
incidents[1].muiStatus = 'monitoring'
incidents[6].muiStatus = 'monitoring'

/* ---------------- marEntries (16) — MAR ---------------- */

export type MarEntry = {
  id: string
  medication: string // name + strength
  client: string
  schedule: '8:00 AM' | '12:00 PM' | '8:00 PM'
  administeredBy: string
  status: 'given' | 'refused' | 'held' | 'missed'
  date: string // ISO
}

const MEDS = [
  'Metformin 500mg', 'Levothyroxine 75mcg', 'Risperidone 1mg', 'Depakote 250mg',
  'Lisinopril 10mg', 'Albuterol 90mcg inh', 'Sertraline 50mg', 'Keppra 500mg',
]
const MAR_SCHEDULES: MarEntry['schedule'][] = ['8:00 AM', '12:00 PM', '8:00 PM']
const MAR_STATUSES: MarEntry['status'][] = [
  'given', 'given', 'given', 'given', 'given', 'refused', 'given', 'held',
  'given', 'given', 'given', 'missed', 'given', 'given', 'refused', 'given',
]

export const marEntries: MarEntry[]  = withTenant(MAR_STATUSES.map((status, i) => ({
  id: `mar-${pad(i + 1)}`,
  medication: MEDS[i % MEDS.length],
  client: CLIENTS[(i * 5 + 1) % CLIENTS.length], // sweep: spread across the whole census
  schedule: MAR_SCHEDULES[i % 3],
  administeredBy: STAFF[(i * 2 + 5) % STAFF.length],
  status,
  date: iso(subDays(now, Math.floor(i / 3))),
})))

/* ---------------- shifts (18) ---------------- */

export type Shift = {
  id: string
  staff: string
  house: string
  role: 'DSP' | 'LPN' | 'House Manager'
  date: string // yyyy-mm-dd
  start: string
  end: string
  status: 'scheduled' | 'confirmed' | 'open' | 'covered'
}

const SHIFT_BLOCKS: Array<[string, string]> = [['07:00', '15:00'], ['15:00', '23:00'], ['23:00', '07:00']]
const SHIFT_STATUSES: Shift['status'][] = [
  'confirmed', 'confirmed', 'scheduled', 'open', 'confirmed', 'scheduled',
  'confirmed', 'covered', 'scheduled', 'open', 'confirmed', 'scheduled',
  'confirmed', 'open', 'covered', 'scheduled', 'confirmed', 'open',
]

export const shifts: Shift[]  = withTenant(SHIFT_STATUSES.map((status, i) => {
  const [start, end] = SHIFT_BLOCKS[i % 3]
  return {
    id: `sh-${pad(i + 1)}`,
    staff: status === 'open' ? 'Unassigned' : STAFF[i % STAFF.length],
    house: HOUSES[(i * 3 + 1) % HOUSES.length],
    role: (['DSP', 'DSP', 'LPN', 'House Manager'] as const)[i % 4],
    date: day(addDays(now, (i * 2) % 10)),
    start,
    end,
    status,
  }
}))

// ---------------- visits (24) — EVV ---------------- sweep: 24 rows so every care client has ≥1 visit (client…

export type Visit = {
  id: string
  staff: string
  client: string
  service: 'PC' | 'HPC' | 'Respite'
  clockIn: string // ISO
  clockOut: string // ISO
  verified: boolean
}

export const visits: Visit[]  = withTenant(Array.from({ length: 24 }, (_, i) => {
  const inAt = subDays(now, i % 6)
  inAt.setHours(8 + (i % 3), (i * 17) % 60, 0, 0)
  const outAt = new Date(inAt.getTime() + (3 + (i % 4)) * 3600_000)
  return {
    id: `evv-${pad(i + 1)}`,
    staff: STAFF[(i * 5 + 2) % STAFF.length],
    client: CLIENTS[(i * 2 + 3) % CLIENTS.length],
    service: (['PC', 'HPC', 'Respite'] as const)[i % 3],
    clockIn: iso(inAt),
    clockOut: iso(outAt),
    verified: i % 4 !== 3,
  }
}))

/* ---------------- audits (10) ---------------- */

export type Audit = {
  id: string
  title: string
  area: 'Medication' | 'Finance' | 'House safety' | 'Documentation'
  auditor: string
  date: string // ISO
  score: number // 0..100
  findings: number
  status: 'passed' | 'follow-up' | 'scheduled'
}

const AUDIT_TITLES = [
  'Quarterly med-room review', 'Petty cash reconciliation', 'Fire drill & egress check',
  'ISP documentation audit', 'MAR accuracy sampling', 'Billing trail spot check',
  'Kitchen safety walkthrough', 'EVV compliance review', 'Care plan timeliness', 'Vehicle log audit',
]
const AUDIT_AREAS: Audit['area'][] = ['Medication', 'Finance', 'House safety', 'Documentation']

export const audits: Audit[]  = withTenant(AUDIT_TITLES.map((title, i) => ({
  id: `aud-${pad(i + 1)}`,
  title,
  area: AUDIT_AREAS[i % 4],
  auditor: STAFF[(i * 7 + 4) % STAFF.length],
  date: iso(subDays(now, (i * 9 + 2) % 60)),
  score: 78 + ((i * 11) % 23),
  findings: (i * 3) % 8,
  status: (['passed', 'follow-up', 'scheduled'] as const)[i % 3],
})))

/* ---------------- workOrders (10) ---------------- */

export type WorkOrder = {
  id: string
  house: string
  issue: string
  priority: 'low' | 'medium' | 'high'
  status: 'reported' | 'scheduled' | 'in-progress' | 'done'
  vendor?: string
  daysInStage: number
}

const WO_ISSUES = [
  'Kitchen faucet leak', 'Bedroom window latch broken', 'HVAC filter replacement',
  'Ramp handrail loose', 'Bathroom grab bar install', 'Washer not draining',
  'Exterior light out', 'Furnace noise', 'Door closer adjustment', 'Gutter cleaning',
]
const WO_STATUSES: WorkOrder['status'][] = ['reported', 'reported', 'reported', 'scheduled', 'scheduled', 'in-progress', 'in-progress', 'done', 'done', 'done']
const WO_VENDORS = ['Buckeye Property Services', 'Central Ohio HVAC', 'HandyPro Maintenance']

export const workOrders: WorkOrder[]  = withTenant(WO_ISSUES.map((issue, i) => ({
  id: `wo-${pad(i + 1)}`,
  house: HOUSES[i % HOUSES.length],
  issue,
  priority: (['low', 'medium', 'high'] as const)[(i * 2 + 1) % 3],
  status: WO_STATUSES[i],
  vendor: WO_STATUSES[i] === 'reported' ? undefined : WO_VENDORS[i % WO_VENDORS.length],
  daysInStage: (i * 3 + 1) % 18,
})))

/* ---------------- billingClaims (12) — Billing & Payers ---------------- */

export type BillingClaim = {
  id: string
  client: string
  payer: 'Medicaid Waiver' | 'Private' | 'County'
  spanStart: string // yyyy-mm-dd
  spanEnd: string
  units: number
  amount: number // $
  status: 'submitted' | 'paid' | 'denied'
}

export const billingClaims: BillingClaim[]  = withTenant(Array.from({ length: 12 }, (_, i) => {
  const start = subDays(now, 30 + ((i * 13) % 60))
  return {
    id: `bill-${pad(i + 1)}`,
    client: CLIENTS[(i * 5 + 4) % CLIENTS.length],
    payer: (['Medicaid Waiver', 'Medicaid Waiver', 'Private', 'County'] as const)[i % 4],
    spanStart: day(start),
    spanEnd: day(addDays(start, 14)),
    units: 40 + ((i * 17) % 120),
    amount: 1800 + ((i * 940) % 5200),
    status: (['paid', 'paid', 'submitted', 'denied'] as const)[i % 4],
  }
}))

/* ---------------- routes (8) — Transportation ---------------- */

export type TransportRoute = {
  id: string
  route: string
  driver: string
  vehicle: string
  clients: number
  pickupTime: string
  date: string // yyyy-mm-dd
  origin: string
  destination: string
  stops: string[]
  status: 'on-time' | 'delayed' | 'completed'
}

const ROUTE_NAMES = ['North AM run', 'South AM run', 'Day-program shuttle', 'East PM run', 'West PM run', 'Medical appts', 'Weekend outings', 'Work program run']
const VEHICLES = ['Van 1 · Ford Transit', 'Van 2 · Dodge Caravan', 'Van 3 · Toyota Sienna', 'Bus 1 · Blue Bird']
// Fictional Canton, OH area endpoints (Google Maps deep links + embed preview).
const ROUTE_ENDPOINTS: Array<[string, string, string[]]> = [
  ['412 Market Ave N, Canton, OH 44702', 'Stark County Board of DD, 2950 Whipple Ave NW, Canton, OH 44708', ['1801 Schneider St NE, Canton, OH 44721']],
  ['2210 34th St NW, Canton, OH 44709', 'Belden Village Mall, 4230 Belden Village St NW, Canton, OH 44718', []],
  ['908 Arlington Ave NW, Canton, OH 44708', 'Opportunities for Ohioans with Disabilities, 4300 Easton Way, Canton, OH 44720', ['1225 Market Ave S, Canton, OH 44707']],
  ['132 Briarwood Ln NE, Canton, OH 44714', 'Pro Football Hall of Fame, 2121 George Halas Dr NW, Canton, OH 44708', ['Canton Museum of Art, 1001 Market Ave N, Canton, OH 44702']],
  ['7740 Kenwood Rd, North Canton, OH 44720', 'Gervasi Vineyard, 1700 55th St NE, Canton, OH 44721', []],
  ['1122 Forest Park Blvd, Canton, OH 44709', 'Aultman Hospital, 2600 6th St SW, Canton, OH 44710', ['Mercy Medical Center, 1320 Mercy Dr NW, Canton, OH 44708']],
  ['4708 Meadowlane Dr NW, Canton, OH 44718', 'McKinley National Memorial, 800 McKinley Monument Dr NW, Canton, OH 44708', ['Sippo Lake Park, 5300 Tyro St NE, Canton, OH 44721', 'Exploration Gateway, 5712 12th St NW, Canton, OH 44708']],
  ['231 2nd St NE, Canton, OH 44702', 'YMCA of Central Stark County, 231 2nd St NE, Canton, OH 44702', ['Cultural Center for the Arts, 1001 Market Ave N, Canton, OH 44702']],
]

export const routes: TransportRoute[]  = withTenant(ROUTE_NAMES.map((route, i) => ({
  id: `rte-${pad(i + 1)}`,
  route,
  driver: STAFF[(i * 3 + 1) % STAFF.length],
  vehicle: VEHICLES[i % VEHICLES.length],
  clients: 2 + ((i * 5) % 7),
  pickupTime: `${pad(7 + (i % 3))}:${i % 2 ? '30' : '00'}`,
  date: day(addDays(now, i % 3)),
  origin: ROUTE_ENDPOINTS[i][0],
  destination: ROUTE_ENDPOINTS[i][1],
  stops: ROUTE_ENDPOINTS[i][2],
  status: (['on-time', 'completed', 'delayed'] as const)[i % 3],
})))

/* ---------------- mealPlans (8) — Meals & Nutrition ---------------- */

export type MealPlan = {
  id: string
  house: string
  plan: 'Regular' | 'Diabetic' | 'Pureed' | 'Texture-modified'
  allergies: string
  updatedBy: string
  updatedAt: string // ISO
}

const MEAL_ALLERGIES = ['None noted', 'Peanuts (severe)', 'Lactose intolerance', 'Gluten sensitivity', 'Shellfish (severe)', 'None noted', 'Eggs', 'Tree nuts']

export const mealPlans: MealPlan[]  = withTenant(Array.from({ length: 8 }, (_, i) => ({
  id: `meal-${pad(i + 1)}`,
  house: HOUSES[i % HOUSES.length],
  plan: (['Regular', 'Diabetic', 'Pureed', 'Texture-modified'] as const)[i % 4],
  allergies: MEAL_ALLERGIES[i],
  updatedBy: STAFF[(i * 2 + 6) % STAFF.length],
  updatedAt: iso(subDays(now, (i * 6 + 3) % 30)),
})))

/* ---------------- policyAcks (14) — Policy Acknowledgments ---------------- */

export type PolicyAck = {
  id: string
  policy: string
  version: string
  staff: string
  signedAt: string | null // ISO
  status: 'signed' | 'pending' | 'overdue'
  effectiveDate: string // ISO
  // Full policy text, one section per entry.
  body?: string[]
  // Imported PDF (demo: points at a public sample PDF).
  pdfUrl?: string
  pdfName?: string
}

const POLICIES = [
  'Code of Conduct',
  'HIPAA Privacy Practices',
  'Medication Administration Policy',
  'Incident Reporting & MUI Procedure',
  'Cell Phone & Social Media Policy',
  'Emergency Preparedness Plan',
]

/** Realistic policy copy (demo). Section convention: "## Heading" lines. */
const POLICY_BODIES: Record<string, string[]> = {
  'Code of Conduct': [
    '## 1. Purpose',
    'This Code of Conduct defines the professional and ethical standards expected of every ASA Lifecare employee, contractor and volunteer serving individuals with developmental disabilities. It exists to protect the dignity, health, safety and civil rights of the people we support, and to preserve the trust placed in us by families, guardians and county boards.',
    '## 2. Respect & Dignity',
    'Every individual shall be treated with respect at all times. Staff will use person-first language, honor personal preferences and cultural backgrounds, and never engage in teasing, ridicule, profanity or any form of degrading treatment — in person, in writing or online.',
    '## 3. Professional Boundaries',
    'Staff maintain professional relationships with individuals and families. Romantic or sexual contact with any person served is strictly prohibited and constitutes abuse under Ohio Administrative Code 5123-17-02. Gifts, loans and personal financial arrangements with individuals or their families require written approval from a supervisor.',
    '## 4. Attendance & Reliability',
    'The people we support depend on consistent staffing. Staff are expected to arrive on time, remain for the full shift, and follow the call-off procedure no later than two hours before shift start. Patterns of absence or tardiness are grounds for progressive discipline.',
    '## 5. Substance-Free Workplace',
    'Working under the influence of alcohol, marijuana or non-prescribed controlled substances is prohibited. Prescription medications that impair the ability to provide safe care must be reported to the house manager before the shift begins.',
    '## 6. Confidentiality',
    'All personal, medical and financial information about individuals served is confidential. Details may be shared only with authorized team members on a need-to-know basis, in accordance with the HIPAA Privacy Practices policy.',
    '## 7. Reporting Obligations',
    'Every employee is a mandated reporter. Suspected abuse, neglect, misappropriation or exploitation must be reported immediately to the house manager and the county board SSA, in accordance with the Incident Reporting & MUI Procedure. Failure to report is itself a violation of this Code.',
    '## 8. Acknowledgment',
    'By signing below, I confirm that I have read and understood this Code of Conduct, that I have had the opportunity to ask questions, and that I agree to uphold these standards at all times. I understand that violations may result in disciplinary action up to and including termination and registry referral.',
  ],
  'HIPAA Privacy Practices': [
    '## 1. Purpose & Scope',
    'This policy describes how ASA Lifecare collects, uses, discloses and safeguards Protected Health Information (PHI) for the individuals we serve, in compliance with the HIPAA Privacy Rule (45 CFR Parts 160 and 164) and Ohio DODD confidentiality requirements.',
    '## 2. Minimum Necessary Standard',
    'Staff may access, use or disclose only the minimum PHI necessary to perform their assigned duties. Access to electronic records is role-based and audited quarterly. Curiosity-driven access to any record — including those of family members or public figures — is prohibited.',
    '## 3. Permitted Uses & Disclosures',
    'PHI may be used without written authorization for treatment, payment and healthcare operations, including coordination with county board SSAs, waiver service documentation and billing. All other disclosures require a signed authorization from the individual or their legal guardian.',
    '## 4. Verbal & Incidental Disclosures',
    'Conversations about individuals must never occur in public areas, in vehicles with non-staff present, or within earshot of visitors. Phone calls involving PHI must be made from private areas. Whiteboards and printed MARs must not be visible to unauthorized persons.',
    '## 5. Electronic Safeguards',
    'PHI must never be sent through personal email, text messages or consumer messaging apps. Company devices must be locked when unattended, and documents containing PHI must be stored only in approved systems. Lost or stolen devices must be reported to the privacy officer within one hour of discovery.',
    '## 6. Individual Rights',
    'Individuals and guardians have the right to inspect and receive copies of their records, request amendments, receive an accounting of disclosures, and request confidential communications. Requests are coordinated through the Quality department within 30 days.',
    '## 7. Breach Reporting',
    'Any suspected impermissible use, disclosure or loss of PHI must be reported to the privacy officer immediately, and no later than the end of the shift. The privacy officer coordinates risk assessment, individual notification and, where required, reporting to HHS within 60 days.',
    '## 8. Acknowledgment',
    'I acknowledge that I have received, read and understand these HIPAA Privacy Practices. I understand that violations may result in disciplinary action, termination and civil or criminal penalties under federal and state law.',
  ],
  'Medication Administration Policy': [
    '## 1. Purpose',
    'This policy governs the safe administration, documentation and storage of medications in all ASA Lifecare residential settings, in accordance with Ohio Administrative Code 5123-6 and DODD medication administration certification rules.',
    '## 2. Authorization to Administer',
    'Only staff holding a current DODD Medication Administration certification (Category 1) may administer medications. Certification must be verified before independent med pass and renewed annually. Nurse delegation is documented for each task requiring it.',
    '## 3. The Six Rights',
    'Before every administration, staff verify the six rights: right individual, right medication, right dose, right time, right route and right documentation. If any element cannot be verified, the dose is held and the delegating nurse or prescriber is contacted.',
    '## 4. Documentation',
    'Every dose — given, refused, held or missed — is recorded on the Medication Administration Record (MAR) immediately after administration, never in advance. Documentation errors are corrected with a single line, initial and date; correction fluid is prohibited.',
    '## 5. Storage & Security',
    'Medications are stored locked in the designated med room or cabinet, separated by individual and route. Controlled substances are stored double-locked with a shift-count log reconciled at every shift change by two staff signatures.',
    '## 6. Refusals, Holds & Missed Doses',
    'Refusals are documented with the reason when known, and the delegating nurse is notified the same day. Three consecutive refusals, or any missed dose of a critical medication (seizure, cardiac, insulin), triggers immediate nurse notification and a physician call.',
    '## 7. Medication Errors',
    'Any error in the six rights is a medication error. The individual is assessed first, the physician and delegating nurse are notified, and an incident report is filed before end of shift. Errors with harm or potential harm are evaluated for MUI escalation under the Incident Reporting & MUI Procedure.',
    '## 8. Acknowledgment',
    'I certify that I have read and understand this policy, that I will administer medications only within my certification and delegation, and that I will report errors and concerns immediately. I understand that falsifying MAR documentation is grounds for termination and certification revocation.',
  ],
  'Incident Reporting & MUI Procedure': [
    '## 1. Purpose',
    'This procedure ensures that all incidents affecting the health, safety and welfare of individuals are reported, investigated and resolved in compliance with Ohio Administrative Code 5123-17-02 (Major Unusual Incidents) and county board requirements.',
    '## 2. Definitions',
    'A Major Unusual Incident (MUI) is an alleged, suspected or actual occurrence that adversely affects health, safety or welfare — including abuse, neglect, misappropriation, exploitation, serious injury, medication error with harm, missing person, unscheduled hospitalization and death. An Unusual Incident (UI) is a lower-severity event that does not meet MUI criteria but still requires review.',
    '## 3. Immediate Actions',
    'Staff first ensure the immediate health and safety of the individual: provide first aid, call 911 when indicated, and remove any ongoing risk. Preserving evidence and the scene takes priority over cleaning up or returning to routine.',
    '## 4. Verbal Reporting Timeline',
    'Suspected MUIs are reported verbally to the house manager and on-call supervisor immediately, and to the county board SSA no later than four hours after discovery. Abuse, neglect and misappropriation allegations are also reported to law enforcement when required, and the DODD hotline may be contacted at 1-866-313-6733.',
    '## 5. Written Report',
    'A written incident report is completed before the end of the shift, and the formal MUI written report is submitted to the county board within 24 hours of discovery. Reports state facts only — who, what, when, where — without speculation or blame.',
    '## 6. Guardian Notification',
    'The guardian is notified the same day of any MUI involving their family member, unless the guardian is the subject of the allegation, in which case the county board directs notification. All contacts are documented in the review trail.',
    '## 7. Prevention Plans & Review',
    'Every MUI generates a written prevention plan identifying immediate and systemic causes. The Quality department tracks trends, and all MUIs remain open in the incident log until the county board accepts the closure summary.',
    '## 8. Non-Retaliation',
    'No employee, individual or family member will face retaliation for reporting a concern in good faith. Staff who fail to report, or who interfere with an investigation, are subject to discipline up to termination and registry referral.',
    '## 9. Acknowledgment',
    'I acknowledge that I am a mandated reporter, that I understand the four-hour verbal and 24-hour written reporting timelines, and that I will follow this procedure for every incident I witness, discover or reasonably suspect.',
  ],
  'Cell Phone & Social Media Policy': [
    '## 1. Purpose',
    'This policy protects the privacy and dignity of individuals served by setting clear rules for personal cell phone use and social media activity during work time, while respecting staff rights to personal communication outside of work.',
    '## 2. Personal Devices on Shift',
    'Personal cell phones are kept in lockers or designated storage during direct-care time. Phones may be used only during scheduled breaks, away from individuals. House phones and agency radios are the approved on-shift communication channels.',
    '## 3. Photography & Recording',
    'Photographing, videoing or audio-recording any individual served — for any reason — is prohibited on personal devices. Agency-approved photos for documentation or celebrations are taken only on agency devices with a current signed photo release on file.',
    '## 4. Social Media Conduct',
    'Staff may never post, share or comment about individuals served, their families or house events — even without names, even in private groups, even after employment ends. "Friend" or follow relationships with individuals or their family members are prohibited.',
    '## 5. Representing the Agency',
    'Only authorized spokespersons may speak for ASA Lifecare online. Personal posts that identify the agency must make clear that views are the employee\u2019s own. Harassing, discriminatory or threatening online conduct reflecting on the agency is grounds for discipline.',
    '## 6. Emergencies',
    'In an emergency, staff use house phones or agency devices to contact supervisors and emergency services. Family members reaching staff during a shift are directed through the house phone so documentation stays consistent.',
    '## 7. Acknowledgment',
    'I acknowledge that I have read and understand this policy. I understand that violations — including any disclosure of an individual\u2019s identity or image — may result in immediate termination and, where applicable, referral to law enforcement or the DODD abuser registry.',
  ],
  'Emergency Preparedness Plan': [
    '## 1. Purpose',
    'This plan establishes house-level procedures for fire, severe weather, utility outage and medical emergencies, ensuring every individual can be evacuated or sheltered safely with their medications and essential records.',
    '## 2. Fire',
    'On alarm, staff evacuate individuals to the posted meeting point using the nearest safe exit, conduct a headcount, and call 911. No one re-enters the building. Fire drills rotate across all three shifts and are documented quarterly.',
    '## 3. Severe Weather',
    'On a tornado warning, individuals are moved to the designated interior shelter area with the go-bag, weather radio and MARs. Staff remain with individuals until the all-clear and document any injuries or property damage as incidents.',
    '## 4. Utility Outage & Relocation',
    'For outages expected to exceed four hours, or any event making the home unsafe, the on-call supervisor authorizes relocation to the designated alternate site. Medications, MARs, emergency contacts and go-bags travel with the individuals.',
    '## 5. Acknowledgment',
    'I acknowledge that I know the evacuation routes, meeting points and shelter areas for my assigned house, and that I will follow this plan and supervisor direction during any emergency.',
  ],
}

export const policyAcks: PolicyAck[]  = withTenant(Array.from({ length: 12 }, (_, i) => {
  const status = (['signed', 'signed', 'pending', 'overdue'] as const)[i % 4]
  const policy = POLICIES[i % POLICIES.length]
  return {
    id: `ack-${pad(i + 1)}`,
    policy,
    version: `v${2 + (i % 3)}.${i % 5}`,
    staff: STAFF[(i * 5 + 1) % STAFF.length],
    signedAt: status === 'signed' ? iso(subDays(now, (i * 4 + 2) % 45)) : null,
    status,
    effectiveDate: day(subDays(now, 60 + ((i * 11) % 90))),
    body: POLICY_BODIES[policy],
  }
}))

// Demo imports (ops-flows): two PDF-backed policies.
policyAcks.push(
  ...withTenant<PolicyAck>([
  {
    id: 'ack-13',
    policy: 'Vehicle & Transport Safety (PDF)',
    version: 'v1.2',
    staff: STAFF[3],
    signedAt: null,
    status: 'pending',
    effectiveDate: day(subDays(now, 30)),
    pdfUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    pdfName: 'vehicle-transport-safety-v1.2.pdf',
  },
  {
    id: 'ack-14',
    policy: 'Visitor & Community Access (PDF)',
    version: 'v2.0',
    staff: STAFF[8],
    signedAt: null,
    status: 'overdue',
    effectiveDate: day(subDays(now, 45)),
    pdfUrl: 'https://www.africau.edu/images/default/sample.pdf',
    pdfName: 'visitor-community-access-v2.0.pdf',
  },
  ]),
)

/* ---------------- equipment (12) — Equipment & Assets ---------------- */

export type EquipmentStatus = 'borrowed' | 'available' | 'repair'

export type EquipmentItem = {
  id: string
  item: string
  serial: string
  house: string
  condition: 'new' | 'good' | 'fair' | 'repair'
  assignedTo: string
  status: EquipmentStatus // sweep: borrowed (green) / available (blue) / repair (red)
  borrowedBy?: string // sweep: who currently has it (borrowed rows)
}

const EQUIPMENT = ['Wheelchair', 'Hoyer lift', 'Gait belt set', 'Oxygen concentrator', 'Hospital bed', 'Blood pressure monitor', 'Pulse oximeter', 'Feeding pump', 'Transfer board', 'Nebulizer', 'Shower chair', 'Scale (wheelchair)']
// sweep: realistic status mix — 5 borrowed (with named borrowers), 4 available, 3 in repair.
const EQUIPMENT_STATUS: EquipmentStatus[] = [
  'borrowed', 'borrowed', 'borrowed', 'borrowed', 'borrowed',
  'available', 'available', 'available', 'available',
  'repair', 'repair', 'repair',
]

export const equipment: EquipmentItem[]  = withTenant(EQUIPMENT.map((item, i) => {
  const status = EQUIPMENT_STATUS[i % EQUIPMENT_STATUS.length]
  return {
    id: `eq-${pad(i + 1)}`,
    item,
    serial: `ASA-${2020 + (i % 5)}-${1000 + i * 137}`,
    house: HOUSES[(i * 3 + 2) % HOUSES.length],
    condition: (['new', 'good', 'good', 'fair', 'repair'] as const)[i % 5],
    assignedTo: status === 'borrowed' ? HOUSES[(i * 3 + 2) % HOUSES.length] : 'House stock',
    status,
    borrowedBy: status === 'borrowed' ? careClients[(i * 5 + 1) % careClients.length].name : undefined,
  }
}))

// ---------------- onboarding (10) — new-hire onboarding pipeline ---------------- Rich person records: full…

export type OnboardingStage = 'packet' | 'background' | 'documents' | 'training' | 'ready'
export type OnboardingChecklistStatus = 'done' | 'pending' | 'missing' | 'auto'
export type OnboardingChecklistOwner = 'Candidate' | 'HR' | 'Auto'
export type OnboardingChecklistItem = {
  id: string
  label: string
  status: OnboardingChecklistStatus
  owner?: OnboardingChecklistOwner
  stage: OnboardingStage
}
export type OnboardingNote = { time: string; text: string; tint: TintName }
export type OnboardingHire = {
  id: string
  name: string
  role: string // position: DSP / House Manager / Nurse / Coordinator
  house: string
  avatar: string
  stage: OnboardingStage
  email: string
  phone: string
  address: string
  source: string
  manager: string
  appliedAt: string // ISO — application received
  startedAt: string // ISO — onboarding kicked off
  startDate: string // ISO — target first day on the floor
  daysInStage: number
  daysInOnboarding: number
  docsDone: number // checklist items complete (of 12)
  checklist: OnboardingChecklistItem[]
  notes: OnboardingNote[]
}

// The 12 prepared onboarding parameters, grouped by the pipeline stage they belong to.
export const ONBOARDING_PACKET: Array<{ id: string; label: string; owner: OnboardingChecklistOwner; stage: OnboardingStage }> = [
  { id: 'new-hire-packet', label: 'New Hire Packet (offer, I-9, W-4, policies)', owner: 'HR', stage: 'packet' },
  { id: 'questionnaire', label: 'New Hire Questionnaire', owner: 'Candidate', stage: 'packet' },
  { id: 'background-check', label: 'Background Check (BCI/FBI)', owner: 'HR', stage: 'background' },
  { id: 'dropbox-link', label: 'Dropbox folder link', owner: 'Auto', stage: 'documents' },
  { id: 'drivers-license', label: "Driver's License / ID", owner: 'Candidate', stage: 'documents' },
  { id: 'diploma', label: 'HS Diploma / GED', owner: 'Candidate', stage: 'documents' },
  { id: 'ss-card', label: 'SS Card / Birth Certificate', owner: 'Candidate', stage: 'documents' },
  { id: 'dodd-cert', label: '8-Hr DODD Training Certificate', owner: 'Candidate', stage: 'training' },
  { id: 'cpr-cert', label: 'CPR / First Aid Certificate', owner: 'Candidate', stage: 'training' },
  { id: 'med-cert', label: 'Med Delivery Certificate', owner: 'Candidate', stage: 'training' },
  { id: 'training-assign', label: 'Training assigned (DODD orientation)', owner: 'HR', stage: 'training' },
  { id: 'tutorials', label: 'Tutorials — asa. walkthrough', owner: 'Auto', stage: 'training' },
]

const OB_STAGE_ORDER: OnboardingStage[] = ['packet', 'background', 'documents', 'training', 'ready']

// Every hire carries the full 12-item checklist from day one.
function buildObChecklist(stage: OnboardingStage, i: number): OnboardingChecklistItem[] {
  const depth = OB_STAGE_ORDER.indexOf(stage)
  return ONBOARDING_PACKET.map((p, j) => {
    const itemDepth = OB_STAGE_ORDER.indexOf(p.stage)
    let status: OnboardingChecklistStatus
    if (itemDepth < depth) {
      status = p.owner === 'Auto' ? 'auto' : 'done'
    } else if (itemDepth > depth) {
      status = 'pending'
    } else if (p.owner === 'Auto') {
      status = (i + j) % 2 === 0 ? 'auto' : 'pending'
    } else {
      status = (['done', 'pending', 'missing', 'pending'] as const)[(i + j) % 4]
    }
    return { ...p, status }
  })
}

const OB_STAGES: OnboardingStage[] = ['packet', 'packet', 'background', 'background', 'documents', 'documents', 'training', 'training', 'ready', 'ready']
const OB_ROLES = ['DSP', 'DSP', 'Nurse', 'House Manager', 'Coordinator']
const OB_SOURCES = ['Referral', 'Indeed', 'Careers page', 'Job fair', 'Agency']
const OB_NAMES = [
  'Brianna Cole', 'Devon Marsh', 'Kira Patel', 'Andre Boone', 'Selena Ortiz',
  'Miles Webster', 'Talia Nguyen', 'Gwen Hoffman', 'Isaiah Reed', 'Paula Vance',
]
const OB_ADDRESSES = [
  '1420 Whispering Pines Ln, Columbus, OH', '88 Grandview Ave, Columbus, OH',
  '2315 N High St, Columbus, OH', '470 Beechwood Dr, Westerville, OH',
  '96 E Schrock Rd, Worthington, OH',
]

/** Cumulative notes timeline — later-stage hires accumulate more history. */
function buildObNotes(stage: OnboardingStage, source: string): OnboardingNote[] {
  const depth = OB_STAGE_ORDER.indexOf(stage)
  const notes: OnboardingNote[] = [
    { time: '3w ago', text: `Application received via ${source} — forwarded from Hiring`, tint: 'blue' },
    { time: '2w ago', text: 'Offer accepted — new-hire packet sent via Dropbox', tint: 'lavender' },
  ]
  if (depth >= 1) notes.push({ time: '10d ago', text: 'Background check submitted — BCI/FBI results pending', tint: 'peach' })
  if (depth >= 2) notes.push({ time: '1w ago', text: 'Document chase started — Dropbox folder shared with candidate', tint: 'amber' })
  if (depth >= 3) notes.push({ time: '4d ago', text: 'Training assigned — DODD orientation and CPR/First Aid scheduled', tint: 'mint' })
  if (depth >= 4) notes.push({ time: 'Yesterday', text: 'All items verified — ready for first shift assignment', tint: 'green' })
  return notes
}

export const onboarding: OnboardingHire[]  = withTenant(OB_STAGES.map((stage, i) => {
  const name = OB_NAMES[i % OB_NAMES.length]
  const [first, last] = name.split(' ')
  const appliedAgo = 14 + ((i * 5 + 3) % 24)
  const checklist = buildObChecklist(stage, i)
  return {
    id: `ob-${pad(i + 1)}`,
    name,
    role: OB_ROLES[i % OB_ROLES.length],
    house: HOUSES[i % HOUSES.length],
    avatar: animalPhoto(i),
    stage,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@mail.example`,
    phone: `(614) 555-${1000 + i * 37}`,
    address: OB_ADDRESSES[i % OB_ADDRESSES.length],
    source: OB_SOURCES[i % OB_SOURCES.length],
    manager: STAFF[(i * 3 + 1) % STAFF.length],
    appliedAt: iso(subDays(now, appliedAgo)),
    startedAt: iso(subDays(now, appliedAgo - 2)),
    startDate: iso(addDays(now, stage === 'ready' ? -(i % 5) - 1 : 6 + ((i * 3) % 14))),
    daysInStage: (i * 2 + 1) % 14,
    daysInOnboarding: appliedAgo - 2,
    docsDone: checklist.filter((c) => c.status === 'done' || c.status === 'auto').length,
    checklist,
    notes: buildObNotes(stage, OB_SOURCES[i % OB_SOURCES.length]),
  }
}))

/* ---------------- careDocs (9) — ISP / BSP / family library ---------------- */

const careBody = (topic: string, tint: TintName): DocBlock[] => [
  { kind: 'h2', id: 'overview', text: 'Overview' },
  { kind: 'p', text: `${topic} This record is part of the client's active service documentation and is reviewed with the interdisciplinary team at least annually, or whenever needs change.` },
  { kind: 'callout', tint, text: 'All information here is confidential under HIPAA and Ohio DODD rules. Share only with authorized team members.' },
  { kind: 'h2', id: 'goals', text: 'Goals & Supports' },
  { kind: 'p', text: 'Outcomes are written in the client’s own words where possible, with measurable action steps assigned to named staff. Progress notes are entered after each shift.' },
  { kind: 'h3', id: 'review', text: 'Review schedule' },
  { kind: 'p', text: 'The QIDP coordinates a 90-day review cycle. Families and guardians receive a summary after every review and may request changes at any time.' },
]

// sweep: docs carry the linked CLIENT (full name from the care clients dataset) so a client focus narrows the ISP /…
const CARE_DOC_DEFS: Array<[string, string, string, number | null]> = [
  // [title, collection, excerpt, linked client index (null = house-wide)]
  ['ISP — Danny W. (2025)', 'isp', 'Individual Service Plan: community integration and independent-living outcomes.', 0],
  ['ISP — Rosa D. (2025)', 'isp', 'Individual Service Plan: communication goals and day-program schedule.', 1],
  ['ISP — Kenny M. (2025)', 'isp', 'Individual Service Plan: health coordination and mobility supports.', 2],
  ['BSP — Reducing elopement risk', 'bsp', 'Behavior Support Plan with antecedent strategies and crisis steps.', 3],
  ['BSP — Self-injury prevention', 'bsp', 'Positive-support plan reviewed by the behavior specialist.', 4],
  ['BSP — Transition anxiety', 'bsp', 'Sensory-friendly routines for schedule changes.', 5],
  ['Family update — March', 'family', 'Monthly newsletter: house happenings, birthdays and outings.', 0],
  ['Family update — April', 'family', 'Staffing news, garden project and upcoming family day.', 1],
  ['Guardian welcome packet', 'family', 'What to expect in the first 90 days of services.', null],
]

export const careDocs: Doc[]  = withTenant(CARE_DOC_DEFS.map(([title, collection, excerpt, clientIdx], i) => ({
  id: `cdoc-${pad(i + 1)}`,
  title,
  excerpt,
  collection,
  client: clientIdx != null ? careClients[clientIdx % careClients.length].name : undefined,
  cover: `/assets/docs/cover-${pad((i % 8) + 1)}.jpg`,
  authorIds: ['p-03', 'p-05'],
  updatedAt: iso(subDays(now, (i * 4 + 1) % 30)),
  readMinutes: 4 + (i % 5),
  body: careBody(title, (['pink', 'lavender', 'blue'] as const)[Math.floor(i / 3)]),
})))
