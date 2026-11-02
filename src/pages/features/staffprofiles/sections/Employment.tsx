// Employment, as pure data: Hiring, Employment Dates and Qualifications from the Master (staffProfileEmployment).
// The resume and the diploma open centred in the platform's viewer when a file is on record; a Yes/No flag with no…
import type { ReactNode } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import {
  cellWords, dateWords, diplomaWords, driverWords, employmentOf, endDayWords, mayEditSection, referralPaidWords,
  type RosterRow, type StaffAsk, type StaffEmployment, type StaffStatus,
} from '../staffModel'
import { readEmployment, readKey, useStaffDoc, useStaffRead, type ReadState, type StaffDocOpener } from '../useStaffRead'
import { Cell, CellGrid, EditPencil, EmptyNote, ReadLine, WhyNote } from '../StaffParts'
import { none, orNone } from '../staffValues'
import { useStaffViewer } from '../staffViewer'

export default function EmploymentSection({ row, onAsk }: { row: RosterRow; onAsk?: (ask: StaffAsk) => void }) {
  const employment = useStaffRead(readKey('staffProfileEmployment', row.key), () => readEmployment(row.key), employmentOf)
  const doc = useStaffDoc(row.key)
  return <EmploymentView row={row} employment={employment} doc={doc} onRetry={employment.reload} onAsk={onAsk} />
}

function DocButton({ id, title, subtitle, doc, children }: {
  id: string
  title: string
  subtitle: string
  doc: StaffDocOpener
  children: ReactNode
}) {
  const busy = doc.opening === id
  return (
    <button type="button" onClick={() => doc.open(id, { title, subtitle })} disabled={busy} data-open-doc={id} aria-busy={busy || undefined}
      className="inline-flex items-start gap-1.5 text-left font-medium text-primary hover:underline disabled:cursor-wait disabled:opacity-70">
      {busy ? <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" /> : <FileText size={14} className="mt-0.5 shrink-0" />}
      {children}
    </button>
  )
}

/** Only what was read: the person's documents, and the candidate record when the account links one. */
const RESUME_NOT_FOUND = 'no resume file in the documents read for this person'

function resumeCell(e: StaffEmployment, name: string, doc: StaffDocOpener): ReactNode {
  const r = e.hiring.resume
  if (r.doc_id) return <DocButton id={r.doc_id} title={`${name} — Resume`} subtitle="Hiring" doc={doc}>Resume on file</DocButton>
  if (r.flag === 'yes') return <span data-resume="flag">Flag: Yes · <span className="text-text-3">{RESUME_NOT_FOUND}</span></span>
  if (r.flag === 'no') return <span data-resume="flag">Flag: No · <span className="text-text-3">{RESUME_NOT_FOUND}</span></span>
  return none
}

export function EmploymentView({ row, employment, doc, onRetry, onAsk }: {
  row: RosterRow
  employment: ReadState<StaffEmployment>
  doc: StaffDocOpener
  onRetry: () => void
  /** the pencil (the master's, or an edition holder's) opens the record edit; absent, no pencil is drawn */
  onAsk?: (ask: StaffAsk) => void
}) {
  const edits = mayEditSection(useStaffViewer(), 'employment')
  const e = employment.data
  const status: StaffStatus = row.status
  const hs = e?.qualifications.hs_diploma
  const pencil = edits && onAsk ? <EditPencil section="employment" onAsk={onAsk} /> : undefined
  return (
    <div className="grid gap-5" data-employment="">
      <ReadLine state={employment} what="the employment record" onRetry={onRetry} />
      {e && !e.onMaster && (
        <EmptyNote kind="missing">No Employee Master row is read for this person{e.why ? ` — ${e.why}` : ''}. These fields are not on file here.</EmptyNote>
      )}
      {e && e.onMaster && <WhyNote why={e.why} degraded={e.degraded} />}
      {e && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <SectionCard title="Hiring" extra={pencil}>
            <CellGrid>
              <Cell label="Referral">{orNone(e.hiring.referral)}</Cell>
              <Cell label="Referral paid?">{orNone(referralPaidWords(e.hiring))}</Cell>
              <Cell label="Job application date">{orNone(dateWords(e.hiring.job_app_date) || e.hiring.job_app_date)}</Cell>
              <Cell label="Resume">{resumeCell(e, row.name, doc)}</Cell>
              <Cell label="Attestation date">{orNone(dateWords(e.hiring.attestation_date) || e.hiring.attestation_date)}</Cell>
            </CellGrid>
          </SectionCard>

          <SectionCard title="Employment Dates" extra={pencil}>
            <CellGrid>
              <Cell label="Start date (documented)">{orNone(cellWords(e.dates.start_doc))}</Cell>
              <Cell label="Start date (first day)">{orNone(cellWords(e.dates.start_first_day))}</Cell>
              <Cell label="End date (last day)">{orNone(endDayWords(e.dates.end_last_day, status))}</Cell>
            </CellGrid>
          </SectionCard>

          <SectionCard title="Qualifications" extra={pencil}>
            <CellGrid>
              <Cell label="High school diploma">
                {hs && hs.doc_id ? (
                  <DocButton id={hs.doc_id} title={`${row.name} — High school diploma`} subtitle="Qualifications" doc={doc}>
                    {diplomaWords(hs) || 'Diploma on file'}
                  </DocButton>
                ) : orNone(hs ? diplomaWords(hs) : '')}
              </Cell>
              <Cell label="Driver">{orNone(driverWords(e.qualifications.driver))}</Cell>
            </CellGrid>
          </SectionCard>
        </div>
      )}
    </div>
  )
}
