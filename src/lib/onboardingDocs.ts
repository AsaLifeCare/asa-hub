// Checklist item ⇄ document catalog, in one place.
// Both pipelines — Hiring (onboarding stage) and the Onboarding Tracker — carry the same checklist ids…
export const DOC_ID_BY_CHECKLIST: Record<string, string> = {
  'new-hire-packet': 'dropbox_packet',
  'dropbox-link': 'dropbox_packet',
  'background-check': 'background_check',
  'drivers-license': 'drivers_id',
  diploma: 'hs_diploma',
  'ss-card': 'ss_birth',
  'dodd-cert': 'dodd_8hr',
  'cpr-cert': 'cpr_first_aid',
  'med-cert': 'med_del',
  insurance: 'car_insurance',
}

/** The checklist ids that a given doc_id satisfies (one doc, many rows). */
export const CHECKLIST_BY_DOC_ID: Record<string, string[]> = Object.entries(
  DOC_ID_BY_CHECKLIST,
).reduce<Record<string, string[]>>((acc, [checklistId, docId]) => {
  ;(acc[docId] ??= []).push(checklistId)
  return acc
}, {})

/** Is this checklist row backed by a real file? */
export function docIdFor(checklistId: string): string | undefined {
  return DOC_ID_BY_CHECKLIST[checklistId]
}
