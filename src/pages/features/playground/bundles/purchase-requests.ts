// CURATED BUNDLE — Purchase Requests.
// A kanban of everything the houses asked to buy: requested → approved → ordered → received, one quick action per…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const purchaseRequests: CuratedBundle = {
  id: 'purchase-requests',
  blurb: 'Request it, approve it, order it, receive it — every purchase on one board.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Purchase Requests',
      tagline: 'From "we need it" to "it arrived", one board.',
      icon: 'shopping-cart',
      accent: 'lavender',
      category: 'Operations',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'board',
          type: 'board',
          title: 'Requests',
          resource: '',
          config: {
            stageField: 'stage',
            stages: [
              { id: 'requested', label: 'Requested', tint: 'amber' },
              { id: 'approved', label: 'Approved', tint: 'blue' },
              { id: 'ordered', label: 'Ordered', tint: 'lavender' },
              { id: 'received', label: 'Received', tint: 'mint' },
            ],
            rowActions: [
              // One patch per hop, visible only where the card actually sits.
              { id: 'approve', label: 'Approve', icon: 'check', quick: true, kind: 'patch', perm: 'expenses.edit',
                when: { field: 'stage', eq: 'requested' },
                patch: { stage: 'approved' },
                toast: '{row.title} approved — ready to order.' },
              { id: 'mark-ordered', label: 'Mark ordered', icon: 'shopping-cart', quick: true, kind: 'patch',
                when: { field: 'stage', eq: 'approved' },
                patch: { stage: 'ordered' },
                toast: '{row.title} ordered.' },
              { id: 'mark-received', label: 'Mark received', icon: 'package-check', quick: true, kind: 'patch',
                when: { field: 'stage', eq: 'ordered' },
                patch: { stage: 'received' },
                toast: '{row.title} received.' },
              { id: 'see-history', label: 'See purchase history', icon: 'history', kind: 'navigate', href: 'page:history' },
              { id: 'withdraw', label: 'Withdraw request', icon: 'trash-2', danger: true, kind: 'delete',
                when: { field: 'stage', eq: 'requested' },
                confirm: 'Withdraw "{row.title}"? The request disappears for everyone.',
                toast: 'Request withdrawn.' },
            ],
          },
          rows: [
            { id: 'row-1', title: 'Wheelchair cushion — Cedar House', stage: 'requested', priority: 'high', due: isoDay(4), assignee: 'Maya Chen', avatar: '/assets/library/animals/fox.jpg' },
            { id: 'row-2', title: 'Two notice boards — Birch House', stage: 'requested', priority: 'normal', due: isoDay(9), assignee: 'Chris Young', avatar: '/assets/library/animals/barn-owl.jpg' },
            { id: 'row-3', title: 'Garden shed padlock — Maple House', stage: 'approved', priority: 'normal', due: isoDay(6), assignee: 'Sam Lee', avatar: '/assets/library/animals/dog.jpg' },
            { id: 'row-4', title: 'Air fryer for the training kitchen', stage: 'approved', priority: 'low', due: isoDay(12), assignee: 'Jo Patel', avatar: '/assets/library/animals/red-panda.jpg' },
            { id: 'row-5', title: 'Sensory light projector — Cedar House', stage: 'ordered', priority: 'normal', due: isoDay(2), assignee: 'Alex Rivera', avatar: '/assets/library/animals/cat.jpg' },
            { id: 'row-6', title: 'Replacement hoover — Maple House', stage: 'received', priority: 'normal', due: isoDay(-3), assignee: 'Maya Chen', avatar: '/assets/library/animals/fox.jpg' },
          ],
        },
        {
          id: 'history',
          type: 'sheet',
          title: 'Purchase history',
          resource: '',
          config: {
            entity: ['purchase', 'purchases'],
            searchable: true,
            selectable: true,
            densityToggle: true,
            columns: [
              { key: 'item', label: 'Item', kind: 'text' },
              { key: 'house', label: 'House', kind: 'chip', tintBy: { 'Maple House': 'mint', 'Birch House': 'blue', 'Cedar House': 'lavender', 'All houses': 'peach' } },
              { key: 'requestedBy', label: 'Requested by', kind: 'text' },
              { key: 'cost', label: 'Cost (£)', kind: 'number' },
              { key: 'stage', label: 'Stage', kind: 'chip', tintBy: { requested: 'amber', approved: 'blue', ordered: 'lavender', received: 'mint' } },
              { key: 'updated', label: 'Updated', kind: 'date' },
            ],
            headerActions: [
              { id: 'new-request', label: 'New request', icon: 'plus', kind: 'create',
                payload: { item: 'New request', house: 'Maple House', requestedBy: '', cost: 0, stage: 'requested', updated: '{today}' },
                toast: 'Request added — approve it on the board.' },
            ],
          },
          rows: [
            { id: 'row-1', item: 'Wheelchair cushion', house: 'Cedar House', requestedBy: 'Maya Chen', cost: 89, stage: 'requested', updated: isoDay(0) },
            { id: 'row-2', item: 'Two notice boards', house: 'Birch House', requestedBy: 'Chris Young', cost: 64, stage: 'requested', updated: isoDay(-1) },
            { id: 'row-3', item: 'Garden shed padlock', house: 'Maple House', requestedBy: 'Sam Lee', cost: 18, stage: 'approved', updated: isoDay(-1) },
            { id: 'row-4', item: 'Air fryer (training kitchen)', house: 'All houses', requestedBy: 'Jo Patel', cost: 74, stage: 'approved', updated: isoDay(-2) },
            { id: 'row-5', item: 'Sensory light projector', house: 'Cedar House', requestedBy: 'Alex Rivera', cost: 129, stage: 'ordered', updated: isoDay(-2) },
            { id: 'row-6', item: 'Replacement hoover', house: 'Maple House', requestedBy: 'Maya Chen', cost: 149, stage: 'received', updated: isoDay(-3) },
            { id: 'row-7', item: 'Handrails for the side path', house: 'Birch House', requestedBy: 'Sam Lee', cost: 210, stage: 'received', updated: isoDay(-8) },
            { id: 'row-8', item: 'Picnic bench', house: 'Cedar House', requestedBy: 'Chris Young', cost: 175, stage: 'received', updated: isoDay(-12) },
          ],
          toggles: { ordering: true, export: true, inlineEdit: true, create: true },
        },
      ],
    },
  },
}
