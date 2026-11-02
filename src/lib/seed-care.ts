// Care datasets (care-data wave): home-healthcare clients, certification catalog, per-employee certification…
// All fictional.
import { addDays, subDays } from 'date-fns'
import { people } from '@/lib/seed'
import type { TintName } from '@/engine/types'
import { withTenant } from '@/lib/tenancy'

const iso = (d: Date) => d.toISOString()
const now = new Date()

/* ============================== clients ============================== */

export type ClientAppointment = {
  id: string
  date: string // ISO
  title: string // "Dr. Patel — Cardiology"
  location: string
  notes?: string
}

export type Client = {
  id: string
  status: 'active' | 'inactive'
  clientNumber: string
  name: string
  initials: string
  birthdate: string // ISO
  age: number
  medicaid: string
  house: { code: string; name: string; address: string }
  houseName: string
  guardian: { name: string; relationship: string; email: string; phone: string }
  guardianName: string
  ssa: { name: string; email: string; county: string }
  ssaName: string
  ispStart: string // ISO
  selfAdmin: Record<string, string>
  selfAdminExpires: string // ISO
  conditions: string[]
  allergies: string[]
  medications: string[]
  payeeRep: string
  workshop: string
  transportation: string
  houseManager: string
  appointments: ClientAppointment[]
  notes: { time: string; text: string; tint: TintName }[]
  // derived stat mirrors (for detail stats)
  conditionCount: number
  medCount: number
  upcomingAppts: number
}

const HOUSES = [
  { code: 'H-01', name: 'Meadowlane', address: '4708 Meadowlane Dr NW' },
  { code: 'H-02', name: 'Sycamore', address: '2215 Sycamore Hills Dr' },
  { code: 'H-03', name: 'Arlington', address: '908 Arlington Ave' },
  { code: 'H-04', name: 'Briarwood', address: '132 Briarwood Ln' },
  { code: 'H-05', name: 'Kenwood', address: '7740 Kenwood Rd' },
  { code: 'H-06', name: 'Forest Park', address: '1122 Forest Park Blvd' },
]

export const HOUSE_TINTS: Record<string, TintName> = {
  Meadowlane: 'mint',
  Sycamore: 'blue',
  Arlington: 'lavender',
  Briarwood: 'peach',
  Kenwood: 'amber',
  'Forest Park': 'pink',
}

const CONDITION_POOL = [
  'Diabetes', 'Seizure disorder', 'Down syndrome', 'Cerebral palsy', 'Autism',
  'Hypertension', 'Asthma', 'GERD', 'Anxiety', 'Hypothyroidism', 'Vision impairment', 'ADHD',
]

const GUARDIAN_REL = ['Self', 'Mom', 'Dad', 'State Appointed', 'Sibling', 'Aunt', 'Legal Guardian']

const SSA_WORKERS = [
  { name: 'Karen Doyle', email: 'karen.doyle@franklindd.org', county: 'Franklin County DD Board' },
  { name: 'Marcus Webb', email: 'marcus.webb@franklindd.org', county: 'Franklin County DD Board' },
  { name: 'Denise Alvarez', email: 'denise.alvarez@delawaredd.org', county: 'Delaware County DD Board' },
  { name: 'Tom Reilly', email: 'tom.reilly@uniondd.org', county: 'Union County DD Board' },
  { name: 'Priya Sharma', email: 'priya.sharma@fairfielddd.org', county: 'Fairfield County DD Board' },
]

const DOCTORS = [
  { title: 'Dr. Patel — Cardiology', location: 'Riverside Heart Center, Ste 210' },
  { title: 'Dr. Nguyen — Neurology', location: 'NeuroCare Clinic, Bldg B' },
  { title: 'Dr. Foster — Primary Care', location: 'Meadowlane Family Health' },
  { title: 'Dr. Kim — Endocrinology', location: 'Diabetes & Endocrine Associates' },
  { title: 'Dr. Ortiz — Psychiatry', location: 'Behavioral Wellness Center' },
  { title: 'Dr. Hayes — Orthopedics', location: 'Ortho Spine Institute' },
  { title: 'Dr. Brooks — Ophthalmology', location: 'ClearView Eye Care' },
  { title: 'Dr. Lane — Dentistry', location: 'SmileWorks Dental, Rm 4' },
  { title: 'Dr. Chen — Pulmonology', location: 'Lung Health Partners' },
  { title: 'Dr. Singh — Gastroenterology', location: 'Digestive Care Clinic' },
]

