// Ops datasets (wave-2 · ops-apps branch) — registered in src/lib/seed-extra.ts.
// Home-healthcare operations data: expense reports (with line items), a two-kind inventory (supplies + medications)…
import { addDays, subDays } from 'date-fns'
import type { TintName } from '@/engine/types'
import { withTenant } from '@/lib/tenancy'

const iso = (d: Date) => d.toISOString()
const now = new Date()

/* ---------------- expense reports (14) ---------------- */

export type ExpenseCategory = 'Mileage' | 'Supplies' | 'Training' | 'Client activities' | 'Meals' | 'Medical'
export type ExpenseStatus = 'pending' | 'approved' | 'rejected'

export type ExpenseLineItem = {
  description: string
  category: string
  amount: number
  receipt: boolean
}

export type ExpenseReport = {
  id: string
  title: string
  /** person ref (p-NN) — resolve via personById */
  submitterId: string
  category: ExpenseCategory
  amount: number
  date: string // ISO
  status: ExpenseStatus
  lineItems: ExpenseLineItem[]
  /** person ref (p-NN), set once approved/rejected */
  approverId?: string
  notes?: string
}

const li = (description: string, category: string, amount: number, receipt = true): ExpenseLineItem => ({
  description,
  category,
  amount,
  receipt,
})

type ReportSeed = Omit<ExpenseReport, 'amount' | 'date'> & { daysAgo: number }
const report = (r: ReportSeed): ExpenseReport => {
  const { daysAgo, ...rest } = r
  return {
    ...rest,
    date: iso(subDays(now, daysAgo)),
    amount: Math.round(r.lineItems.reduce((s, i) => s + i.amount, 0) * 100) / 100,
  }
}

