// CURATED BUNDLE — Incident Quick Log.
// A sheet with the create/edit forms switched on, so logging an incident takes under a minute — plus a dashboard…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const incidentLog: CuratedBundle = {
  id: 'incident-log',
  blurb: 'Log an incident in under a minute; the dashboard keeps the pattern visible.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Incident Log',
      tagline: 'Log an incident in under a minute, review them together.',
      icon: 'siren',
      accent: 'pink',
      category: 'Care',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'incidents',
          type: 'sheet',
          title: 'Incidents',
          resource: '',
          config: {
            entity: ['incident', 'incidents'],
            searchable: true,
            selectable: true,
            densityToggle: true,
            columns: [
              { key: 'summary', label: 'What happened', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'kind', label: 'Kind', kind: 'chip', tintBy: { Fall: 'pink', Medication: 'amber', Behaviour: 'blue', Other: 'lavender' } },
              { key: 'severity', label: 'Severity', kind: 'chip', tintBy: { High: 'pink', Medium: 'amber', Low: 'mint' } },
              { key: 'when', label: 'When', kind: 'date' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { Open: 'amber', Reviewed: 'mint' } },
            ],
            headerActions: [
              { id: 'log-incident', label: 'Log incident', icon: 'plus', kind: 'create',
                payload: { summary: 'New incident — describe what happened', house: 'Maple House', kind: 'Other', severity: 'Low', when: '{today}', status: 'Open' },
                toast: 'Incident logged — fill in the details.' },
            ],
            rowActions: [
              { id: 'mark-reviewed', label: 'Mark reviewed', icon: 'check', quick: true, kind: 'patch',
                when: { field: 'status', eq: 'Open' },
                patch: { status: 'Reviewed' },
                toast: 'Incident marked as reviewed.' },
              // Incidents are safeguarding records: deleting one takes a manager permission AND a confirmation that…
              { id: 'delete-incident', label: 'Delete incident', icon: 'trash-2', danger: true, kind: 'delete', perm: 'clients.edit',
                when: { field: 'status', eq: 'Reviewed' },
                confirm: 'Delete "{row.summary}"? Incidents are safeguarding records — this cannot be undone.',
                toast: 'Incident deleted.' },
            ],
          },
          rows: [
            { id: 'row-1', summary: 'Resident slipped in the bathroom, no injury', house: 'Maple House', kind: 'Fall', severity: 'Medium', when: isoDay(0), status: 'Open' },
            { id: 'row-2', summary: 'Evening dose refused twice', house: 'Maple House', kind: 'Medication', severity: 'Medium', when: isoDay(-1), status: 'Open' },
            { id: 'row-3', summary: 'Distress during personal care, settled with music', house: 'Birch House', kind: 'Behaviour', severity: 'Low', when: isoDay(-2), status: 'Reviewed' },
            { id: 'row-4', summary: 'Unwitnessed fall in the garden, graze on elbow', house: 'Cedar House', kind: 'Fall', severity: 'High', when: isoDay(-3), status: 'Reviewed' },
            { id: 'row-5', summary: 'Wrong key taken for medication cabinet', house: 'Birch House', kind: 'Other', severity: 'Low', when: isoDay(-4), status: 'Reviewed' },
            { id: 'row-6', summary: 'Missed signature on the MAR chart', house: 'Maple House', kind: 'Medication', severity: 'Low', when: isoDay(-6), status: 'Reviewed' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
        {
          id: 'trends',
          type: 'dashboard',
          title: 'This month',
          resource: '',
          config: {
            greeting: { name: 'Incidents', subtitle: 'The month at a glance — kinds, severity and what is still open.' },
            widgets: [
              { kind: 'stat', label: 'Logged this month', value: '6', delta: '-2', deltaLabel: 'vs last month', tint: 'mint', spark: [4, 5, 3, 6, 5, 4, 6] },
              { kind: 'stat', label: 'Awaiting review', value: '2', tint: 'amber', spark: [1, 2, 1, 3, 2, 2, 2] },
              { kind: 'donut', title: 'By kind', slices: [
                { label: 'Fall', value: 2, tint: 'pink' },
                { label: 'Medication', value: 2, tint: 'amber' },
                { label: 'Behaviour', value: 1, tint: 'blue' },
                { label: 'Other', value: 1, tint: 'lavender' },
              ], centerLabel: 'incidents' },
              { kind: 'note', title: 'Review rhythm', tint: 'blue', text: 'Open incidents are reviewed at the Monday managers’ sync — none should stay open past a week.' },
            ],
          },
          rows: [
            { id: 'row-1', name: 'Bathroom slip — no injury', status: 'Open', owner: 'Maple House', updated: isoDay(0), score: 3 },
            { id: 'row-2', name: 'Evening dose refused', status: 'Open', owner: 'Maple House', updated: isoDay(-1), score: 3 },
            { id: 'row-3', name: 'Distress during personal care', status: 'Reviewed', owner: 'Birch House', updated: isoDay(-2), score: 2 },
            { id: 'row-4', name: 'Garden fall — graze', status: 'Reviewed', owner: 'Cedar House', updated: isoDay(-3), score: 4 },
          ],
        },
      ],
    },
  },
}
