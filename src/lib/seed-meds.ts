// Meds-suite datasets (medications wave): per-person current medications with photo/dose chips (Medications app)…
// All fictional.
import { withTenant } from '@/lib/tenancy'
import { clients } from '@/lib/seed-care'

/* ============================ medications ============================ */

export type Medication = {
  id: string
  clientId: string
  clientName: string
  name: string
  dose: string
  schedule: 'scheduled' | 'prn'
  /** '/med-N.jpg' or null → dashed "+" placeholder card (photo missing) */
  image: string | null
  marsDate: string
  source: 'drive-records'
}

type MedSpec = { name: string; dose: string; prn?: boolean }

const MED_POOL: MedSpec[] = [
  { name: 'Levothyroxine', dose: '88mcg' },
  { name: 'Benztropine', dose: '1mg' },
  { name: 'Metformin', dose: '250mg' },
  { name: 'Insulin glargine', dose: '100unit' },
  { name: 'Fish Oil', dose: '1000mg' },
  { name: 'Clozapine', dose: '100mg' },
  { name: 'Cogentin', dose: '2mg' },
  { name: 'Cymbalta', dose: '60mg' },
  { name: 'Duloxetine', dose: '30mg' },
  { name: 'Lamotrigine', dose: '100mg' },
  { name: 'Famotidine', dose: '20mg' },
  { name: 'Fluticasone', dose: '50mcg' },
  { name: 'Albuterol', dose: '90mcg' },
  { name: 'Calcium', dose: '600mg' },
  { name: 'Multivitamin', dose: '32g' },
  { name: 'Vyvanse', dose: '30mg' },
  { name: 'Ibuprofen', dose: '400mg', prn: true },
  { name: 'Tylenol', dose: '325mg', prn: true },
  { name: 'Loperamide', dose: '2mg', prn: true },
  { name: 'Hydroxyzine', dose: '25mg', prn: true },
]

/** 10 clients × 6–10 meds → 75 rows (counts sum to 75). */
const MEDS_PER_CLIENT = [8, 7, 9, 6, 8, 7, 9, 8, 6, 7]

const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]

export const medications: Medication[] = withTenant(
  clients.slice(0, 10).flatMap((client, ci) => {
    const n = MEDS_PER_CLIENT[ci]
    return Array.from({ length: n }, (_, k) => {
      const spec = pick(MED_POOL, ci * 3 + k * 2)
      // deterministic gaps: every ~7th card has no photo → "+" placeholder
      const noPhoto = (ci * 2 + k) % 7 === 3
      return {
        id: `med-${client.id}-${k + 1}`,
        clientId: client.id,
        clientName: client.name,
        name: spec.name,
        dose: spec.dose,
        schedule: spec.prn ? ('prn' as const) : ('scheduled' as const),
        image: noPhoto ? null : `/med-${((ci + k) % 6) + 1}.jpg`,
        marsDate: '2026-04-01',
        source: 'drive-records' as const,
      }
    })
  }),
)

/* =========================== med deliveries =========================== */

export type MedDeliveryItem = {
  id: string
  /** mono uppercase, e.g. 'BENZTROPINE TAB 0.5MG' */
  medName: string
  left: number
  dispensed: number
  flag: number
}

export type MedDeliveryPerson = {
  id: string
  name: string
  medsCount: number
  flaggedCount: number
  items: MedDeliveryItem[]
}

export type MedDeliveryHouse = {
  id: string
  houseName: string
  deliveries: number
  syncedAgo: string
  periodStart: string
  periodEnd: string
  itemCount: number
  peopleCount: number
  flaggedCount: number
  persons: MedDeliveryPerson[]
}

const DELIVERY_MEDS = [
  'BENZTROPINE TAB 0.5MG', 'CLOZAPINE TAB 100MG', 'INSULIN GLARGINE 100UNIT/ML',
  'METFORMIN TAB 500MG', 'FISH OIL CAP 1000MG', 'TYLENOL TAB 325MG',
  'FLUTICASONE SPRAY 50MCG', 'LAMOTRIGINE TAB 100MG', 'FAMOTIDINE TAB 20MG',
  'ALBUTEROL HFA 90MCG', 'LEVOTHYROXINE TAB 88MCG', 'COGENTIN TAB 2MG',
  'HYDROXYZINE TAB 25MG', 'DULOXETINE CAP 30MG', 'CALCIUM TAB 600MG',
  'VYVANSE CAP 30MG', 'LOPERAMIDE CAP 2MG', 'IBUPROFEN TAB 400MG',
]

const DELIVERY_PEOPLE = [
  ['Mark Castilow', 'Jessica Hankins', 'Ruth Ellery', 'Tom Bridger'],
  ['Dana Whitfield', 'Marcus Lee', 'Paula Jimenez'],
  ['Gary Nolan', 'Sue Ann Pritchard', 'Earl Combs', 'Nina Vasquez'],
  ['Harold Finch', 'Wanda Greer', 'Luis Ortega'],
]

const ITEMS_PER_PERSON = [
  [18, 16, 12, 9],
  [14, 11, 8],
  [15, 13, 10, 7],
  [12, 9, 6],
]

const HOUSE_META = [
  { houseName: 'A Brighter Dawn', deliveries: 12, syncedAgo: '12d', periodStart: '2026-03-18', periodEnd: '2026-04-01' },
  { houseName: 'Maple House', deliveries: 9, syncedAgo: '4d', periodStart: '2026-03-18', periodEnd: '2026-04-01' },
  { houseName: 'Cedar Grove', deliveries: 7, syncedAgo: '2d', periodStart: '2026-03-11', periodEnd: '2026-03-25' },
  { houseName: 'Sunrise Home', deliveries: 5, syncedAgo: '6d', periodStart: '2026-03-14', periodEnd: '2026-03-28' },
]

// ~40% of items flagged: deterministic — items whose (house+person+item) index hits 2-of-5 pattern get a flag of…
function buildPerson(hi: number, pi: number, name: string): MedDeliveryPerson {
  const n = ITEMS_PER_PERSON[hi][pi]
  const items: MedDeliveryItem[] = Array.from({ length: n }, (_, k) => {
    const left = 40 + ((hi * 31 + pi * 17 + k * 97) % 8000)
    const dispensed = 12 + ((hi * 13 + pi * 41 + k * 53) % 3000)
    const flagged = (hi + pi + k) % 5 < 2
    return {
      id: `mdi-h${hi + 1}-p${pi + 1}-${k + 1}`,
      medName: DELIVERY_MEDS[(hi * 5 + pi * 7 + k * 3) % DELIVERY_MEDS.length],
      left,
      dispensed,
      flag: flagged ? 1 + ((hi * 3 + pi * 5 + k) % 15) : 0,
    }
  })
  return {
    id: `mdp-h${hi + 1}-p${pi + 1}`,
    name,
    medsCount: n,
    flaggedCount: items.filter((i) => i.flag > 0).length,
    items,
  }
}

export const medDeliveries: MedDeliveryHouse[] = withTenant(
  HOUSE_META.map((meta, hi) => {
    const persons = DELIVERY_PEOPLE[hi].map((name, pi) => buildPerson(hi, pi, name))
    return {
      id: `mdh-${hi + 1}`,
      ...meta,
      persons,
      peopleCount: persons.length,
      itemCount: persons.reduce((s, p) => s + p.items.length, 0),
      flaggedCount: persons.reduce((s, p) => s + p.flaggedCount, 0),
    }
  }),
)
