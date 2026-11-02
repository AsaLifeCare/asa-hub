// Compliance: every course, current or not, with its expiry and pill, and under it the Med Del renewal running for…
// A course with no dated source says "No date on file" — never Current. Each card's pencil edits its dates; a course or a
// credential a paper answers files one (Upload paper), which is read for its date and confirmed into the record.
import type { ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import {
  SCREEN_META, TRAINING_META, complianceOf, dateWords, mayAsk, mayEditSection, trainingSub, type CourseFiling, type RosterRow,
  type ScreeningRow, type StaffAsk, type StaffCompliance,
} from '../staffModel'
import { readCompliance, readKey, useStaffRead, type ReadState } from '../useStaffRead'
import { EditPencil, EmptyNote, Pill, ReadLine, WhyNote } from '../StaffParts'
import { useStaffViewer } from '../staffViewer'

export default function ComplianceSection({ row, onAsk }: { row: RosterRow; onAsk?: (ask: StaffAsk) => void }) {
  const compliance = useStaffRead(readKey('staffProfileCompliance', row.key), () => readCompliance(row.key), complianceOf)
  return <ComplianceView row={row} compliance={compliance} onRetry={compliance.reload} onAsk={onAsk} />
}

function Line({ label, sub, date, pill, data, action }: {
  label: string
  sub?: string
  date: string
  pill: ReactNode
  data: string
  action?: ReactNode
}) {
  return (
    <li className="flex items-center gap-3 py-3" data-row={data}>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-text-1">{label}</p>
        {sub && <p className="mt-0.5 text-[12px] text-text-3">{sub}</p>}
      </div>
      <span className="shrink-0 text-[12.5px] tabular-nums text-text-2">{date || '—'}</span>
      <span className="w-[112px] shrink-0 text-right">{pill}</span>
      {action !== undefined && <span className="flex w-[118px] shrink-0 justify-end">{action}</span>}
    </li>
  )
}

/** Upload paper on a row a paper answers: the training document panel, on that requirement. */
export function UploadPaper({ filing, label, onAsk }: { filing: CourseFiling | null; label: string; onAsk: (ask: StaffAsk) => void }) {
  if (!filing?.files || !filing.reqId) return null
  return (
    <button type="button" onClick={() => onAsk({ kind: 'filedoc', course: filing.reqId })} data-upload-paper={filing.reqId}
      aria-label={`Upload a paper for ${label}`}
      className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
      <Upload size={13} /> Upload paper
    </button>
  )
}

const SCREEN_SUB: Record<string, string> = {
  state_registries: 'Abuser, sex offender, offender, nurse aide and exclusions registries',
}

function screenSub(r: ScreeningRow): string {
  if (r.id === 'bci_fbi') return r.rapbackDate ? `Rapback enrolled · ${dateWords(r.rapbackDate)}` : 'No Rapback entry on file'
  return SCREEN_SUB[r.id] ?? ''
}

export function ComplianceView({ row, compliance, onRetry, onAsk }: {
  row?: RosterRow
  compliance: ReadState<StaffCompliance>
  onRetry: () => void
  onAsk?: (ask: StaffAsk) => void
}) {
  const viewer = useStaffViewer()
  const c = compliance.data
  const edits = !!onAsk && mayEditSection(viewer, 'compliance')
  const files = !!onAsk && mayAsk(viewer, 'filedoc', row?.key ?? '')
  const pencil = edits && onAsk ? <EditPencil section="compliance" onAsk={onAsk} /> : undefined
  const upload = (filing: CourseFiling | null, label: string): ReactNode | undefined =>
    (files && onAsk ? <UploadPaper filing={filing} label={label} onAsk={onAsk} /> : undefined)
  return (
    <div className="grid gap-5" data-compliance="">
      <ReadLine state={compliance} what="the compliance record" onRetry={onRetry} />
      {c && <WhyNote why={c.why} degraded={c.degraded} />}
      {c && (
        <>
          <SectionCard title="Training" extra={pencil}
            sub={c.windowDays !== null ? `Due Soon is within ${c.windowDays} days of expiry.` : undefined}>
            {c.training.length === 0 ? <EmptyNote>No course is on file for this person.</EmptyNote> : (
              <ul className="divide-y divide-border" data-training="">
                {c.training.map((t) => (
                  <Line key={t.id || t.label} data={t.id || t.label} label={t.label} date={dateWords(t.expires)}
                    sub={trainingSub(t) || undefined}
                    pill={<Pill meta={TRAINING_META[t.state]} />} action={upload(t.filing, t.label)} />
                ))}
              </ul>
            )}
          </SectionCard>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <SectionCard title="Credentials" extra={pencil}>
              {c.credentials.length === 0 ? <EmptyNote>No credential is on file.</EmptyNote> : (
                <ul className="divide-y divide-border" data-credentials="">
                  {c.credentials.map((t) => (
                    <Line key={t.id} data={t.id} label={t.label} sub={t.note || undefined} date={dateWords(t.expires)}
                      pill={<Pill meta={TRAINING_META[t.state]} />} action={upload(t.filing, t.label)} />
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Screening Summary" extra={pencil}>
              {c.screening.length === 0 ? <EmptyNote>No screening is on file.</EmptyNote> : (
                <ul className="divide-y divide-border" data-screening="">
                  {c.screening.map((s) => (
                    <Line key={s.id} data={s.id} label={s.label} sub={screenSub(s) || undefined} date={dateWords(s.date)}
                      pill={<Pill meta={SCREEN_META[s.state]} />} />
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
