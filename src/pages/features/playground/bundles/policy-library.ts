// CURATED BUNDLE — Policy Library.
// The reading room: the policies and procedures every carer signs up to, as documents with covers, collections and…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoNow } from './shared'

export const policyLibrary: CuratedBundle = {
  id: 'policy-library',
  blurb: 'Medication, safeguarding, fire safety — the reading every role signs up to.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Policy Library',
      tagline: 'The reading room: policies, procedures and guidance.',
      icon: 'book-open',
      accent: 'lavender',
      category: 'Library',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'library',
          type: 'documents',
          title: 'Library',
          resource: '',
          config: {
            cardStyle: 'cover',
            collections: [
              { id: 'policies', label: 'Policies', icon: 'shield', tint: 'peach' },
              { id: 'procedures', label: 'Procedures', icon: 'clipboard-list', tint: 'mint' },
              { id: 'guidance', label: 'Guidance', icon: 'lightbulb', tint: 'lavender' },
            ],
            reader: { showToc: true, showMeta: true, allowPrint: true },
          },
          rows: [
            {
              id: 'doc-1', title: 'Medication Handling Policy', collection: 'policies',
              excerpt: 'Who may administer, the two-person check, and what to do when a dose is refused.',
              cover: '/assets/docs/cover-01.jpg', authorIds: [], updatedAt: isoNow(-2), readMinutes: 8,
              body: [
                { kind: 'h2', text: 'The two-person check', id: 'two-person-check' },
                { kind: 'p', text: 'Every controlled medication round is prepared by one carer and verified by a second before it leaves the medication room.' },
                { kind: 'callout', tint: 'amber', text: 'A refused dose is never forced — record it, inform the manager, and contact the GP if it repeats.' },
              ],
            },
            {
              id: 'doc-2', title: 'Safeguarding Adults', collection: 'policies',
              excerpt: 'Recognising signs, raising a concern, and the 24-hour escalation path.',
              cover: '/assets/docs/cover-02.jpg', authorIds: [], updatedAt: isoNow(-5), readMinutes: 10,
              body: [
                { kind: 'h2', text: 'Raising a concern', id: 'raising-a-concern' },
                { kind: 'p', text: 'Any concern — however small — goes to the safeguarding lead within 24 hours. You never investigate alone.' },
                { kind: 'p', text: 'If someone is in immediate danger, call emergency services first and the lead straight after.' },
              ],
            },
            {
              id: 'doc-3', title: 'Fire Safety & Evacuation', collection: 'procedures',
              excerpt: 'Alarm points, assembly areas, and how we move residents who need assistance.',
              cover: '/assets/docs/cover-03.jpg', authorIds: [], updatedAt: isoNow(-8), readMinutes: 6,
              body: [
                { kind: 'h2', text: 'On hearing the alarm', id: 'on-hearing-the-alarm' },
                { kind: 'p', text: 'Close doors behind you, guide residents to the nearest safe exit, and assemble on the front lawn.' },
                { kind: 'callout', tint: 'mint', text: 'Each resident’s personal evacuation plan hangs inside their bedroom door.' },
              ],
            },
            {
              id: 'doc-4', title: 'Infection Control', collection: 'procedures',
              excerpt: 'Hand hygiene moments, PPE by task, and what an outbreak changes.',
              cover: '/assets/docs/cover-04.jpg', authorIds: [], updatedAt: isoNow(-12), readMinutes: 7,
              body: [
                { kind: 'h2', text: 'The five moments', id: 'the-five-moments' },
                { kind: 'p', text: 'Wash or gel before contact, before a clean task, after body fluids, after contact, and after touching the surroundings.' },
              ],
            },
            {
              id: 'doc-5', title: 'Visitors & Family Guidance', collection: 'guidance',
              excerpt: 'Visiting hours, sign-in, and how we handle difficult conversations with families.',
              cover: '/assets/docs/cover-01.jpg', authorIds: [], updatedAt: isoNow(-15), readMinutes: 4,
              body: [
                { kind: 'h2', text: 'Everyday visits', id: 'everyday-visits' },
                { kind: 'p', text: 'Visitors sign in at the door and are welcome between 10:00 and 20:00. Outside those hours, check with the shift lead.' },
              ],
            },
          ],
        },
      ],
    },
  },
}