const APPT_NOTES = [
  'Bring med list and insurance card.',
  'Fasting labs before the visit.',
  'Guardian will meet staff there.',
  'Follow-up from last quarter.',
  'Needs wheelchair van transport.',
  'Annual wellness check.',
]

const MEDICATIONS = [
  'Metformin 500mg', 'Levetiracetam 750mg', 'Synthroid 75mcg', 'Lisinopril 10mg',
  'Albuterol inhaler', 'Omeprazole 20mg', 'Sertraline 50mg', 'Insulin glargine',
  'Risperidone 1mg', 'Vitamin D3 2000IU', 'Gabapentin 300mg', 'Fluticasone nasal',
]

const ALLERGIES = ['Penicillin', 'Peanuts', 'Latex', 'Sulfa drugs', 'Bee stings', 'Shellfish', 'None known']

const SELF_ADMIN_KEYS = ['O&T', 'Health', 'Insulin', 'Glu', 'Inhale', 'O2', 'G-Tube']
const SELF_ADMIN_RESULTS = ['Independent', 'With verbal prompts', 'With assist', 'Staff administered', 'Not applicable']

const CLIENT_NAMES = [
  'Danny Whitaker', 'Rosa Delgado', 'Kenny Marsh', 'Beth Ann Sutter', 'Tyrone Fields',
  'Maggie Oconnell', 'Sam Petrakis', 'Joyce Linden', 'Carl Draper', 'Tonya Reeves',
  'Billy Harmon', 'Annette Kowal', 'Doug Fenwick', 'Pam Sorrell', 'Reggie Booth',
  'Cora Lindsey', 'Miles Prescott', 'Darlene Yu', 'Gary Ostrander', 'Fern Calloway', 'Leon Tibbs',
]

const WORKSHOPS = [
  'Community day program', 'Creative Trails workshop', 'Enclave employment',
  'Volunteer crew — food bank', 'None — home-based', 'Senior center program',
]

const TRANSPORTS = ['Agency van', 'Guardian provides', 'County transit pass', 'Staff vehicle', 'Wheelchair van']

const HOUSE_MANAGERS = ['Denise Harper', 'Angela Ruiz', 'Monica Steele', 'Pat Oduya', 'Sharon Vance', 'Greg Milliken']

const NOTE_TINTS: TintName[] = ['mint', 'blue', 'peach', 'lavender', 'amber', 'pink']
const NOTE_TEXTS = [
  'ISP review meeting held with county SSA.',
  'Guardian called — updated emergency contact.',
  'New seizure protocol added to med book.',
  'Completed annual physical; paperwork filed.',
  'Behavior support plan refreshed with team.',
  'Diet order updated — carb counting added.',
  'Transportation schedule changed for workshop.',
  'Self-admin reassessment scheduled with nurse.',
]

const age = (birth: Date) => {
  let a = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) a--
  return a
}

const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]

