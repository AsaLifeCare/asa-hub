// THE ONE RIGHT PANEL of SSA — a SidePanel whose mode switches: share, the admin notes, the SSA's details edited and a
// Documents or Activity entry edited. It is an aside at the standard width, never a dialog.
import SidePanel from '@/components/shared/SidePanel'
import { ShareBody } from '@/pages/features/locations/LocationPanel'
import type { SharePayload } from '@/stores/useShareStore'
import { useShellHides } from '@/lib/myWorkHides'
import { panelLabel, panelParam, panelTitle, type RosterRow, type SsaAsk } from './ssaModel'
import { ActivityEditForm, DocEditForm, EditSsaForm, NoteForm } from './SsaForms'

export default function SsaPanel({ ask, row, share, onClose }: {
  ask: SsaAsk | null
  row: RosterRow
  share: SharePayload
  onClose: () => void
}) {
  // Edit details' title is the master's while Settings › My Work keeps the panel's notes
  const bare = useShellHides().ssa_edit_notes
  const title = !ask || (ask.kind === 'edit' && bare) ? '' : panelTitle(ask, row.name)
  return (
    <SidePanel open={!!ask} onClose={onClose} label={ask ? panelLabel(ask) : 'SSA'} title={title}>
      {ask && <PanelBody key={`${row.key}|${panelParam(ask)}`} ask={ask} row={row} share={share} onClose={onClose} />}
    </SidePanel>
  )
}

export function PanelBody({ ask, row, share, onClose }: { ask: SsaAsk; row: RosterRow; share: SharePayload; onClose: () => void }) {
  switch (ask.kind) {
    case 'share': return <ShareBody payload={share} />
    case 'note': return <NoteForm row={row} onDone={onClose} />
    case 'edit': return <EditSsaForm row={row} onDone={onClose} />
    case 'doc-edit': return <DocEditForm row={row} id={ask.id} onDone={onClose} />
    case 'activity-edit': return <ActivityEditForm row={row} id={ask.id} onDone={onClose} />
  }
}
