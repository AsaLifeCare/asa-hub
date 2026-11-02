// CURATED BUNDLE — Visitor Log.
// Who is in the house, visiting whom, right now: sign in from the header (create), sign out from the row (patch)…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const visitorLog: CuratedBundle = {
  id: 'visitor-log',
  blurb: 'Sign visitors in and out — one page, under a minute per entry.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Visitor Log',
      tagline: 'Who is in the house, visiting whom, right now.',
      icon: 'door-open',
      accent: 'peach',
      category: 'Care',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'visitors',
          type: 'sheet',
          title: 'Visitors',
          resource: '',
          config: {
            entity: ['visit', 'visits'],
            searchable: true,
            selectable: true,
            densityToggle: true,
            columns: [
              { key: 'visitor', label: 'Visitor', kind: 'text' },
              { key: 'visiting', label: 'Visiting', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'purpose', label: 'Purpose', kind: 'chip', tintBy: { 'Family visit': 'mint', Friend: 'blue', Professional: 'lavender', Volunteer: 'peach' } },
              { key: 'arrived', label: 'Arrived', kind: 'date' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { 'On site': 'amber', Left: 'mint' } },
            ],
            headerActions: [
              { id: 'sign-in', label: 'Sign visitor in', icon: 'plus', kind: 'create',
                payload: { visitor: 'New visitor', visiting: '', house: 'Maple House', purpose: 'Family visit', arrived: '{today}', status: 'On site' },
                toast: 'Visitor signed in — add their name.' },
            ],
            rowActions: [
              { id: 'sign-out', label: 'Sign out', icon: 'log-out', quick: true, kind: 'patch',
                when: { field: 'status', eq: 'On site' },
                patch: { status: 'Left' },
                toast: '{row.visitor} signed out.' },
              { id: 'remove-entry', label: 'Remove entry', icon: 'trash-2', danger: true, kind: 'delete',
                confirm: 'Remove {row.visitor}’s visit from the log? This cannot be undone.',
                toast: 'Entry removed.' },
            ],
          },
          rows: [
            { id: 'row-1', visitor: 'Sarah Thompson', visiting: 'John (brother)', house: 'Maple House', purpose: 'Family visit', arrived: isoDay(0), status: 'On site' },
            { id: 'row-2', visitor: 'Dr. Ellen Fry', visiting: 'Mary — medication review', house: 'Maple House', purpose: 'Professional', arrived: isoDay(0), status: 'On site' },
            { id: 'row-3', visitor: 'Tom Baker', visiting: 'Arthur (old friend)', house: 'Cedar House', purpose: 'Friend', arrived: isoDay(0), status: 'Left' },
            { id: 'row-4', visitor: 'Green Fingers Club', visiting: 'Garden project', house: 'Birch House', purpose: 'Volunteer', arrived: isoDay(-1), status: 'Left' },
            { id: 'row-5', visitor: 'Priya Shah', visiting: 'Ruth (daughter)', house: 'Birch House', purpose: 'Family visit', arrived: isoDay(-1), status: 'Left' },
            { id: 'row-6', visitor: 'Physio — Mark Ellis', visiting: 'Weekly session', house: 'Cedar House', purpose: 'Professional', arrived: isoDay(-2), status: 'Left' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