export const clients: Client[]  = withTenant(CLIENT_NAMES.map((name, i) => {
  const status: Client['status'] = i < 13 ? 'active' : 'inactive'
  const house = HOUSES[i % HOUSES.length]
  const ssa = SSA_WORKERS[i % SSA_WORKERS.length]
  const birth = subDays(now, (22 + ((i * 13) % 45)) * 365 + ((i * 97) % 300))
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase()
  const rel = GUARDIAN_REL[i % GUARDIAN_REL.length]
  const guardianName =
    rel === 'Self' ? name : `${pick(['Helen', 'Ruth', 'Carol', 'Diane', 'Susan', 'Barb'], i)} ${name.split(' ')[1]}`

  // 1–3 conditions
  const nCond = 1 + (i % 3)
  const conditions = Array.from({ length: nCond }, (_, k) => CONDITION_POOL[(i * 3 + k * 5) % CONDITION_POOL.length])
    .filter((v, k, a) => a.indexOf(v) === k)
  const allergy = ALLERGIES[i % ALLERGIES.length]
  const allergies = allergy === 'None known' ? [] : i % 4 === 0 ? [allergy, ALLERGIES[(i + 3) % (ALLERGIES.length - 1)]] : [allergy]
  const nMeds = 2 + (i % 4)
  const medications = Array.from({ length: nMeds }, (_, k) => MEDICATIONS[(i * 2 + k * 3) % MEDICATIONS.length])

  const selfAdmin = Object.fromEntries(
    SELF_ADMIN_KEYS.map((k, j) => [k, SELF_ADMIN_RESULTS[(i + j * 2) % SELF_ADMIN_RESULTS.length]]),
  )

  // 3–6 upcoming appointments in the next 5–95 days
  const nAppts = 3 + (i % 4)
  const appointments: ClientAppointment[] = Array.from({ length: nAppts }, (_, k) => {
    const doc = DOCTORS[(i * 3 + k * 4) % DOCTORS.length]
    return {
      id: `appt-${String(i + 1).padStart(2, '0')}-${k + 1}`,
      date: iso(addDays(now, 5 + ((i * 7 + k * 13) % 90))),
      title: doc.title,
      location: doc.location,
      notes: pick(APPT_NOTES, i + k),
    }
  }).sort((a, b) => a.date.localeCompare(b.date))

  const notes = Array.from({ length: 3 }, (_, k) => ({
    time: `${2 + ((i + k * 3) % 20)}d ago`,
    text: NOTE_TEXTS[(i * 2 + k) % NOTE_TEXTS.length],
    tint: NOTE_TINTS[(i + k) % NOTE_TINTS.length],
  }))

  return {
    id: `cl-${String(i + 1).padStart(2, '0')}`,
    status,
    clientNumber: `CL-${1042 + i * 7}`,
    name,
    initials,
    birthdate: iso(birth),
    age: age(birth),
    medicaid: `OH-${String(730000000 + i * 9182)}`,
    house,
    houseName: house.name,
    guardian: {
      name: guardianName,
      relationship: rel,
      email: `${guardianName.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, '.')}@mail.example`,
      phone: `+1 (614) 555-${String(2000 + i * 37).slice(-4)}`,
    },
    guardianName: rel === 'Self' ? `${guardianName} (Self)` : guardianName,
    ssa,
    ssaName: ssa.name,
    ispStart: iso(subDays(now, 60 + ((i * 41) % 2000))),
    selfAdmin,
    selfAdminExpires: iso(addDays(now, -20 + ((i * 19) % 380))),
    conditions,
    allergies,
    medications,
    payeeRep: pick(['Self', 'Guardian', 'Agency rep payee', 'Trust fund'], i),
    workshop: pick(WORKSHOPS, i),
    transportation: pick(TRANSPORTS, i),
    houseManager: HOUSE_MANAGERS[i % HOUSE_MANAGERS.length],
    appointments,
    notes,
    conditionCount: conditions.length,
    medCount: medications.length,
    upcomingAppts: appointments.length,
  }
}))

/* =========================== certifications =========================== */

export type Certification = {
  id: string
  name: string
  short: string
  required: boolean
  validMonths: number
  icon: string
  tint: TintName
  issuer: string
}

export const certifications: Certification[]  = withTenant([
  { id: 'cert-dodd', name: 'DODD 8-Hour Provider Training', short: 'DODD 8-Hr', required: true, validMonths: 12, icon: 'shield-check', tint: 'mint', issuer: 'Ohio DODD' },
  { id: 'cert-cpr', name: 'CPR / First Aid', short: 'CPR/FA', required: true, validMonths: 24, icon: 'heart-pulse', tint: 'pink', issuer: 'American Red Cross' },
  { id: 'cert-med1', name: 'Medication Delivery — Category 1', short: 'Med Del 1', required: true, validMonths: 12, icon: 'pill', tint: 'blue', issuer: 'Ohio DODD' },
  { id: 'cert-med2', name: 'Medication Delivery — Category 2', short: 'Med Del 2', required: true, validMonths: 12, icon: 'pill', tint: 'blue', issuer: 'Ohio DODD' },
  { id: 'cert-med3', name: 'Medication Delivery — Category 3', short: 'Med Del 3', required: true, validMonths: 12, icon: 'syringe', tint: 'blue', issuer: 'Ohio DODD' },
  { id: 'cert-mandt', name: 'MANDT De-escalation', short: 'MANDT', required: true, validMonths: 12, icon: 'hand-heart', tint: 'lavender', issuer: 'MANDT System' },
  { id: 'cert-driver', name: "Driver's License (validated)", short: "Driver's Lic", required: true, validMonths: 48, icon: 'car', tint: 'amber', issuer: 'Ohio BMV' },
  { id: 'cert-bci', name: 'BCI / FBI Background Check', short: 'BCI/FBI', required: true, validMonths: 12, icon: 'fingerprint', tint: 'peach', issuer: 'Ohio BCI' },
  { id: 'cert-hipaa', name: 'HIPAA Privacy Training', short: 'HIPAA', required: false, validMonths: 12, icon: 'lock', tint: 'mint', issuer: 'Internal' },
  { id: 'cert-nurse', name: 'Nurse Aide (STNA)', short: 'STNA', required: false, validMonths: 24, icon: 'stethoscope', tint: 'lavender', issuer: 'Ohio Dept of Health' },
  { id: 'cert-diploma', name: 'High-School Diploma / GED', short: 'HS Diploma', required: false, validMonths: 0, icon: 'graduation-cap', tint: 'green', issuer: 'Dept of Education' },
  { id: 'cert-food', name: 'Food Handler Card', short: 'Food Handler', required: false, validMonths: 36, icon: 'chef-hat', tint: 'amber', issuer: 'County Health Dept' },
])

