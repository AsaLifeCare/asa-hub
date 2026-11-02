// Notes: the SSA's admin notes, their own tab — the master's, and whom the server opens them to (App Control's Notes
// row, else a badge from Admin up: Supervisor, Director…); the page draws the tab only then.
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { notesOf, ssaHiddenFor, type RosterRow, type SsaNotes } from '../ssaModel'
import { readKey, readNotes, useSsaRead, type ReadState } from '../useSsaRead'
import { NoteComposer, NotesList } from '../SsaForms'

export default function NotesSection({ row, write }: { row: RosterRow; write: boolean }) {
  const notes = useSsaRead(readKey('ssaProfileNotes', row.key), () => readNotes(row.key), notesOf)
  return <NotesView row={row} notes={notes} write={write} onRetry={notes.reload} />
}

export function NotesView({ row, notes, write, onRetry, master }: {
  row: RosterRow
  notes: ReadState<SsaNotes>
  /** the composer: the master's own session, or a holder of the notes edition */
  write: boolean
  onRetry: () => void
  /** the master in its own session; the session's own when not given */
  master?: boolean
}) {
  const sessionMaster = useEffectiveIsMaster()
  // the Updated stamps follow Settings › My Work's SSA switch, as the answer carries it
  const stampHidden = ssaHiddenFor(master ?? sessionMaster, notes.data?.hidden).updated
  return (
    <SectionCard title="Admin notes">
      <div className="grid gap-4" data-ssa-notes="">
        {write && <NoteComposer row={row} />}
        <NotesList notes={notes} onRetry={onRetry} stamp={!stampHidden} />
      </div>
    </SectionCard>
  )
}
