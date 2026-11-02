// THE ONE RIGHT PANEL of Families — a SidePanel whose mode switches: share, an admin note, a call to schedule and a…
// It is an aside, never a dialog.
import SidePanel from '@/components/shared/SidePanel'
import { ShareBody } from '@/pages/features/locations/LocationPanel'
import { useFamilyDetailsHidden } from '@/lib/stamps'
import { useShellHides } from '@/lib/myWorkHides'
import type { SharePayload } from '@/stores/useShareStore'
import { panelLabel, panelParam, panelTitle, type FamilyAsk, type RosterRow } from './familyModel'
import { CallEditForm, CallForm, EditFamilyForm, IncidentForm, NoteEditForm, NoteForm } from './FamilyForms'
import { AddDocumentForm, NewFamilyForm } from './FamilyRegistryForms'

export default function FamilyPanel({ ask, row, share, onClose, onRenamed, onCreated, onAsk }: {
  ask: FamilyAsk | null
  row: RosterRow
  share: SharePayload
  onClose: () => void
  /** an edit renamed the family member: the screen moves to the new key */
  onRenamed?: (key: string) => void
  /** New Family registered one: the screen opens on them */
  onCreated?: (key: string) => void
  /** another mode of the panel: a note on file opened from the notes panel */
  onAsk?: (ask: FamilyAsk) => void
}) {
  // Edit details' and New incident's titles are the master's, or everyone's while Settings › My Work shows them
  const bare = useFamilyDetailsHidden()
  const incidentBare = useShellHides().incident_notes
  const title = !ask || (ask.kind === 'edit' && bare) || (ask.kind === 'incident' && incidentBare) ? '' : panelTitle(ask, row.name)
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'Families & Guardians'} title={title}>
      {ask && <PanelBody key={ask.kind === 'create' ? 'create' : `${row.key}|${panelParam(ask)}`} ask={ask} row={row} share={share}
        onClose={onClose} onRenamed={onRenamed} onCreated={onCreated} onAsk={onAsk} />}
    </SidePanel>
  )
}

export function PanelBody({ ask, row, share, onClose, onRenamed, onCreated, onAsk }: {
  ask: FamilyAsk
  row: RosterRow
  share: SharePayload
  onClose: () => void
  onRenamed?: (key: string) => void
  onCreated?: (key: string) => void
  onAsk?: (ask: FamilyAsk) => void
}) {
  switch (ask.kind) {
    case 'share': return <ShareBody payload={share} />
    case 'create': return <NewFamilyForm onDone={onClose} onCreated={onCreated ?? (() => onClose())} />
    case 'doc': return <AddDocumentForm row={row} onDone={onClose} />
    case 'note': return <NoteForm row={row} onDone={onClose} onEdit={onAsk ? (id) => onAsk({ kind: 'note-edit', id }) : undefined} />
    case 'call': return <CallForm row={row} onDone={onClose} />
    case 'incident': return <IncidentForm row={row} onDone={onClose} />
    case 'edit': return <EditFamilyForm row={row} onDone={onClose} onRenamed={onRenamed ?? (() => onClose())} />
    case 'note-edit': return <NoteEditForm row={row} id={ask.id} onDone={onClose} />
    case 'call-edit': return <CallEditForm row={row} id={ask.id} onDone={onClose} />
  }
}
