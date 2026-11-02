// Notes: the family member's admin notes, their own tab — the master's, and a badge's from Admin up (Supervisor,
// Director…): the server opens them (family.notes_seen) and the page draws the tab only then.
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { notesOf, type FamilyNotes, type RosterRow } from '../familyModel'
import { readKey, readNotes, useFamilyRead, type ReadState } from '../useFamilyRead'
import { NoteComposer, NotesList } from '../FamilyForms'

export default function NotesSection({ row, writes, onEditNote }: {
  row: RosterRow
  writes: boolean
  onEditNote?: (id: string) => void
}) {
  const notes = useFamilyRead(readKey('familyProfileNotes', row.key), () => readNotes(row.key), notesOf)
  return <NotesView row={row} notes={notes} writes={writes} onEditNote={onEditNote} onRetry={notes.reload} />
}

export function NotesView({ row, notes, writes, onEditNote, onRetry }: {
  row: RosterRow
  notes: ReadState<FamilyNotes>
  /** the composer: the master's, or a holder's of the notes edition */
  writes: boolean
  /** a note's own panel: the master's, or a holder's of the notes edition */
  onEditNote?: (id: string) => void
  onRetry: () => void
}) {
  return (
    <SectionCard title="Admin notes">
      <div className="grid gap-4" data-family-notes="">
        {writes && <NoteComposer row={row} />}
        <NotesList notes={notes} onRetry={onRetry} onEdit={onEditNote} />
      </div>
    </SectionCard>
  )
}
