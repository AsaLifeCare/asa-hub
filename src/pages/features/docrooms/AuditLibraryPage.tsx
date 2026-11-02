// AUDIT LIBRARY — the old platform's case-folder cabinet, internalized.
// Absent from the gap list and ranked #3 in the survey after it: the "auditory" Drive folder — Audits / Internal…
import PageHeader from '@/components/shared/PageHeader'
import DriveReadingRoom from '@/components/shared/DriveReadingRoom'

export default function AuditLibraryPage() {
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Audit Library"
        subtitle="Audits, internal investigations and lawsuits — read in place, filed in Drive"
      />
      <DriveReadingRoom
        room="audits"
        tree
        emptyLine="No case files yet — what lands in the Auditory Drive folder appears here."
      />
    </div>
  )
}
