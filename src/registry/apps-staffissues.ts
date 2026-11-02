// STAFF ISSUES — the estate's live HR tracker, as an app of its own.
// WHY IT IS NOT A PAGE OF WORKFORCE COMPLIANCE ANY MORE.
import type { AppManifest, PageSchema } from '@/engine/types'

// The schema stays the slice's manifest hook AND the graceful fallback: its columns are the slice's own fields, so…
const trackerPage: PageSchema = {
  id: 'tracker',
  type: 'sheet',
  title: 'Staff Issues',
  icon: 'alert-octagon',
  dataSource: { resource: 'staffIssues' },
  config: {
    entity: ['staff issue', 'staff issues'],
    customFeature: 'staffissues/StaffIssuesPage',
    columns: [
      { key: 'date', label: 'Date', kind: 'date', sortable: true, width: 110 },
      { key: 'employees_involved', label: 'Employees involved', kind: 'text', primary: true, sortable: true, width: 220 },
      { key: 'situation', label: 'Situation', kind: 'text' },
      { key: 'follow_up', label: 'Follow up', kind: 'text' },
      { key: 'disciplinary_action', label: 'Action', kind: 'text' },
      { key: 'result', label: 'Result', kind: 'text' },
    ],
    pagination: { pageSize: 25 },
  },
}

// The tracker kept in Postgres (app/sheet_resources.py hrTracker): every row edited, added and removed here, behind App
// Control's staffissues.manage control — the master's alone until released.
const ISSUE_ACTIONS = ['Monitoring', '1st Warning', '2nd Warning', 'Final Warning', 'Not at this time', 'Terminated',
  'Quit']
const ISSUE_FIELDS = [
  { key: 'Date', label: 'Date', placeholder: 'MM/DD/YYYY', required: true },
  { key: 'Employees Involved', label: 'Employees involved', required: true },
  { key: 'Situation', label: 'Situation', type: 'textarea', required: true },
  { key: 'Follow up', label: 'Follow up', type: 'textarea' },
  { key: 'Disciplinary Action', label: 'Disciplinary action', type: 'select', options: ISSUE_ACTIONS },
  { key: 'Result', label: 'Result', type: 'textarea' },
  { key: 'Termination summary', label: 'Termination summary', type: 'textarea' },
]
const manageIssuesPage: PageSchema = {
  id: 'manage', type: 'sheet', title: 'Manage issues', icon: 'pencil-line', feature: 'staffissues.manage',
  dataSource: { resource: 'hrTracker' as PageSchema['dataSource']['resource'] },
  config: {
    entity: ['issue', 'issues'],
    searchable: true,
    searchPlaceholder: 'Search issues…',
    primaryAction: { label: 'New issue', icon: 'plus', form: {
      title: 'New staff issue', resource: 'hrTracker', perm: 'people.edit', wide: true, fields: ISSUE_FIELDS } },
    editForm: { title: 'Edit staff issue', resource: 'hrTracker', perm: 'people.edit', fields: ISSUE_FIELDS },
    rowDelete: { perm: 'people.edit' },
    columns: [
      { key: 'Date', label: 'Date', kind: 'text', sortable: true, width: 110 },
      { key: 'Employees Involved', label: 'Employees involved', kind: 'text', sortable: true, width: 220 },
      { key: 'Situation', label: 'Situation', kind: 'text', width: 320 },
      { key: 'Disciplinary Action', label: 'Action', kind: 'chip', sortable: true },
      { key: 'Follow up', label: 'Follow up', kind: 'text' },
      { key: 'Result', label: 'Result', kind: 'text' },
    ],
    filters: [{ key: 'Disciplinary Action', label: 'Action', options: ISSUE_ACTIONS }],
    rowActions: [
      { id: 'edit', label: 'Edit issue', icon: 'pencil' },
      { id: 'delete', label: 'Remove issue', icon: 'trash-2' },
    ],
    pagination: { pageSize: 25 },
  },
}

export const staffIssuesManifests: AppManifest[] = [
  {
    id: 'staffissues',
    name: 'Staff Issues',
    tagline: "The estate's HR tracker — what happened, what was done, how it ended",
    icon: 'alert-octagon',
    accent: 'amber',
    category: 'Manage',
    version: '1.0.0',
    audience: ['admin', 'manager'],
    enabled: true,
    pages: [trackerPage, manageIssuesPage],
  },
]
