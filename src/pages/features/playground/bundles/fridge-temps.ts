// CURATED BUNDLE — Fridge Temps.
// The twice-daily fridge and freezer temperature log every kitchen keeps — in range is quiet, out of range is loud…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const fridgeTemps: CuratedBundle = {
  id: 'fridge-temps',
  blurb: 'The kitchen temperature log — quiet when in range, loud when not.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Fridge Temps',
      tagline: 'Twice a day, every unit, written down.',
      icon: 'thermometer',
      accent: 'blue',
      category: 'Care',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'log',
          type: 'sheet',
          title: 'Temperature log',
          resource: '',
          config: {
            entity: ['reading', 'readings'],
            searchable: true,
            densityToggle: true,
            columns: [
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender' } },
              { key: 'unit', label: 'Unit', kind: 'text' },
              { key: 'day', label: 'Day', kind: 'date' },
              { key: 'am', label: 'AM °F', kind: 'text' },
              { key: 'pm', label: 'PM °F', kind: 'text' },
              { key: 'status', label: 'Range', kind: 'chip', tintBy: { 'In range': 'mint', 'Out of range': 'pink', 'Not read yet': 'amber' } },
              { key: 'actionTaken', label: 'Action taken', kind: 'text' },
            ],
            headerActions: [
              { id: 'new-reading', label: "Start today's row", icon: 'plus', kind: 'create',
                payload: { house: 'Maple House', unit: 'Kitchen fridge', day: '{today}', am: '', pm: '', status: 'Not read yet', actionTaken: '' },
                toast: 'Row started — type the AM reading.' },
            ],
            rowActions: [
              { id: 'in-range', label: 'In range', icon: 'check', quick: true, kind: 'patch',
                when: { field: 'status', neq: 'In range' },
                patch: { status: 'In range' }, toast: '{row.unit} in range.' },
              { id: 'out-of-range', label: 'Out of range', icon: 'triangle-alert', danger: true, kind: 'patch',
                patch: { status: 'Out of range' },
                confirm: 'Mark {row.unit} OUT of range? Write what was done about it in the Action column.',
                toast: 'Out of range — write the action taken.' },
            ],
          },
          rows: [
            { id: 'row-1', house: 'Maple House', unit: 'Kitchen fridge', day: isoDay(0), am: '37', pm: '', status: 'In range', actionTaken: '' },
            { id: 'row-2', house: 'Maple House', unit: 'Kitchen freezer', day: isoDay(0), am: '-2', pm: '', status: 'In range', actionTaken: '' },
            { id: 'row-3', house: 'Birch House', unit: 'Med fridge', day: isoDay(0), am: '44', pm: '', status: 'Out of range', actionTaken: 'Moved meds to kitchen fridge; maintenance called' },
            { id: 'row-4', house: 'Cedar House', unit: 'Kitchen fridge', day: isoDay(0), am: '', pm: '', status: 'Not read yet', actionTaken: '' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
