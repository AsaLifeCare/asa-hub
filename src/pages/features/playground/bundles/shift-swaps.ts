// CURATED BUNDLE — Shift Swap Board.
// A horizontal kanban: open swaps anyone can claim, claimed swaps waiting on a manager, approved swaps that are…
import { BUNDLE_KIND } from '../validation'
import type { CuratedBundle } from './shared'
import { isoDay } from './shared'

export const shiftSwaps: CuratedBundle = {
  id: 'shift-swaps',
  blurb: 'Post the shift you cannot cover, claim one you can — a manager approves.',
  bundle: {
    kind: BUNDLE_KIND,
    version: 1,
    app: {
      name: 'Shift Swaps',
      tagline: 'Post a shift you cannot cover, claim one you can.',
      icon: 'calendar-clock',
      accent: 'blue',
      category: 'Manage',
      audience: ['admin', 'manager', 'staff'],
      pages: [
        {
          id: 'board',
          type: 'board',
          title: 'Swap board',
          resource: '',
          config: {
            stageField: 'stage',
            stages: [
              { id: 'open', label: 'Open', tint: 'amber' },
              { id: 'claimed', label: 'Claimed', tint: 'blue' },
              { id: 'approved', label: 'Approved', tint: 'mint' },
            ],
            rowActions: [
              // One step per stage, shown only where the card actually is — the board renders these as quick hover…
              { id: 'claim', label: 'Claim this swap', icon: 'hand', quick: true, kind: 'patch',
                when: { field: 'stage', eq: 'open' },
                patch: { stage: 'claimed' },
                toast: '{row.title} claimed — a manager still has to approve.' },
              { id: 'approve', label: 'Approve swap', icon: 'check', quick: true, kind: 'patch', perm: 'schedule.edit',
                when: { field: 'stage', eq: 'claimed' },
                patch: { stage: 'approved' },
                toast: '{row.title} approved.' },
              { id: 'hand-back', label: 'Hand back', icon: 'undo-2', kind: 'patch',
                when: { field: 'stage', eq: 'claimed' },
                patch: { stage: 'open' },
                toast: '{row.title} is open again.' },
              { id: 'remove-swap', label: 'Remove from board', icon: 'trash-2', danger: true, kind: 'delete',
                when: { field: 'stage', eq: 'open' },
                confirm: 'Remove "{row.title}" from the board?',
                toast: 'Swap removed.' },
            ],
          },
          rows: [
            { id: 'row-1', title: 'Sat day shift — Maple House', stage: 'open', priority: 'high', due: isoDay(3), assignee: 'Maya Chen', avatar: '/assets/library/animals/fox.jpg' },
            { id: 'row-2', title: 'Sun waking night — Birch House', stage: 'open', priority: 'normal', due: isoDay(4), assignee: 'Chris Young', avatar: '/assets/library/animals/barn-owl.jpg' },
            { id: 'row-3', title: 'Mon early shift — Cedar House', stage: 'claimed', priority: 'normal', due: isoDay(2), assignee: 'Sam Lee', avatar: '/assets/library/animals/dog.jpg' },
            { id: 'row-4', title: 'Fri late shift — Maple House', stage: 'claimed', priority: 'high', due: isoDay(1), assignee: 'Jo Patel', avatar: '/assets/library/animals/red-panda.jpg' },
            { id: 'row-5', title: 'Thu day shift — Birch House', stage: 'approved', priority: 'low', due: isoDay(-1), assignee: 'Alex Rivera', avatar: '/assets/library/animals/cat.jpg' },
          ],
        },
        {
          id: 'rules',
          type: 'checklist',
          title: 'Swap rules',
          resource: '',
          config: {
            groupKey: 'section',
            labelKey: 'item',
            noteKey: 'note',
            requiredKey: 'required',
          },
          rows: [
            { id: 'chk-1', section: 'Before you post', item: 'Check the rota for gaps first', required: 'yes', note: 'The week view is in the staff room' },
            { id: 'chk-2', section: 'Before you post', item: 'Give at least 48h notice', required: 'yes', note: 'Emergencies go straight to the manager' },
            { id: 'chk-3', section: 'Before you claim', item: 'You are trained for that house', required: 'yes', note: 'Medication rounds need sign-off' },
            { id: 'chk-4', section: 'Before you claim', item: 'No overtime clash that week', required: 'yes', note: '' },
            { id: 'chk-5', section: 'After a swap', item: 'Manager approved it on the board', required: 'yes', note: 'A claim is not a confirmation' },
            { id: 'chk-6', section: 'After a swap', item: 'Handover notes passed along', required: 'no', note: '' },
          ],
        },
      ],
    },
  },
}
