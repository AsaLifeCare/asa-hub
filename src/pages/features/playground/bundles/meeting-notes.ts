// CURATED BUNDLE — Meeting Notes.
// A searchable sheet of staff meeting minutes, with a detail page that reads the latest one as a record: chair…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const meetingNotes: CuratedBundle = {
  id: 'meeting-notes',
  blurb: 'Minutes, decisions and action points — searchable, with the latest as a record.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Meeting Notes',
      tagline: 'Staff meeting minutes and decisions, searchable.',
      icon: 'notebook-pen',
      accent: 'green',
      category: 'Workspace',
      audience: ['admin', 'manager'],
      pages: [
        {
          id: 'notes',
          type: 'sheet',
          title: 'All notes',
          resource: '',
          config: {
            entity: ['note', 'notes'],
            searchable: true,
            selectable: true,
            densityToggle: true,
            columns: [
              { key: 'title', label: 'Meeting', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender', 'All houses': 'peach' } },
              { key: 'date', label: 'Date', kind: 'date' },
              { key: 'chair', label: 'Chair', kind: 'text' },
              { key: 'decisions', label: 'Decisions', kind: 'number' },
              { key: 'status', label: 'Status', kind: 'chip', tintBy: { Draft: 'amber', Published: 'mint' } },
            ],
            rowActions: [
              // Jump from the row to this app's record page — `page:latest` resolves to /app/<appId>/latest, same…
              { id: 'open-note', label: 'Open as record', icon: 'arrow-right', quick: true, kind: 'navigate', href: 'page:latest' },
            ],
          },
          rows: [
            { id: 'row-1', title: 'Weekly staff sync', house: 'Maple House', date: isoDay(0), chair: 'Alex Rivera', decisions: 3, status: 'Published' },
            { id: 'row-2', title: 'Medication audit review', house: 'All houses', date: isoDay(-3), chair: 'Pat Morgan', decisions: 5, status: 'Published' },
            { id: 'row-3', title: 'Rota planning — next month', house: 'Birch House', date: isoDay(-5), chair: 'Sam Lee', decisions: 2, status: 'Draft' },
            { id: 'row-4', title: 'Family feedback roundup', house: 'Cedar House', date: isoDay(-7), chair: 'Jo Patel', decisions: 4, status: 'Published' },
            { id: 'row-5', title: 'Weekly staff sync', house: 'Maple House', date: isoDay(-7), chair: 'Alex Rivera', decisions: 2, status: 'Published' },
          ],
        },
        {
          id: 'latest',
          type: 'detail',
          title: 'Latest note',
          resource: '',
          config: {
            header: {
              title: 'title',
              subtitle: 'house',
              statusChip: { field: 'status', tintBy: { Published: 'mint', Draft: 'amber' } },
            },
            stats: [
              { label: 'Decisions', value: 'decisions', icon: 'clipboard-check', tint: 'mint' },
              { label: 'Actions', value: 'actions', icon: 'list-checks', tint: 'blue' },
              { label: 'Attendees', value: 'attendees', icon: 'users', tint: 'lavender' },
              { label: 'Length (min)', value: 'lengthMin', icon: 'clock', tint: 'peach' },
            ],
            sections: [
              { kind: 'fields', title: 'Details', fields: [
                { label: 'Chair', value: 'chair' },
                { label: 'Date', value: 'date' },
                { label: 'Where', value: 'location' },
              ] },
              { kind: 'chips', title: 'Topics', itemsField: 'topics' },
            ],
          },
          rows: [
            { id: 'row-1', title: 'Weekly staff sync', house: 'Maple House', status: 'Published', date: isoDay(0), chair: 'Alex Rivera', location: 'Maple House office', decisions: 3, actions: 5, attendees: 8, lengthMin: 35, topics: ['Rota gaps', 'Garden project', 'Training deadlines'] },
            { id: 'row-2', title: 'Medication audit review', house: 'All houses', status: 'Published', date: isoDay(-3), chair: 'Pat Morgan', location: 'Video call', decisions: 5, actions: 7, attendees: 6, lengthMin: 50, topics: ['Audit findings', 'Refusals', 'Stock ordering'] },
          ],
        },
      ],
    },
  },
}