export type StaffCertStatus = 'valid' | 'expiring' | 'expired' | 'missing'

export type StaffCert = {
  id: string
  personId: string
  personName: string
  avatar: string
  certId: string
  certName: string
  status: StaffCertStatus
  issuedAt: string | null // ISO
  expiresAt: string | null // ISO (null when missing / never expires)
}

/** The 8 key certs that make up the compliance matrix. */
export const MATRIX_CERTS = [
  { key: 'dodd', certId: 'cert-dodd', label: 'DODD 8-Hr' },
  { key: 'cpr', certId: 'cert-cpr', label: 'CPR/FA' },
  { key: 'med1', certId: 'cert-med1', label: 'Med Del 1' },
  { key: 'med2', certId: 'cert-med2', label: 'Med Del 2' },
  { key: 'med3', certId: 'cert-med3', label: 'Med Del 3' },
  { key: 'mandt', certId: 'cert-mandt', label: 'MANDT' },
  { key: 'driver', certId: 'cert-driver', label: "Driver's Lic" },
  { key: 'bci', certId: 'cert-bci', label: 'BCI/FBI' },
] as const

// Status pattern per matrix cert, by person index (0–47).
const PATTERN: Record<(typeof MATRIX_CERTS)[number]['key'], { expired: number[]; missing: number[]; expiring: number[] }> = {
  dodd: { expired: [3, 11, 27], missing: [7, 19, 35, 44], expiring: [1, 9, 15, 23, 31, 40] },
  cpr: { expired: [33], missing: [13], expiring: [5, 21] },
  med1: { expired: [6, 26], missing: [2, 17, 38], expiring: [10, 29, 46] },
  med2: { expired: [14], missing: [8, 22, 41, 47], expiring: [0, 30] },
  med3: { expired: [24], missing: [4, 12, 20, 28, 36, 45], expiring: [16, 42] },
  mandt: { expired: [18], missing: [9, 25, 39], expiring: [34, 43] },
  driver: { expired: [], missing: [1, 15, 29, 43], expiring: [7, 37] },
  bci: { expired: [5, 32], missing: [10, 46], expiring: [2, 22, 41] },
}

const statusFor = (certKey: keyof typeof PATTERN, personIdx: number): StaffCertStatus => {
  const p = PATTERN[certKey]
  if (p.expired.includes(personIdx)) return 'expired'
  if (p.missing.includes(personIdx)) return 'missing'
  if (p.expiring.includes(personIdx)) return 'expiring'
  return 'valid'
}

const certById = (id: string) => certifications.find((c) => c.id === id)!

