// CURATED BUNDLE — Grocery Runs.
// Each house's shopping run: what is needed, who is going, what came back.
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const groceryRuns: CuratedBundle = {
  id: 'grocery-runs',
  blurb: 'Every house shopping run — the list, the runner, the receipt.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Grocery Runs',
      tagline: 'What each house needs, who is getting it.',
      icon: 'shopping-cart',
      accent: 'mint',
      category: 'Operations',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'runs',
          type: 'sheet',
          title: 'Runs',
          resource: '',
          config: {
            entity: ['run', 'runs'],
            searchable: true,
            densityToggle: true,
            columns: [
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'day', label: 'Day', kind: 'date' },
              { key: 'runner', label: 'Runner', kind: 'text' },
              { key: 'list', label: 'The list', kind: 'text' },
              { key: 'total', label: 'Receipt total', kind: 'text' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { Planned: 'amber', Shopping: 'blue', Done: 'mint' } },
            ],
            headerActions: [
              { id: 'plan-run', label: 'Plan a run', icon: 'plus', kind: 'create',
                payload: { house: 'Maple House', day: '{today}', runner: '', list: '', total: '', status: 'Planned' },
                toast: 'Run planned — write the list.' },
            ],
            rowActions: [
              { id: 'start-run', label: 'Heading out', icon: 'arrow-right', quick: true, kind: 'patch',
                when: { field: 'status', eq: 'Planned' },
                patch: { status: 'Shopping' }, toast: '{row.runner} is out shopping.' },
              { id: 'close-run', label: 'Back — type the total', icon: 'check', quick: true, kind: 'patch',
                when: { field: 'status', eq: 'Shopping' },
                patch: { status: 'Done' },
                toast: 'Run closed — edit the row to type the receipt total.' },
            ],
          },
          rows: [
            { id: 'row-1', house: 'Maple House', day: isoDay(0), runner: 'Dana W.', list: 'Milk, eggs, bread, bananas, coffee', total: '', status: 'Shopping' },
            { id: 'row-2', house: 'Birch House', day: isoDay(0), runner: '', list: 'Paper towels, dish soap, chicken, rice', total: '', status: 'Planned' },
            { id: 'row-3', house: 'Cedar House', day: isoDay(-1), runner: 'Marcus C.', list: 'Weekly full shop', total: '$214.60', status: 'Done' },
            { id: 'row-4', house: 'Maple House', day: isoDay(-3), runner: 'Priya S.', list: 'Client birthday cake + candles', total: '$38.20', status: 'Done' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
