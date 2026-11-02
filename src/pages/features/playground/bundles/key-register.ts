// CURATED BUNDLE — Key Register.
// Every house key and fob, who holds it, since when.
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const keyRegister: CuratedBundle = {
  id: 'key-register',
  blurb: 'Who holds which key, since when — and the lost ones in red.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Key Register',
      tagline: 'Every key and fob, accounted for.',
      icon: 'key-round',
      accent: 'amber',
      category: 'Operations',
      audience: ['admin', 'manager'],
      pages: [
        {
          id: 'keys',
          type: 'sheet',
          title: 'Keys & fobs',
          resource: '',
          config: {
            entity: ['key', 'keys'],
            searchable: true,
            densityToggle: true,
            columns: [
              { key: 'tag', label: 'Tag', kind: 'text' },
              { key: 'opens', label: 'Opens', kind: 'text' },
              { key: 'holder', label: 'Held by', kind: 'text' },
              { key: 'since', label: 'Since', kind: 'date' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { Held: 'blue', 'In the safe': 'mint', Lost: 'pink' } },
            ],
            headerActions: [
              { id: 'hand-out', label: 'Hand a key out', icon: 'plus', kind: 'create',
                payload: { tag: 'K-', opens: '', holder: '', since: '{today}', status: 'Held' },
                toast: 'Key handed out — name the holder.' },
            ],
            rowActions: [
              { id: 'take-back', label: 'Back to the safe', icon: 'archive', quick: true, kind: 'patch',
                when: { field: 'status', neq: 'In the safe' },
                patch: { status: 'In the safe', holder: '' },
                toast: '{row.tag} is back in the safe.' },
              { id: 'mark-lost', label: 'Mark lost', icon: 'triangle-alert', danger: true, kind: 'patch',
                patch: { status: 'Lost' },
                confirm: 'Mark {row.tag} as LOST? Locks it opens may need rekeying.',
                toast: '{row.tag} marked lost.' },
            ],
          },
          rows: [
            { id: 'row-1', tag: 'K-101', opens: 'Maple House — front', holder: 'Dana W.', since: isoDay(-12), status: 'Held' },
            { id: 'row-2', tag: 'K-102', opens: 'Maple House — med cabinet', holder: 'Shift lead (rotating)', since: isoDay(-2), status: 'Held' },
            { id: 'row-3', tag: 'F-07', opens: 'Office — side door fob', holder: '', since: isoDay(-30), status: 'In the safe' },
            { id: 'row-4', tag: 'K-201', opens: 'Birch House — front', holder: 'Marcus C.', since: isoDay(-45), status: 'Held' },
            { id: 'row-5', tag: 'K-203', opens: 'Birch House — garage', holder: '', since: isoDay(-90), status: 'Lost' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
