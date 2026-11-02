// CURATED BUNDLE — Client Outings Planner.
// A week schedule of trips, drives and appointments for residents, staffed by the drivers and carers who go along…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const clientOutings: CuratedBundle = {
  id: 'client-outings',
  blurb: 'Trips and appointments on one calendar, with ideas for the quiet weeks.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Client Outings',
      tagline: 'Plan trips, drives and appointments for the residents.',
      icon: 'bus',
      accent: 'green',
      category: 'Care',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'planner',
          type: 'schedule',
          title: 'Planner',
          resource: '',
          config: {
            view: 'week',
            allowViews: ['week', 'month'],
            resources: [
              { id: 'r-1', name: 'Alex Rivera', avatar: '/assets/library/animals/cat.jpg', role: 'Coordinator' },
              { id: 'r-2', name: 'Sam Lee', avatar: '/assets/library/animals/dog.jpg', role: 'Driver' },
              { id: 'r-3', name: 'Jo Patel', avatar: '/assets/library/animals/red-panda.jpg', role: 'Carer' },
            ],
            timeRange: [8, 20],
            slotMinutes: 30,
            eventTypes: {
              outing: { label: 'Outing', tint: 'mint' },
              appointment: { label: 'Appointment', tint: 'blue' },
              'family-visit': { label: 'Family visit', tint: 'peach' },
            },
            showMiniMonth: true,
            showNowLine: true,
          },
          rows: [
            { id: 'row-1', title: 'Park walk with John', personId: 'r-3', date: isoDay(0), start: '10:00', durationMin: 90, type: 'outing', attendees: ['r-1'] },
            { id: 'row-2', title: 'GP appointment — Mary', personId: 'r-2', date: isoDay(0), start: '14:00', durationMin: 60, type: 'appointment', attendees: [] },
            { id: 'row-3', title: 'Seaside drive', personId: 'r-2', date: isoDay(1), start: '13:00', durationMin: 180, type: 'outing', attendees: ['r-3'] },
            { id: 'row-4', title: 'Dentist — Arthur', personId: 'r-3', date: isoDay(2), start: '09:30', durationMin: 75, type: 'appointment', attendees: [] },
            { id: 'row-5', title: 'Sunday lunch with family', personId: 'r-1', date: isoDay(3), start: '12:00', durationMin: 120, type: 'family-visit', attendees: ['r-2'] },
            { id: 'row-6', title: 'Garden centre trip', personId: 'r-2', date: isoDay(4), start: '10:30', durationMin: 150, type: 'outing', attendees: ['r-1', 'r-3'] },
          ],
        },
        {
          id: 'ideas',
          type: 'checklist',
          title: 'Outing ideas',
          resource: '',
          config: {
            groupKey: 'section',
            labelKey: 'item',
            noteKey: 'note',
            requiredKey: 'required',
          },
          rows: [
            { id: 'chk-1', section: 'Nearby', item: 'Feed the ducks at the pond', required: 'no', note: 'Twenty minutes, flat path' },
            { id: 'chk-2', section: 'Nearby', item: 'Coffee at the garden centre', required: 'no', note: 'Wheelchair-friendly entrance' },
            { id: 'chk-3', section: 'Further out', item: 'Seaside drive with ice cream', required: 'no', note: 'Book the adapted minibus' },
            { id: 'chk-4', section: 'Further out', item: 'Matinee at the community theatre', required: 'no', note: 'Check accessibility seating first' },
            { id: 'chk-5', section: 'Rainy day', item: 'Bowling afternoon', required: 'no', note: 'Ramp and ball guide available' },
            { id: 'chk-6', section: 'Rainy day', item: 'Baking morning in the big kitchen', required: 'no', note: '' },
          ],
        },
      ],
    },
  },
}