export const expenseReports: ExpenseReport[]  = withTenant([
  report({
    id: 'er-01', title: 'Mileage — Meadowlane route, week 42', submitterId: 'p-06', category: 'Mileage',
    status: 'pending', daysAgo: 3,
    lineItems: [
      li('Home visits · 84 mi @ $0.67/mi', 'Mileage', 56.28, false),
      li('Toll — Riverside bridge', 'Mileage', 4.5),
      li('Parking — St. Anne clinic', 'Mileage', 6, false),
    ],
    notes: 'Standard weekly route plus one unscheduled wellness check.',
  }),
  report({
    id: 'er-02', title: 'PPE restock — Orchard Dale', submitterId: 'p-09', category: 'Supplies',
    status: 'pending', daysAgo: 5,
    lineItems: [
      li('Nitrile gloves, L · 4 boxes', 'PPE', 47.8),
      li('N95 respirators · 2 boxes', 'PPE', 39.98),
      li('Hand sanitizer · 6 bottles', 'PPE', 23.4, false),
    ],
  }),
  report({
    id: 'er-03', title: 'Wound-care certification — renewal', submitterId: 'p-07', category: 'Training',
    status: 'approved', approverId: 'p-04', daysAgo: 8,
    lineItems: [
      li('Course fee — NWCPC level 2', 'Tuition', 289),
      li('Study guide + exam voucher', 'Materials', 64.5),
    ],
    notes: 'Required for the Orchard Dale wound-care caseload.',
  }),
  report({
    id: 'er-04', title: 'Client outing — orchard day trip', submitterId: 'p-02', category: 'Client activities',
    status: 'approved', approverId: 'p-05', daysAgo: 12,
    lineItems: [
      li('Admission · 4 clients + 2 staff', 'Activities', 36),
      li('Accessible van fuel', 'Transport', 28.75, false),
      li('Lunch — picnic supplies', 'Meals', 42.3),
      li('Apple picking bags', 'Activities', 12, false),
    ],
  }),
  report({
    id: 'er-05', title: 'Team lunch — care-plan workshop', submitterId: 'p-10', category: 'Meals',
    status: 'rejected', approverId: 'p-04', daysAgo: 15,
    lineItems: [
      li('Catering — 9 attendees', 'Meals', 158.4),
      li('Drinks + desserts', 'Meals', 36.2),
    ],
    notes: 'Rejected: workshops are catered centrally — see Ops bulletin 18.',
  }),
  report({
    id: 'er-06', title: 'First-aid kit replacement — van 2', submitterId: 'p-11', category: 'Medical',
    status: 'approved', approverId: 'p-05', daysAgo: 20,
    lineItems: [
      li('ANSI Class B first-aid kit', 'Medical supplies', 74.99),
      li('CPR pocket masks · 2', 'Medical supplies', 21.5, false),
      li('Instant cold packs · 6', 'Medical supplies', 14.7),
    ],
  }),
  report({
    id: 'er-07', title: 'Mileage — 49th St double shifts', submitterId: 'p-01', category: 'Mileage',
    status: 'pending', daysAgo: 24,
    lineItems: [
      li('Home visits · 126 mi @ $0.67/mi', 'Mileage', 84.42, false),
      li('Parking — downtown appointment', 'Mileage', 9),
    ],
  }),
  report({
    id: 'er-08', title: 'Dementia-care webinar series', submitterId: 'p-03', category: 'Training',
    status: 'pending', daysAgo: 26,
    lineItems: [
      li('Webinar pass · 6 sessions', 'Tuition', 145),
      li('Workbook (printed)', 'Materials', 18.25, false),
    ],
  }),
  report({
    id: 'er-09', title: 'Craft supplies — client activities', submitterId: 'p-08', category: 'Client activities',
    status: 'approved', approverId: 'p-05', daysAgo: 34,
    lineItems: [
      li('Watercolor sets · 5', 'Activities', 44.75),
      li('Brushes + heavyweight paper', 'Activities', 29.6),
      li('Adaptive grip aids', 'Activities', 33.2, false),
    ],
  }),
  report({
    id: 'er-10', title: 'Parking + tolls — hospital follow-up', submitterId: 'p-12', category: 'Mileage',
    status: 'rejected', approverId: 'p-04', daysAgo: 41,
    lineItems: [
      li('Hospital garage · 2 days', 'Parking', 38),
      li('Toll — I-90 express', 'Tolls', 11.8, false),
    ],
    notes: 'Rejected: missing parking receipts — resubmit with photos.',
  }),
  report({
    id: 'er-11', title: 'Gloves & wipes top-up — Meadowlane', submitterId: 'p-06', category: 'Supplies',
    status: 'approved', approverId: 'p-04', daysAgo: 48,
    lineItems: [
      li('Nitrile gloves, M · 6 boxes', 'PPE', 68.7),
      li('Disinfectant wipes · 8 canisters', 'Cleaning', 51.92),
      li('Surface spray · 4 bottles', 'Cleaning', 19.8, false),
      li('Paper towels · 12 rolls', 'Cleaning', 16.44),
    ],
  }),
  report({
    id: 'er-12', title: 'CPR recertification — 3 staff', submitterId: 'p-05', category: 'Training',
    status: 'pending', daysAgo: 62,
    lineItems: [
      li('AHA BLS course · 3 seats', 'Tuition', 210),
      li('Certification cards', 'Fees', 27, false),
    ],
    notes: 'Cards expire end of month — please prioritize.',
  }),
  report({
    id: 'er-13', title: 'Birthday celebration — client M.H.', submitterId: 'p-02', category: 'Client activities',
    status: 'approved', approverId: 'p-05', daysAgo: 70,
    lineItems: [
      li('Cake + candles', 'Celebration', 32.5),
      li('Decorations', 'Celebration', 18.99, false),
      li('Photo prints for family', 'Celebration', 9.8),
    ],
  }),
  report({
    id: 'er-14', title: 'OTC stock — med room', submitterId: 'p-09', category: 'Medical',
    status: 'rejected', approverId: 'p-04', daysAgo: 83,
    lineItems: [
      li('Ibuprofen 200mg · 2 bottles', 'OTC', 17.6),
      li('Acetaminophen 500mg · 2 bottles', 'OTC', 19.4),
      li('Antacid tablets', 'OTC', 8.3, false),
      li('Thermometer probe covers', 'OTC', 11.99),
    ],
    notes: 'Rejected: OTC stock goes through central purchasing, not expenses.',
  }),
  report({
    id: 'er-15', title: 'Mileage — intake assessments, new clients', submitterId: 'p-07', category: 'Mileage',
    status: 'approved', approverId: 'p-05', daysAgo: 95,
    lineItems: [
      li('Home visits · 158 mi @ $0.67/mi', 'Mileage', 105.86, false),
      li('Parking — county health office', 'Mileage', 7),
    ],
  }),
  report({
    id: 'er-16', title: 'Safe-handling workshop — lift training', submitterId: 'p-10', category: 'Training',
    status: 'approved', approverId: 'p-04', daysAgo: 110,
    lineItems: [
      li('Instructor fee (shared)', 'Tuition', 120),
      li('Training room rental', 'Facilities', 65),
      li('Printed manuals · 8', 'Materials', 24.8, false),
    ],
  }),
])

