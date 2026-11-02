// CURATED BUNDLE — Vehicle Checks.
// The van walk-around before the first run of the day: one row per check, pass from the row, flag a fault loudly…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const vehicleChecks: CuratedBundle = {
  id: 'vehicle-checks',
  blurb: 'The daily van walk-around — pass it, or flag the fault loudly.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Vehicle Checks',
      tagline: 'Every van checked before its first run.',
      icon: 'car',
      accent: 'blue',
      category: 'Operations',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'checks',
          type: 'sheet',
          title: 'Daily checks',
          resource: '',
          config: {
            entity: ['check', 'checks'],
            searchable: true,
            densityToggle: true,
            columns: [
              { key: 'vehicle', label: 'Vehicle', kind: 'text' },
              { key: 'date', label: 'Date', kind: 'date' },
              { key: 'checkedBy', label: 'Checked by', kind: 'text' },
              { key: 'tires', label: 'Tires', kind: 'chip', tintBy: { OK: 'mint', Worn: 'amber', Fault: 'pink' } },
              { key: 'lights', label: 'Lights', kind: 'chip', tintBy: { OK: 'mint', Fault: 'pink' } },
              { key: 'fuel', label: 'Fuel', kind: 'chip', tintBy: { Full: 'mint', Half: 'amber', Low: 'pink' } },
              { key: 'status', label: 'Verdict', kind: 'chip', tintBy: { Passed: 'mint', 'Fault flagged': 'pink', Pending: 'amber' } },
            ],
            headerActions: [
              { id: 'new-check', label: 'Log a check', icon: 'plus', kind: 'create',
                payload: { vehicle: 'Van 1', date: '{today}', checkedBy: '', tires: 'OK', lights: 'OK', fuel: 'Full', status: 'Pending' },
                toast: 'Check started — walk the van.' },
            ],
            rowActions: [
              { id: 'pass-check', label: 'Pass', icon: 'check', quick: true, kind: 'patch',
                when: { field: 'status', neq: 'Passed' },
                patch: { status: 'Passed' }, toast: '{row.vehicle} passed.' },
              { id: 'flag-fault', label: 'Flag a fault', icon: 'triangle-alert', danger: true, kind: 'patch',
                patch: { status: 'Fault flagged' },
                confirm: 'Flag {row.vehicle} with a fault? It should not carry clients until cleared.',
                toast: 'Fault flagged — the van is off the road.' },
            ],
          },
          rows: [
            { id: 'row-1', vehicle: 'Van 1', date: isoDay(0), checkedBy: 'Marcus', tires: 'OK', lights: 'OK', fuel: 'Full', status: 'Passed' },
            { id: 'row-2', vehicle: 'Van 2', date: isoDay(0), checkedBy: 'Dana', tires: 'Worn', lights: 'OK', fuel: 'Half', status: 'Pending' },
            { id: 'row-3', vehicle: 'Van 3', date: isoDay(0), checkedBy: '', tires: 'OK', lights: 'Fault', fuel: 'Low', status: 'Fault flagged' },
            { id: 'row-4', vehicle: 'Van 1', date: isoDay(-1), checkedBy: 'Marcus', tires: 'OK', lights: 'OK', fuel: 'Full', status: 'Passed' },
            { id: 'row-5', vehicle: 'Van 2', date: isoDay(-1), checkedBy: 'Priya', tires: 'OK', lights: 'OK', fuel: 'Full', status: 'Passed' },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
