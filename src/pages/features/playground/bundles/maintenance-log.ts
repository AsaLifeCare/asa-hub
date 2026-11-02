// CURATED BUNDLE — Maintenance Log.
// A sheet of open repairs (anyone can report one from the create form) and a timeline of what happened to each…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const maintenanceLog: CuratedBundle = {
  id: 'maintenance-log',
  blurb: 'Report a repair in one tap and follow it until it is fixed.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Maintenance Log',
      tagline: 'Report, track and close house repairs.',
      icon: 'wrench',
      accent: 'peach',
      category: 'Operations',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'requests',
          type: 'sheet',
          title: 'Repairs',
          resource: '',
          config: {
            entity: ['repair', 'repairs'],
            searchable: true,
            selectable: true,
            densityToggle: true,
            columns: [
              { key: 'issue', label: 'Issue', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'priority', label: 'Priority', kind: 'chip', tintBy: { Urgent: 'pink', Normal: 'amber', 'When possible': 'blue' } },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { Open: 'amber', 'In progress': 'blue', Fixed: 'mint' } },
              { key: 'reported', label: 'Reported', kind: 'date' },
            ],
            rowActions: [
              // A follow-up is a NEW row seeded from the one on screen — the payload interpolates…
              { id: 'log-follow-up', label: 'Log follow-up', icon: 'copy-plus', kind: 'create',
                payload: { issue: 'Follow-up: {row.issue}', house: '{row.house}', priority: 'Normal', status: 'Open', reported: '{today}' },
                toast: 'Follow-up logged.' },
              // Only closed-out repairs may leave the log — open work never gets a delete button.
              { id: 'delete-repair', label: 'Delete entry', icon: 'trash-2', danger: true, kind: 'delete',
                when: { field: 'status', eq: 'Fixed' },
                confirm: 'Delete "{row.issue}"? Fixed entries stay on the History timeline.',
                toast: 'Repair entry deleted.' },
            ],
          },
          rows: [
            { id: 'row-1', issue: 'Boiler pressure drops overnight', house: 'Maple House', priority: 'Urgent', status: 'In progress', reported: isoDay(-2) },
            { id: 'row-2', issue: 'Grab bar loose in bathroom 2', house: 'Maple House', priority: 'Urgent', status: 'Fixed', reported: isoDay(-6) },
            { id: 'row-3', issue: 'Kitchen tap drips', house: 'Birch House', priority: 'Normal', status: 'Open', reported: isoDay(-1) },
            { id: 'row-4', issue: 'Garden gate latch broken', house: 'Birch House', priority: 'Normal', status: 'In progress', reported: isoDay(-3) },
            { id: 'row-5', issue: 'Hallway light flickers', house: 'Cedar House', priority: 'When possible', status: 'Open', reported: isoDay(0) },
            { id: 'row-6', issue: 'Washing machine door seal', house: 'Cedar House', priority: 'Normal', status: 'Fixed', reported: isoDay(-9) },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
        {
          id: 'history',
          type: 'timeline',
          title: 'History',
          resource: '',
          config: {
            timeKey: 'at',
            titleKey: 'title',
            bodyKey: 'detail',
            actorKey: 'actor',
            kindKey: 'kind',
            kindTints: { reported: 'amber', updated: 'blue', fixed: 'mint', note: 'lavender' },
          },
          rows: [
            { id: 'ev-1', at: isoDay(0), title: 'Plumber booked', detail: 'Boiler service confirmed for tomorrow morning', actor: 'Pat Morgan', kind: 'updated' },
            { id: 'ev-2', at: isoDay(-1), title: 'Kitchen tap reported', detail: 'Drips constantly — bucket underneath for now', actor: 'Maya Chen', kind: 'reported' },
            { id: 'ev-3', at: isoDay(-2), title: 'Grab bar fixed', detail: 'Re-anchored into the stud, tested with full weight', actor: 'Handyman (Tony)', kind: 'fixed' },
            { id: 'ev-4', at: isoDay(-3), title: 'Gate latch photos taken', detail: 'Sent to the fencing contractor for a quote', actor: 'Chris Young', kind: 'note' },
            { id: 'ev-5', at: isoDay(-6), title: 'Boiler issue reported', detail: 'Pressure gauge reads zero after cold nights', actor: 'Sam Lee', kind: 'reported' },
          ],
        },
      ],
    },
  },
}