/* ---------------- inventory (30: 18 supplies + 12 medications) ---------------- */

export type InventoryKind = 'supplies' | 'medications'
export type StorageLocation = 'House — Meadowlane' | 'House — Orchard Dale' | 'House — 49th St' | 'Office'

export type InventoryItem = {
  id: string
  name: string
  kind: InventoryKind
  category: string
  quantityOnHand: number
  unit: string
  reorderLevel: number
  storageLocation: StorageLocation
  lastRestocked: string // ISO
  notes?: string
  /* medications only */
  strength?: string
  form?: 'tab' | 'vial' | 'inhaler' | 'cream' | 'patch' | 'liquid'
  lot?: string
  expiresAt?: string // ISO
  controlled?: boolean
  /** client initials the medication is assigned to ("OTC" for house stock) */
  clientAssociation?: string
}

type ItemSeed = Omit<InventoryItem, 'lastRestocked' | 'expiresAt'> & { restockedDaysAgo: number; expiresInDays?: number }
const item = (s: ItemSeed): InventoryItem => {
  const { restockedDaysAgo, expiresInDays, ...rest } = s
  return {
    ...rest,
    lastRestocked: iso(subDays(now, restockedDaysAgo)),
    ...(expiresInDays != null ? { expiresAt: iso(addDays(now, expiresInDays)) } : {}),
  }
}

const MEADOW: StorageLocation = 'House — Meadowlane'
const ORCHARD: StorageLocation = 'House — Orchard Dale'
const NINE49: StorageLocation = 'House — 49th St'
const OFFICE: StorageLocation = 'Office'

