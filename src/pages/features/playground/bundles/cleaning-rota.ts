// CURATED BUNDLE — Cleaning Rota.
// The week's housekeeping, one row per job: claim it from the row, mark it done, and the deep-cleans that keep…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const cleaningRota: CuratedBundle = {
  id: 'cleaning-rota',
  blurb: 'The week\'s housekeeping — claim a job, close a job.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Cleaning Rota',
      tagline: 'Every job named, claimed and closed.',
      icon: 'sparkles',
      accent: 'lavender',
      category: 'Operations',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'rota',
          type: 'sheet',
          title: 'This week',
          resource: '',
          config: {
            entity: ['job', 'jobs'],
            searchable: true,
            densityToggle: true,
            columns: [
              { key: 'job', label: 'Job', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'due', label: 'Due', kind: 'date' },
              { key: 'owner', label: 'Claimed by', kind: 'text' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { Open: 'amber', Claimed: 'blue', Done: 'mint' } },
            ],
            headerActions: [
              { id: 'add-job', label: 'Add a job', icon: 'plus', kind: 'create',
                payload: { job: '', house: 'Maple House', due: '{today}', owner: '', status: 'Open' },
                toast: 'Job added — name it.' },
            ],
            rowActions: [
              { id: 'claim-job', label: 'Claim it', icon: 'hand', quick: true, kind: 'patch',
                when: { field: 'status', eq: 'Open' },
                patch: { status: 'Claimed' },
                toast: 'Claimed — put your name on the row.' },
              { id: 'close-job', label: 'Done', icon: 'check', quick: true, kind: 'patch',
                when: { field: 'status', neq: 'Done' },
                patch: { status: 'Done' }, toast: '{row.job} closed.' },
            ],
          },
          rows: [
            { id: 'row-1', job: 'Deep-clean kitchen', house: 'Maple House', due: isoDay(1), owner: '', status: 'Open' },
            { id: 'row-2', job: 'Bathrooms — full', house: 'Birch House', due: isoDay(0), owner: 'Dana W.', status: 'Claimed' },
            { id: 'row-3', job: 'Van interior', house: 'Cedar House', due: isoDay(-1), owner: 'Marcus C.', status: 'Done' },
            { id: 'row-4', job: 'Laundry room + filters', house: 'Maple House', due: isoDay(2), owner: '', status: 'Open' },
            { id: 'row-5', job: 'Windows — ground floor', house: 'Cedar House', due: isoDay(3), owner: '', status: 'Open' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
