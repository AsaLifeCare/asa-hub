// Directors dataset (context-mode wave) — three fictional executive directors for the dedicated Directors /…
// All fictional.
import type { TintName } from '@/engine/types'
import { withTenant } from '@/lib/tenancy'

export type CareerEntry = { time: string; text: string; tint: TintName }

export type Director = {
  id: string
  name: string
  title: string
  photo: string
  avatar: string // mirrors photo — sheet/card templates read row.avatar

  email: string
  phone: string
  office: string
  status: 'active'
  tenureYears: number
  tenure: string // display label, e.g. "Since 2016 · 9 yrs"
  focusAreas: string[]
  bio: string[] // exactly 3 paragraphs
  bioEntries: CareerEntry[] // bio reshaped for detailPanel timeline sections
  career: CareerEntry[]
  directReports: number
  housesOverseen: number
}

const BIO_LABELS = ['Background', 'Leadership', 'Today']
const BIO_TINTS: TintName[] = ['lavender', 'blue', 'mint']

function mkDirector(d: Omit<Director, 'bioEntries' | 'status' | 'avatar'>): Director {
  return {
    ...d,
    status: 'active',
    avatar: d.photo,
    bioEntries: d.bio.map((text, i) => ({ time: BIO_LABELS[i] ?? `Part ${i + 1}`, text, tint: BIO_TINTS[i % BIO_TINTS.length] })),
  }
}

export const directors: Director[]  = withTenant([
  mkDirector({
    id: 'dir-01',
    name: 'Marisol Vega',
    title: 'Executive Director',
    photo: '/assets/library/animals/penguin.jpg',
    email: 'marisol.vega@asahub.example',
    phone: '+1 (614) 555-0188',
    office: 'Main Office — Columbus, OH',
    tenureYears: 9,
    tenure: 'Since 2016 · 9 yrs',
    focusAreas: ['Organizational strategy', 'DODD waiver compliance', 'Family partnerships', 'Staff retention'],
    bio: [
      'Marisol founded the organization in 2016 after a decade running county DD board programs across central Ohio. She started with a single four-bed home in Meadowlane and a conviction that residential care should feel like family life, not a facility. Under her leadership the agency has grown to six houses serving nearly a hundred clients while keeping its original person-first charter intact.',
      'Her leadership style is deliberately hands-on: she still attends ISP reviews, cooks Sunday dinner at a different house each month, and personally onboards every house manager. Colleagues describe her as the cultural glue of the agency — the person who remembers every client’s birthday and every staff member’s kids’ names.',
      'Today Marisol focuses on sustainable growth: deepening county partnerships, expanding the behavior-support program, and building a leadership bench so the agency’s values outlast any one person. She serves on the state provider association board and mentors new agency founders through the Ohio DD incubator.',
    ],
    career: [
      { time: '2006', text: 'Program coordinator — Franklin County DD Board', tint: 'blue' },
      { time: '2011', text: 'Director of residential services — regional provider (14 homes)', tint: 'lavender' },
      { time: '2016', text: 'Founded the agency — opened Meadowlane house', tint: 'mint' },
      { time: '2021', text: 'Named “Provider of the Year” — Ohio DD Provider Association', tint: 'amber' },
      { time: '2024', text: 'Launched family-partnership charter across all six houses', tint: 'pink' },
    ],
    directReports: 6,
    housesOverseen: 6,
  }),
  mkDirector({
    id: 'dir-02',
    name: 'Andre Whitfield',
    title: 'Director of Operations',
    photo: '/assets/library/animals/horse.jpg',
    email: 'andre.whitfield@asahub.example',
    phone: '+1 (614) 555-0124',
    office: 'Main Office — Columbus, OH',
    tenureYears: 6,
    tenure: 'Since 2019 · 6 yrs',
    focusAreas: ['House operations', 'Staffing & coverage', 'Safety audits', 'Transportation'],
    bio: [
      'Andre joined in 2019 from hospital operations, where he managed overnight staffing for a 300-bed facility. He was drawn to home healthcare by the chance to trade scale for depth — knowing every house, every route and every shift pattern by heart. He rebuilt the coverage board from a whiteboard into the staffing system the agency runs on today.',
      'He is the operational backbone of the agency: houses, vehicles, work orders and the audit calendar all run through his team. His “no surprises” doctrine — every incident reviewed within 24 hours, every audit finding closed within 30 — has kept the agency’s audit pass rate above 90% for four straight years.',
      'Andre is currently leading the EVV rollout and a fleet modernization program, and he coaches the house-manager cohort every other Friday. Outside work he is a volunteer EMT and an unreasonably competitive bowling-league captain.',
    ],
    career: [
      { time: '2010', text: 'Shift supervisor — regional hospital network', tint: 'blue' },
      { time: '2015', text: 'Operations manager, overnight staffing — 300-bed facility', tint: 'lavender' },
      { time: '2019', text: 'Joined the agency as house operations lead', tint: 'mint' },
      { time: '2022', text: 'Promoted to Director of Operations — six-house portfolio', tint: 'amber' },
    ],
    directReports: 9,
    housesOverseen: 6,
  }),
  mkDirector({
    id: 'dir-03',
    name: 'Priya Raman',
    title: 'Director of Clinical Services',
    photo: '/assets/library/animals/parrot.jpg',
    email: 'priya.raman@asahub.example',
    phone: '+1 (614) 555-0171',
    office: 'Main Office — Columbus, OH',
    tenureYears: 4,
    tenure: 'Since 2021 · 4 yrs',
    focusAreas: ['Behavior support', 'Medication administration', 'ISP quality', 'Nurse delegation'],
    bio: [
      'Priya is a board-certified behavior analyst and registered nurse who spent her early career in school-based autism programs. She joined the agency in 2021 to build a clinical practice that treats behavior support as a dignity issue first and a compliance issue second. Every BSP in the library carries her team’s signature plain-language rewrite.',
      'She owns the clinical quality stack: MAR accuracy, med-pass certification, ISP reviews and the MUI review trail. Her quarterly “chart clinics” — open sessions where any staff member can bring a confusing care plan — have become one of the agency’s most loved rituals and measurably cut documentation errors.',
      'Priya’s current priority is proactive care: using incident and MAR trends to adjust support plans before crises happen. She precepts nursing students each semester and writes the family-facing “What to expect” guides in the Family Portal.',
    ],
    career: [
      { time: '2012', text: 'RN, pediatric neurology — children’s hospital', tint: 'blue' },
      { time: '2016', text: 'BCBA — school-based autism programs', tint: 'lavender' },
      { time: '2021', text: 'Joined the agency — built the behavior-support program', tint: 'mint' },
      { time: '2023', text: 'Promoted to Director of Clinical Services', tint: 'amber' },
    ],
    directReports: 5,
    housesOverseen: 6,
  }),
])