export const inventoryItems: InventoryItem[]  = withTenant([
  /* ---------- supplies (18) ---------- */
  item({ id: 'inv-01', name: 'Nitrile gloves, S', kind: 'supplies', category: 'PPE', quantityOnHand: 34, unit: 'boxes', reorderLevel: 12, storageLocation: MEADOW, restockedDaysAgo: 6 }),
  item({ id: 'inv-02', name: 'Nitrile gloves, L', kind: 'supplies', category: 'PPE', quantityOnHand: 8, unit: 'boxes', reorderLevel: 12, storageLocation: MEADOW, restockedDaysAgo: 21, notes: 'High burn rate on the morning shift.' }),
  item({ id: 'inv-03', name: 'N95 respirators', kind: 'supplies', category: 'PPE', quantityOnHand: 3, unit: 'boxes', reorderLevel: 6, storageLocation: ORCHARD, restockedDaysAgo: 34 }),
  item({ id: 'inv-04', name: 'Hand sanitizer 500mL', kind: 'supplies', category: 'PPE', quantityOnHand: 18, unit: 'bottles', reorderLevel: 8, storageLocation: NINE49, restockedDaysAgo: 9 }),
  item({ id: 'inv-05', name: 'Disinfectant wipes', kind: 'supplies', category: 'Cleaning', quantityOnHand: 22, unit: 'canisters', reorderLevel: 10, storageLocation: ORCHARD, restockedDaysAgo: 4 }),
  item({ id: 'inv-06', name: 'Surface spray', kind: 'supplies', category: 'Cleaning', quantityOnHand: 4, unit: 'bottles', reorderLevel: 6, storageLocation: MEADOW, restockedDaysAgo: 27 }),
  item({ id: 'inv-07', name: 'Paper towels', kind: 'supplies', category: 'Cleaning', quantityOnHand: 20, unit: 'rolls', reorderLevel: 10, storageLocation: NINE49, restockedDaysAgo: 11 }),
  item({ id: 'inv-08', name: 'Garbage bags, 30L', kind: 'supplies', category: 'Cleaning', quantityOnHand: 11, unit: 'rolls', reorderLevel: 6, storageLocation: ORCHARD, restockedDaysAgo: 15 }),
  item({ id: 'inv-09', name: 'Liquid hand soap refills', kind: 'supplies', category: 'Cleaning', quantityOnHand: 7, unit: 'refills', reorderLevel: 4, storageLocation: MEADOW, restockedDaysAgo: 18 }),
  item({ id: 'inv-10', name: 'Laundry detergent', kind: 'supplies', category: 'Cleaning', quantityOnHand: 5, unit: 'jugs', reorderLevel: 3, storageLocation: NINE49, restockedDaysAgo: 24 }),
  item({ id: 'inv-11', name: 'Adult briefs, M', kind: 'supplies', category: 'Personal care', quantityOnHand: 15, unit: 'packs', reorderLevel: 8, storageLocation: MEADOW, restockedDaysAgo: 7 }),
  item({ id: 'inv-12', name: 'Adult briefs, L', kind: 'supplies', category: 'Personal care', quantityOnHand: 6, unit: 'packs', reorderLevel: 8, storageLocation: ORCHARD, restockedDaysAgo: 29, notes: 'Two clients upsized — raise reorder level.' }),
  item({ id: 'inv-13', name: 'Barrier skin cream', kind: 'supplies', category: 'Personal care', quantityOnHand: 9, unit: 'tubes', reorderLevel: 4, storageLocation: NINE49, restockedDaysAgo: 13 }),
  item({ id: 'inv-14', name: 'Office paper, A4', kind: 'supplies', category: 'Office', quantityOnHand: 9, unit: 'reams', reorderLevel: 5, storageLocation: OFFICE, restockedDaysAgo: 16 }),
  item({ id: 'inv-15', name: 'Printer toner, TN-450', kind: 'supplies', category: 'Office', quantityOnHand: 2, unit: 'cartridges', reorderLevel: 2, storageLocation: OFFICE, restockedDaysAgo: 45 }),
  item({ id: 'inv-16', name: 'Sticky notes', kind: 'supplies', category: 'Office', quantityOnHand: 14, unit: 'pads', reorderLevel: 6, storageLocation: OFFICE, restockedDaysAgo: 31 }),
  item({ id: 'inv-17', name: 'First-aid dressings, sterile', kind: 'supplies', category: 'Medical supplies', quantityOnHand: 9, unit: 'boxes', reorderLevel: 6, storageLocation: MEADOW, restockedDaysAgo: 10 }),
  item({ id: 'inv-18', name: 'Blood glucose test strips', kind: 'supplies', category: 'Medical supplies', quantityOnHand: 5, unit: 'boxes', reorderLevel: 5, storageLocation: ORCHARD, restockedDaysAgo: 38, notes: 'Compatible with the house glucometers only.' }),

  /* ---------- medications (12) ---------- */
  item({
    id: 'med-01', name: 'Metformin', kind: 'medications', category: 'Antidiabetic', strength: '500 mg', form: 'tab',
    quantityOnHand: 420, unit: 'tabs', reorderLevel: 100, storageLocation: MEADOW, restockedDaysAgo: 5,
    lot: 'MFT-2417', expiresInDays: 430, clientAssociation: 'M.H.',
  }),
  item({
    id: 'med-02', name: 'Insulin glargine', kind: 'medications', category: 'Antidiabetic', strength: '100 IU/mL · 10 mL', form: 'vial',
    quantityOnHand: 6, unit: 'vials', reorderLevel: 4, storageLocation: MEADOW, restockedDaysAgo: 12,
    lot: 'INS-0982', expiresInDays: 20, clientAssociation: 'R.T.', notes: 'Refrigerated — med fridge, top shelf.',
  }),
  item({
    id: 'med-03', name: 'Albuterol inhaler', kind: 'medications', category: 'Respiratory', strength: '90 mcg/actuation', form: 'inhaler',
    quantityOnHand: 3, unit: 'inhalers', reorderLevel: 2, storageLocation: ORCHARD, restockedDaysAgo: 22,
    lot: 'ALB-5560', expiresInDays: 95, clientAssociation: 'J.B.',
  }),
  item({
    id: 'med-04', name: 'Lorazepam', kind: 'medications', category: 'Anxiolytic', strength: '0.5 mg', form: 'tab',
    quantityOnHand: 28, unit: 'tabs', reorderLevel: 10, storageLocation: MEADOW, restockedDaysAgo: 9,
    lot: 'LRZ-3310', expiresInDays: 240, controlled: true, clientAssociation: 'M.H.', notes: 'Schedule IV — double-locked cabinet, count per shift.',
  }),
  item({
    id: 'med-05', name: 'Ibuprofen', kind: 'medications', category: 'Analgesic (OTC)', strength: '200 mg', form: 'tab',
    quantityOnHand: 180, unit: 'tabs', reorderLevel: 60, storageLocation: MEADOW, restockedDaysAgo: 14,
    lot: 'IBU-7741', expiresInDays: 310, clientAssociation: 'OTC',
  }),
  item({
    id: 'med-06', name: 'Acetaminophen', kind: 'medications', category: 'Analgesic (OTC)', strength: '500 mg', form: 'tab',
    quantityOnHand: 240, unit: 'tabs', reorderLevel: 80, storageLocation: ORCHARD, restockedDaysAgo: 8,
    lot: 'ACE-1190', expiresInDays: 380, clientAssociation: 'OTC',
  }),
  item({
    id: 'med-07', name: 'Hydrocortisone cream', kind: 'medications', category: 'Dermatological', strength: '1% · 30 g', form: 'cream',
    quantityOnHand: 5, unit: 'tubes', reorderLevel: 3, storageLocation: ORCHARD, restockedDaysAgo: 40,
    lot: 'HCR-2284', expiresInDays: 18, clientAssociation: 'J.B.',
  }),
  item({
    id: 'med-08', name: 'Warfarin', kind: 'medications', category: 'Anticoagulant', strength: '5 mg', form: 'tab',
    quantityOnHand: 60, unit: 'tabs', reorderLevel: 30, storageLocation: MEADOW, restockedDaysAgo: 55,
    lot: 'WRF-6642', expiresInDays: -5, clientAssociation: 'R.T.', notes: 'Lot expired — quarantine and replace.',
  }),
  item({
    id: 'med-09', name: 'Amoxicillin', kind: 'medications', category: 'Antibiotic', strength: '250 mg', form: 'tab',
    quantityOnHand: 18, unit: 'caps', reorderLevel: 20, storageLocation: MEADOW, restockedDaysAgo: 19,
    lot: 'AMX-9023', expiresInDays: 60, clientAssociation: 'M.H.',
  }),
  item({
    id: 'med-10', name: 'Morphine sulfate oral solution', kind: 'medications', category: 'Analgesic (opioid)', strength: '10 mg/5 mL · 100 mL', form: 'liquid',
    quantityOnHand: 2, unit: 'bottles', reorderLevel: 1, storageLocation: NINE49, restockedDaysAgo: 26,
    lot: 'MOR-4418', expiresInDays: 200, controlled: true, clientAssociation: 'A.K.', notes: 'Schedule II — hospice protocol, witness every dose.',
  }),
  item({
    id: 'med-11', name: 'Fentanyl patch', kind: 'medications', category: 'Analgesic (opioid)', strength: '25 mcg/h', form: 'patch',
    quantityOnHand: 4, unit: 'patches', reorderLevel: 3, storageLocation: NINE49, restockedDaysAgo: 16,
    lot: 'FNT-7307', expiresInDays: 180, controlled: true, clientAssociation: 'A.K.',
  }),
  item({
    id: 'med-12', name: 'Vitamin D3', kind: 'medications', category: 'Supplement', strength: '1000 IU', form: 'tab',
    quantityOnHand: 90, unit: 'tabs', reorderLevel: 30, storageLocation: ORCHARD, restockedDaysAgo: 28,
    lot: 'VD3-3355', expiresInDays: 520, clientAssociation: 'OTC',
  }),
])

