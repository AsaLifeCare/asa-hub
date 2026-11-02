// The Record view's tabs: the six this company already reads, then the sections it shares with the Unique view…
// Pure — the page and the tests read the same order.
export type RecordTab = { id: string; label: string }

export const RECORD_TABS: readonly RecordTab[] = [
  { id: 'demographics', label: 'Demographics' },
  { id: 'summary', label: 'Summary' },
  { id: 'care', label: 'Care Instructions' },
  { id: 'medical', label: 'Medical' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'incidents', label: 'Incidents' },
]

/** Where a record opens, and where a tab this viewer may not have falls back to. */
export const FIRST_RECORD_TAB = RECORD_TABS[0].id

/** The record's own tabs, then the shared sections this viewer's doors admit — one order, one list. */
export function recordTabs(sections: readonly RecordTab[]): RecordTab[] {
  return [...RECORD_TABS, ...sections]
}
