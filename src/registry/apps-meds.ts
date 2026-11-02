// Meds-suite registry (medications wave): two custom-feature apps — Medications (per-person photo/dose cards, MARS…
// Pages are custom feature screens mounted through the CUSTOM_PAGES map in src/pages/AppRoutePage.tsx; the declared…
import type { AppManifest, PageSchema } from '@/engine/types'

const medicationsPage: PageSchema = {
  id: 'meds',
  type: 'sheet', // fallback generic type — CUSTOM_PAGES mounts MedicationsPage
  title: 'Medications',
  icon: 'pill',
  dataSource: { resource: 'medications' },
  config: { custom: 'meds-suite/medications' },
}

const medDeliveriesPage: PageSchema = {
  id: 'deliveries',
  type: 'sheet', // fallback generic type — CUSTOM_PAGES mounts MedDeliveriesPage
  title: 'Med Deliveries',
  icon: 'truck',
  dataSource: { resource: 'medDeliveries' },
  config: { custom: 'meds-suite/deliveries' },
}

// THE CORRELATION STUDY (kill list 7 of the coverage ledger) — Med Errors (MARS) × Missing Meds, the old platform's…
const medCorrelationPage: PageSchema = {
  id: 'correlation',
  type: 'sheet', // fallback generic type — CUSTOM_PAGES mounts MedCorrelationPage
  title: 'Med Correlation',
  icon: 'git-compare',
  dataSource: { resource: 'medCorrelation' },
  config: { entity: ['correlation', 'correlations'], customFeature: 'meds/MedCorrelationPage' },
}

// THE CATALOGUE — the medicine cabinet, with nobody's name on it: a place to review and add new medications, with…
const medCatalogPage: PageSchema = {
  id: 'catalogue',
  type: 'sheet',
  title: 'Medication Catalogue',
  icon: 'library',
  dataSource: { resource: 'medCatalog' },
  config: {
    entity: ['medication', 'medications'],
    searchable: true,
    searchPlaceholder: 'Search the cabinet…',
    primaryAction: { label: 'Add medication', icon: 'plus' },
    rowHeight: 56,
    columns: [
      { key: 'name', label: 'Medication', kind: 'text', sortable: true, subKey: 'strengths', width: 260 },
      { key: 'forms', label: 'Form', kind: 'chip', tintBy: { Tablet: 'blue', Pill: 'blue', Capsule: 'lavender', Liquid: 'pink', Cream: 'peach', Inhaler: 'mint', Injection: 'amber' } },
      { key: 'is_controlled', label: 'Controlled', kind: 'chip', dot: true, tintBy: { yes: 'pink', no: 'mint' } },
      { key: 'instructions', label: 'Label says', kind: 'text' },
      { key: 'seen_count', label: 'Mentions', kind: 'number', sortable: true },
      { key: 'review_state', label: 'Review', kind: 'chip', dot: true, tintBy: { unreviewed: 'amber', reviewed: 'mint', retired: 'danger' } },
    ],
    filters: [
      { key: 'review_state', label: 'Review', options: ['unreviewed', 'reviewed', 'retired'] },
      { key: 'is_controlled', label: 'Controlled', options: ['yes', 'no'] },
    ],
    pagination: { pageSize: 20 },
    detailPanel: {
      header: { title: 'name', subtitle: 'strengths',
                statusChip: { field: 'review_state', tintBy: { unreviewed: 'amber', reviewed: 'mint', retired: 'danger' } } },
      sections: [
        { kind: 'fields', title: 'The medicine', fields: [
          { icon: 'pill', label: 'Name', value: 'name' },
          { icon: 'ruler', label: 'Strengths seen', value: 'strengths' },
          { icon: 'layers', label: 'Forms seen', value: 'forms' },
          { icon: 'file-text', label: 'Label instructions', value: 'instructions' },
          { icon: 'shield-alert', label: 'Controlled', value: 'is_controlled' },
          { icon: 'clock', label: 'Schedule words seen', value: 'prn' },
        ] },
        { kind: 'fields', title: 'Where it came from', fields: [
          { icon: 'database', label: 'Sources', value: 'sources' },
          { icon: 'hash', label: 'Mentions', value: 'seen_count' },
          { icon: 'user-check', label: 'Reviewed by', value: 'reviewed_by' },
          { icon: 'notebook-pen', label: 'Notes', value: 'notes' },
        ] },
      ],
    },
  },
}

