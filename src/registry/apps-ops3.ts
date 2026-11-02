// Client-ops suite registry (clientops-suite wave): 4 operational apps where caregivers CREATE records, not just…
// Mounting: each app is a single custom feature screen (src/pages/features/clientops/*) wired as a static route in…
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

/* ---------- Call Offs ---------- */

const callOffsPage: PageSchema = {
  id: 'log',
  type: 'sheet',
  title: 'Call Offs',
  icon: 'phone-off',
  dataSource: { resource: 'callOffs' },
  config: {
    entity: 'call-offs',
    // Read-only mirror of "Call Off and Late (Responses) › Master" — the estate's form stays the single writer, so…
    columns: [
      { key: 'employee_name', label: 'Staff' },
      { key: 'type', label: 'Type' },
      { key: 'date', label: 'Date' },
      { key: 'how_late', label: 'Late by' },
      { key: 'notes', label: 'Notes' },
    ],
  },
}

/* ---------- Dr Appointments ---------- */

const drAppointmentsPage: PageSchema = {
  id: 'upcoming',
  type: 'sheet',
  title: 'Dr Appointments',
  icon: 'stethoscope',
  dataSource: { resource: 'drAppointments' },
  config: {
    entity: 'appointments',
    // Read-only mirror of "Dr Appointments (Responses) › Dr Master".
    columns: [
      { key: 'client', label: 'Client' },
      { key: 'specialist', label: 'Specialist' },
      { key: 'dr_name', label: 'Doctor' },
      { key: 'next_visit', label: 'Next visit' },
      { key: 'status', label: 'Status' },
    ],
  },
}

/* ---------- UI Reports ---------- */

const uiIncidentsPage: PageSchema = {
  id: 'log',
  type: 'sheet',
  title: 'UI Reports',
  icon: 'triangle-alert',
  dataSource: { resource: 'uiIncidents' },
  config: {
    entity: 'UI reports',
    // Read-only mirror of "Asa | UIs and MUIs (Responses) › UIs and MUIs".
    columns: [
      { key: 'incident_date', label: 'Date' },
      { key: 'incident_category', label: 'Category' },
      { key: 'client_name', label: 'Client' },
      { key: 'incident_location', label: 'Location' },
      { key: 'your_name', label: 'Reported by' },
    ],
  },
}

/* ---------- House Repair ---------- */

const houseRepairPage: PageSchema = {
  id: 'orders',
  type: 'sheet',
  title: 'House Repair',
  icon: 'wrench',
  dataSource: { resource: 'workOrders' },
  config: {
    entity: 'repair requests',
    // Read-only mirror of "House Repair Requests › Repairs".
    columns: [
      { key: 'select_address_vehicle', label: 'House / vehicle' },
      { key: 'repair_type', label: 'Type' },
      { key: 'please_describe_the_issue', label: 'Issue' },
      { key: 'urgency_level', label: 'Urgency' },
      { key: 'status', label: 'Status' },
    ],
  },
}

