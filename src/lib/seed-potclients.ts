// Potential Clients seed (v9 apiconn wave): the referrals & prospects pipeline — people who asked about services…
// This is the mounted example for the platform's API connection: the same rows can be posted to the Apps Script…
import { subDays } from 'date-fns'
import { withTenant } from '@/lib/tenancy'
import { extraSeeds } from '@/lib/seed-extra'

const day = (d: Date) => d.toISOString().slice(0, 10)
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')

/* ---------------- vocabulary ---------------- */

export const POTCLIENT_SERVICES = ['DD residential', 'HPC', 'Respite', 'Homemaker'] as const
export type PotClientService = (typeof POTCLIENT_SERVICES)[number]

export const POTCLIENT_STAGES = ['New', 'Contacted', 'Assessment', 'ISP drafting', 'Converted', 'On hold'] as const
export type PotClientStage = (typeof POTCLIENT_STAGES)[number]

export const POTCLIENT_PRIORITIES = ['high', 'normal', 'low'] as const
export type PotClientPriority = (typeof POTCLIENT_PRIORITIES)[number]

export const POTCLIENT_COUNTIES = [
  'Stark', 'Summit', 'Portage', 'Tuscarawas', 'Carroll',
  'Mahoning', 'Wayne', 'Columbiana', 'Medina', 'Holmes',
] as const

export type PotentialClient = {
  id: string
  name: string
  county: string
  service: PotClientService
  stage: PotClientStage
  priority: PotClientPriority
  /** Estimated monthly service value in USD. */
  estMonthly: number
  source: string
  /** yyyy-mm-dd of the most recent touch. */
  lastContact: string
  notes?: string
}

/* ---------------- rows (10, fictional) ---------------- */

// [name, countyIdx, serviceIdx, stageIdx, priorityIdx, estMonthly, source, daysSinceContact, notes?]
const ROWS: Array<[string, number, number, number, number, number, string, number, string?]> = [
  ['Elena Vargas',     0, 0, 2, 0, 6800, 'County board referral', 2,  'IO waiver approved; SSA to confirm funding start date.'],
  ['Marcus Webb',      1, 1, 1, 1, 4200, 'Family inquiry',        5,  'Sister is guardian — prefers a Canton-area home.'],
  ['Priya Raman',      2, 2, 0, 1, 1800, 'Website form',          0],
  ['Dale Kowalski',    3, 3, 1, 2,  950, 'Word of mouth',         9,  'Needs light housekeeping twice a week.'],
  ['Simone Aldridge',  0, 0, 3, 0, 7400, 'County board referral', 3,  'ISP draft with county SSA; team review Thursday.'],
  ['Theo Lindqvist',   4, 1, 5, 2, 3900, 'Family inquiry',       21,  'Paused — family touring other providers.'],
  ['Wren Okafor',      5, 2, 4, 1, 2100, 'Case manager',         12,  'Started weekend respite last Saturday.'],
  ['Beatriz Fontaine', 6, 3, 0, 1, 1100, 'Website form',          1],
  ['Callum Reyes',     0, 0, 2, 0, 7050, 'Hospital discharge',    4,  'Discharge planner asked for intake within 30 days.'],
  ['Ingrid Halvorsen', 7, 1, 4, 1, 4600, 'County board referral',16,  'Converted to HPC 20 hrs/week; onboarding packet sent.'],
]

export const potentialClients: PotentialClient[] = withTenant(
  ROWS.map(([name, countyIdx, serviceIdx, stageIdx, priorityIdx, estMonthly, source, daysSince, notes], i) => ({
    id: `pc-${pad(i + 1)}`,
    name,
    county: POTCLIENT_COUNTIES[countyIdx % POTCLIENT_COUNTIES.length],
    service: POTCLIENT_SERVICES[serviceIdx % POTCLIENT_SERVICES.length],
    stage: POTCLIENT_STAGES[stageIdx % POTCLIENT_STAGES.length],
    priority: POTCLIENT_PRIORITIES[priorityIdx % POTCLIENT_PRIORITIES.length],
    estMonthly,
    source,
    lastContact: day(subDays(now, daysSince)),
    notes,
  })),
)

/* ---------------- self-registration (mirror seed-ops3) ---------------- */

// Append the dataset to the shared registrar so the API mock driver serves it.
if (!extraSeeds.potentialClients) extraSeeds.potentialClients = potentialClients