// The Missing Medications book kept in Postgres (app/sheet_resources.py mm* houses): its forms' requests, the low
// refills, the medication control and the doctors, worked here behind App Control's medications.missing control — the
// master's alone until released.
type BookField = { key: string; label: string; type?: string }
function missingMedsPage(id: string, title: string, icon: string, resource: string, shown: string[],
                         fields: BookField[]): PageSchema {
  const form = { resource, perm: 'people.edit' as const, fields: fields.map((f) => ({ ...f })) }
  return {
    id, type: 'sheet', title, icon, feature: 'medications.missing',
    dataSource: { resource: resource as PageSchema['dataSource']['resource'] },
    config: {
      entity: ['row', 'rows'],
      searchable: true,
      primaryAction: { label: 'Add', icon: 'plus', form: { title: `Add to ${title}`, ...form } },
      editForm: { title: `Edit — ${title}`, ...form },
      rowDelete: { perm: 'people.edit' },
      columns: shown.map((k) => ({ key: k, label: fields.find((f) => f.key === k)?.label ?? k, sortable: true,
                                   kind: k === 'Status' ? 'chip' : 'text' })),
      filters: shown.includes('Status') ? [{ key: 'Status', label: 'Status', options: [] }] : [],
      rowActions: [{ id: 'edit', label: 'Edit', icon: 'pencil' }, { id: 'delete', label: 'Remove', icon: 'trash-2' }],
      pagination: { pageSize: 25 },
    },
  }
}
const f = (key: string, label?: string, type?: string): BookField => ({ key, label: label ?? key, ...(type ? { type } : {}) })
const missingMedsPages: PageSchema[] = [
  missingMedsPage('missing-requests', 'Missing meds requests', 'pill', 'mmFormResponses4',
    ['Timestamp', 'Your Name', 'Select Client:', "What's the issue related?", 'Expected date to run out of medication', 'Status'],
    [f('Status'), f('Timestamp'), f('Your Name', 'Filed by'), f('Select Client:', 'Client'),
     f("What's the issue related?", 'Issue'), f('Expected date to run out of medication', 'Runs out'),
     f('If you don’t see the missing medication above, please tell us here:', 'Not listed', 'textarea'),
     f('Column 1', 'Note 1'), f('Column 2', 'Note 2')]),
  missingMedsPage('missing-earlier', 'Earlier requests', 'history', 'mmFormResponses1',
    ['Timestamp', 'Client Name', 'House', 'Medication(s) Name', 'Dr', 'Status'],
    [f('Status'), f('Timestamp'), f('Your Name', 'Filed by'), f('Client Name', 'Client'), f('House'),
     f('Medication(s) Name', 'Medication(s)'), f('Dr'), f('OTC'), f('Issue Description', 'Issue', 'textarea'),
     f('Expected date to run out of medication', 'Runs out'), f('Notes', 'Notes', 'textarea')]),
  missingMedsPage('low-refills', 'Low refills', 'battery-low', 'mmLowRefills',
    ['Client', 'House', 'Med', 'Dr', '# of Refills', 'Status'],
    [f('Status'), f('House'), f('Manager'), f('Client'), f('Client Bday', 'Client birthday'), f('Med', 'Medication'),
     f('Dr'), f('Dr #', 'Dr phone'), f('# of Refills', 'Refills left'), f('OTC'), f('Important Med?'),
     f('Notes', 'Notes', 'textarea'), f('Contact Dr', 'Dr contacted'), f("Finney's Received")]),
  missingMedsPage('med-control', 'Medication control', 'clipboard-list', 'mmMedicationControl',
    ['Client Name', 'Medication Name', 'Qty Remaining', 'Next Refill Due', 'Refill Status'],
    [f('Client Name', 'Client'), f('Medication Name', 'Medication'), f('Physician Name', 'Physician'),
     f('Physian NO.', 'Physician phone'), f('Qty Written'), f('Qty Dispensed'), f('Qty Remaining'), f('Days Supply'),
     f('Next Refill Due'), f('Refill Status'), f('Notes / Action Needed', 'Notes', 'textarea'), f('Buffer Days')]),
  missingMedsPage('drs-meds', 'Doctors & meds', 'stethoscope', 'mmDrsMeds',
    ['Client', 'Medication', 'Daily/PRN', 'Dr', 'Status'],
    [f('Status'), f('Client'), f('Birthdate'), f('Medication'), f('Daily/PRN'), f('Dr'), f('P.Number', 'Dr phone'),
     f('Fax'), f('Dr. contacted?'), f("Finney's"), f('Instructions', 'Instructions', 'textarea')]),
  missingMedsPage('dr-contacts', 'Doctor contacts', 'contact', 'mmDrContacts',
    ['Client', 'DR', 'DR No.', 'Fax', 'Status'],
    [f('Status'), f('Client'), f('DR', 'Doctor'), f('DR No.', 'Doctor phone'), f('Fax'), f('Fax accepted'),
     f('Refill email')]),
  missingMedsPage('abnormal-deliveries', 'Abnormal deliveries', 'package-x', 'mmAbnormalDeliveries',
    ['Client Name', 'House', 'Medication(s) Name', 'Dr', 'Schedule'],
    [f('Client Name', 'Client'), f('House'), f('Medication(s) Name', 'Medication(s)'), f('Dr'), f('OTC'),
     f('Schedule')]),
]

export const medsSuiteManifests: AppManifest[] = [
  {
    id: 'medications',
    name: 'Medications',
    tagline: 'Per-person med cards with doses and MARS',
    icon: 'pill',
    accent: 'mint',
    category: 'Care',
    version: '1.0.0',
    // CLIENT IS IN THE AUDIENCE: Medications opens for them too.
    audience: ['admin', 'manager', 'staff', 'client'],
    isNew: true,
    enabled: true,
    pages: [medicationsPage, medCatalogPage, medCorrelationPage, ...missingMedsPages],
    notifications: ['reminder'],
  },
  {
    id: 'med-deliveries',
    name: 'Med Deliveries',
    tagline: 'Deliveries, remaining counts and flags',
    icon: 'truck',
    accent: 'amber',
    category: 'Care',
    version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true,
    enabled: true,
    pages: [medDeliveriesPage],
    notifications: ['app'],
  },
]