function mkStaffCert(personIdx: number, certId: string, status: StaffCertStatus): StaffCert {
  const person = people[personIdx]
  const cert = certById(certId)
  const i = personIdx
  let expiresAt: string | null = null
  let issuedAt: string | null = null
  if (status === 'expired') {
    expiresAt = iso(subDays(now, 5 + ((i * 7) % 90)))
    issuedAt = iso(subDays(now, cert.validMonths * 30 + (5 + ((i * 7) % 90))))
  } else if (status === 'expiring') {
    expiresAt = iso(addDays(now, 3 + ((i * 5) % 26)))
    issuedAt = iso(subDays(now, cert.validMonths * 30 - (3 + ((i * 5) % 26))))
  } else if (status === 'valid' && cert.validMonths > 0) {
    const daysLeft = 45 + ((i * 53) % 500)
    expiresAt = iso(addDays(now, daysLeft))
    issuedAt = iso(subDays(now, cert.validMonths * 30 - daysLeft))
  } else if (status === 'valid') {
    issuedAt = iso(subDays(now, 400 + ((i * 31) % 2000)))
  }
  return {
    id: `sc-${certId.replace('cert-', '')}-${person.id}`,
    personId: person.id,
    personName: person.name,
    avatar: person.avatar,
    certId,
    certName: cert.short,
    status,
    issuedAt,
    expiresAt,
  }
}

export const staffCerts: StaffCert[]  = withTenant([
  // 8 required certs for every employee (missing included — the cascade story)
  ...people.flatMap((_, i) => MATRIX_CERTS.map((mc) => mkStaffCert(i, mc.certId, statusFor(mc.key, i)))),
  // optional certs sprinkled in for realism
  ...people.flatMap((_, i) => {
    const rows: StaffCert[] = []
    rows.push(mkStaffCert(i, 'cert-hipaa', i === 9 ? 'expired' : 'valid'))
    if (i % 3 === 0) rows.push(mkStaffCert(i, 'cert-nurse', i === 12 ? 'expiring' : 'valid'))
    rows.push(mkStaffCert(i, 'cert-diploma', 'valid'))
    if (i % 5 === 0) rows.push(mkStaffCert(i, 'cert-food', 'valid'))
    return rows
  }),
])

/* ------------------- derived: per-person compliance matrix ------------------- */

export type CertMatrixRow = {
  id: string // person id
  name: string
  avatar: string
  role: string
  department: string
  dodd: StaffCertStatus
  cpr: StaffCertStatus
  med1: StaffCertStatus
  med2: StaffCertStatus
  med3: StaffCertStatus
  mandt: StaffCertStatus
  driver: StaffCertStatus
  bci: StaffCertStatus
  /** convenience filter fields */
  anyExpiring: 'yes' | 'no'
  anyExpired: 'yes' | 'no'
  anyMissing: 'yes' | 'no'
  missingCount: number
  validCount: number
  /** short cert names by problem state — for detail chips sections */
  missingCerts: string[]
  attentionCerts: string[] // expired + expiring
  certs: { certId: string; certName: string; status: StaffCertStatus; expiresAt: string | null }[]
}

export const certMatrix: CertMatrixRow[]  = withTenant(people.map((person) => {
  const rows = staffCerts.filter((sc) => sc.personId === person.id)
  const byCert = Object.fromEntries(rows.map((sc) => [sc.certId, sc]))
  const statuses = MATRIX_CERTS.map((mc) => (byCert[mc.certId]?.status ?? 'missing') as StaffCertStatus)
  const row: CertMatrixRow = {
    id: person.id,
    name: person.name,
    avatar: person.avatar,
    role: person.role,
    department: person.department,
    dodd: statuses[0],
    cpr: statuses[1],
    med1: statuses[2],
    med2: statuses[3],
    med3: statuses[4],
    mandt: statuses[5],
    driver: statuses[6],
    bci: statuses[7],
    anyExpiring: statuses.includes('expiring') ? 'yes' : 'no',
    anyExpired: statuses.includes('expired') ? 'yes' : 'no',
    anyMissing: statuses.includes('missing') ? 'yes' : 'no',
    missingCount: statuses.filter((s) => s === 'missing').length,
    validCount: statuses.filter((s) => s === 'valid').length,
    missingCerts: MATRIX_CERTS.filter((_, k) => statuses[k] === 'missing').map((mc) => mc.label),
    attentionCerts: MATRIX_CERTS.map((mc, k) => ({ mc, s: statuses[k] }))
      .filter((x) => x.s === 'expired' || x.s === 'expiring')
      .map((x) => (x.s === 'expired' ? `${x.mc.label} (expired)` : `${x.mc.label} (expiring)`)),
    certs: MATRIX_CERTS.map((mc, k) => ({
      certId: mc.certId,
      certName: certById(mc.certId).name,
      status: statuses[k],
      expiresAt: byCert[mc.certId]?.expiresAt ?? null,
    })),
  }
  return row
}))