/* ---------------- kanban tasks (16) ---------------- */

export type TaskColumn = 'backlog' | 'this-week' | 'in-progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'

export type OpsTask = {
  id: string
  title: string
  description: string
  column: TaskColumn
  /** person ref (p-NN) */
  assigneeId: string
  priority: TaskPriority
  due: string // ISO date
  tint: TintName
  labels: string[]
  /** stamped by the sheet lane (SheetDb.gs) — every edit refreshes updatedAt */
  createdAt?: string
  updatedAt?: string
}

type TaskSeed = Omit<OpsTask, 'due'> & { dueInDays: number }
const task = (t: TaskSeed): OpsTask => {
  const { dueInDays, ...rest } = t
  return { ...rest, due: iso(addDays(now, dueInDays)) }
}

export const tasks: OpsTask[]  = withTenant([
  /* backlog */
  task({ id: 'tk-01', title: 'Draft winter visit contingency plan', description: 'Route backups and check-in protocol for snow days across all three houses.', column: 'backlog', assigneeId: 'p-04', priority: 'normal', dueInDays: 21, tint: 'blue', labels: ['planning', 'safety'] }),
  task({ id: 'tk-02', title: 'Order replacement pulse oximeters', description: 'Two units at Orchard Dale fail calibration; quote from Medline and McKesson.', column: 'backlog', assigneeId: 'p-09', priority: 'normal', dueInDays: 14, tint: 'peach', labels: ['supplies'] }),
  task({ id: 'tk-03', title: 'Review incident-report form wording', description: 'Legal flagged ambiguous wording in section 3 — propose a clearer draft.', column: 'backlog', assigneeId: 'p-12', priority: 'low', dueInDays: 28, tint: 'lavender', labels: ['admin', 'compliance'] }),
  task({ id: 'tk-04', title: 'Quarterly fire-drill scheduling', description: 'Coordinate with the fire department for all houses before the quarter ends.', column: 'backlog', assigneeId: 'p-05', priority: 'low', dueInDays: 35, tint: 'amber', labels: ['safety', 'scheduling'] }),
  /* this week */
  task({ id: 'tk-05', title: 'Restock PPE at Meadowlane', description: 'Gloves (L) and N95s are below reorder level — pull from central stock.', column: 'this-week', assigneeId: 'p-06', priority: 'high', dueInDays: 2, tint: 'peach', labels: ['supplies', 'PPE'] }),
  task({ id: 'tk-06', title: 'Update care plan — client R.T.', description: 'Reflect the new PT schedule and insulin sliding scale from Tuesday’s review.', column: 'this-week', assigneeId: 'p-07', priority: 'high', dueInDays: 3, tint: 'mint', labels: ['clinical'] }),
  task({ id: 'tk-07', title: 'Book CPR recertification (3 staff)', description: 'AHA BLS seats for next month — see expense report er-12.', column: 'this-week', assigneeId: 'p-03', priority: 'normal', dueInDays: 5, tint: 'lavender', labels: ['training'] }),
  /* in progress */
  task({ id: 'tk-08', title: 'Medication audit — 49th St', description: 'Full count incl. controlled cabinet; reconcile against the MAR sheets.', column: 'in-progress', assigneeId: 'p-11', priority: 'high', dueInDays: -1, tint: 'pink', labels: ['clinical', 'compliance'] }),
  task({ id: 'tk-09', title: 'Onboard weekend caregiver', description: 'Shadow shifts Fri–Sun, then solo sign-off with the house lead.', column: 'in-progress', assigneeId: 'p-05', priority: 'normal', dueInDays: 6, tint: 'blue', labels: ['hiring', 'training'] }),
  task({ id: 'tk-10', title: 'Fix Meadowlane van AC', description: 'Shop appointment booked; confirm courtesy vehicle for Thursday routes.', column: 'in-progress', assigneeId: 'p-01', priority: 'normal', dueInDays: 4, tint: 'amber', labels: ['maintenance', 'transport'] }),
  /* review */
  task({ id: 'tk-11', title: 'September mileage reconciliation', description: 'Cross-check submitted mileage reports against route logs before payroll.', column: 'review', assigneeId: 'p-04', priority: 'normal', dueInDays: 1, tint: 'blue', labels: ['finance', 'admin'] }),
  task({ id: 'tk-12', title: 'Supply-vendor price comparison', description: 'Gloves + wipes across three vendors; recommend a switch if savings > 8%.', column: 'review', assigneeId: 'p-10', priority: 'low', dueInDays: 7, tint: 'mint', labels: ['supplies', 'finance'] }),
  /* done */
  task({ id: 'tk-13', title: 'Flu-shot clinic signups', description: 'All three houses rostered; 41 of 48 staff signed up.', column: 'done', assigneeId: 'p-03', priority: 'normal', dueInDays: -6, tint: 'mint', labels: ['clinical', 'wellness'] }),
  task({ id: 'tk-14', title: 'Install grab bars — Orchard Dale bathroom', description: 'Two bars by the shower, one by the toilet; client J.B. mobility plan.', column: 'done', assigneeId: 'p-08', priority: 'high', dueInDays: -9, tint: 'amber', labels: ['maintenance', 'safety'] }),
  task({ id: 'tk-15', title: 'Publish updated visit checklist', description: 'Version 3.2 live in the Knowledge app — includes the new hand-off step.', column: 'done', assigneeId: 'p-02', priority: 'normal', dueInDays: -12, tint: 'lavender', labels: ['admin', 'documentation'] }),
  task({ id: 'tk-16', title: 'Renew liability insurance', description: 'Policy renewed with no premium change; certificate filed with the county.', column: 'done', assigneeId: 'p-04', priority: 'high', dueInDays: -15, tint: 'blue', labels: ['finance', 'compliance'] }),
])