// The house repair book kept in Postgres (app/sheet_resources.py repairRequests / repairInventory): answered, added and
// removed here, behind App Control's house-repair.manage control — the master's alone until released.
// the sheet's own words; a request nobody has answered yet has none
const REPAIR_STATUS = ['In Progress', 'On-Hold', 'Completed']
const REPAIR_FIELDS = [
  { key: 'Status', label: 'Status', type: 'select', options: REPAIR_STATUS },
  { key: 'Resolution Notes', label: 'Resolution notes', type: 'textarea' },
  { key: 'Select Address/vehicle', label: 'Address / vehicle', required: true },
  { key: 'Repair Type', label: 'Repair type' },
  { key: 'Please describe the issue.', label: 'The issue', type: 'textarea', required: true },
  { key: 'Urgency Level (1-Low : 5-High)', label: 'Urgency (1 low – 5 high)', type: 'select',
    options: ['1', '2', '3', '4', '5'] },
  { key: 'Timestamp', label: 'Requested', placeholder: 'MM/DD/YYYY HH:MM:SS' },
]
const manageRepairsPage: PageSchema = {
  id: 'manage', type: 'sheet', title: 'Manage repairs', icon: 'hammer', feature: 'house-repair.manage',
  dataSource: { resource: 'repairRequests' as PageSchema['dataSource']['resource'] },
  config: {
    entity: ['repair request', 'repair requests'],
    searchable: true,
    searchPlaceholder: 'Search repairs…',
    primaryAction: { label: 'New repair request', icon: 'plus', form: {
      title: 'New repair request', resource: 'repairRequests', perm: 'people.edit',
      fields: REPAIR_FIELDS.filter((f) => f.key !== 'Resolution Notes') } },
    editForm: { title: 'Answer repair request', resource: 'repairRequests', perm: 'people.edit', fields: REPAIR_FIELDS },
    rowDelete: { perm: 'people.edit' },
    columns: [
      { key: 'Timestamp', label: 'Requested', kind: 'text', sortable: true },
      { key: 'Select Address/vehicle', label: 'Address / vehicle', kind: 'text', sortable: true },
      { key: 'Repair Type', label: 'Type', kind: 'chip' },
      { key: 'Please describe the issue.', label: 'Issue', kind: 'text', width: 360 },
      { key: 'Urgency Level (1-Low : 5-High)', label: 'Urgency', kind: 'text', sortable: true },
      { key: 'Status', label: 'Status', kind: 'chip', dot: true, sortable: true,
        tintBy: { 'In Progress': 'blue', 'On-Hold': 'amber', Completed: 'mint' } },
      { key: 'Resolution Notes', label: 'Resolution', kind: 'text' },
    ],
    filters: [{ key: 'Status', label: 'Status', options: REPAIR_STATUS }],
    rowActions: [
      { id: 'edit', label: 'Answer request', icon: 'pencil' },
      { id: 'delete', label: 'Remove request', icon: 'trash-2' },
    ],
    pagination: { pageSize: 25 },
  },
}
const INVENTORY_FIELDS = [
  { key: 'Item', label: 'Item', required: true },
  { key: 'Address', label: 'Address', required: true },
  { key: 'Cost to Replace', label: 'Cost to replace' },
  { key: 'Current \nCondition', label: 'Current condition' },
  { key: 'Est Expiration Year', label: 'Est. expiration year' },
  { key: 'Replacement Frequency', label: 'Replacement frequency' },
]
const houseInventoryPage: PageSchema = {
  id: 'inventory', type: 'sheet', title: 'House inventory', icon: 'package', feature: 'house-repair.manage',
  dataSource: { resource: 'repairInventory' as PageSchema['dataSource']['resource'] },
  config: {
    entity: ['item', 'items'],
    searchable: true,
    searchPlaceholder: 'Search inventory…',
    primaryAction: { label: 'Add item', icon: 'plus', form: {
      title: 'Add inventory item', resource: 'repairInventory', perm: 'people.edit', fields: INVENTORY_FIELDS } },
    editForm: { title: 'Edit item', resource: 'repairInventory', perm: 'people.edit', fields: INVENTORY_FIELDS },
    rowDelete: { perm: 'people.edit' },
    columns: [
      { key: 'Item', label: 'Item', kind: 'text', sortable: true },
      { key: 'Address', label: 'Address', kind: 'text', sortable: true },
      { key: 'Current \nCondition', label: 'Condition', kind: 'chip' },
      { key: 'Cost to Replace', label: 'Cost', kind: 'text' },
      { key: 'Est Expiration Year', label: 'Expires', kind: 'text', sortable: true },
      { key: 'Replacement Frequency', label: 'Replace every', kind: 'text' },
    ],
    rowActions: [
      { id: 'edit', label: 'Edit item', icon: 'pencil' },
      { id: 'delete', label: 'Remove item', icon: 'trash-2' },
    ],
    pagination: { pageSize: 25 },
  },
}

/* ---------- manifests ---------- */

export const opsSuiteManifests: AppManifest[] = [
  {
    id: 'call-offs', name: 'Call Offs', tagline: 'Same-day call-offs and shift coverage status',
    icon: 'phone-off', accent: 'pink', category: 'Operations', version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true, enabled: true, pages: [callOffsPage], notifications: ['app', 'reminder'],
  },
  {
    id: 'dr-appointments', name: 'Dr Appointments', tagline: 'Doctor visits with caregiver transport',
    icon: 'stethoscope', accent: 'blue', category: 'Operations', version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true, enabled: true, pages: [drAppointmentsPage], notifications: ['app', 'reminder'],
  },
  {
    id: 'ui-incidents', name: 'UI Reports', tagline: 'Unusual incidents, review trail and MUI escalation',
    icon: 'triangle-alert', accent: 'amber', category: 'Operations', version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true, enabled: true, pages: [uiIncidentsPage], notifications: ['app'],
  },
  {
    id: 'house-repair', name: 'House Repair', tagline: 'Maintenance work orders across the houses',
    icon: 'wrench', accent: 'lavender', category: 'Operations', version: '1.0.0',
    audience: ['all', 'staff'],
    isNew: true, enabled: true, pages: [houseRepairPage, manageRepairsPage, houseInventoryPage], notifications: ['app'],
  },
]

// Self-registration: registry/apps.ts is off-limits this wave, so importing this module appends the manifests to…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  const missing = opsSuiteManifests.filter((m) => !registered.some((a) => a.id === m.id))
  if (missing.length) useRegistryStore.setState({ apps: [...registered, ...missing] })
})
