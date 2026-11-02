// FLOW · DOCUMENTS — ONE TABLE: what each candidate owes, and what was written about them.
// Documents and reports join into a SINGLE chart — and when the first attempt stacked two tables of the same…
import { Fragment, useState } from 'react'
import { FileText } from 'lucide-react'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import {
  type ChecklistItem, type FlowRow, usePhases, itemViewable, viewItemDoc,
} from './shared'
import { ScorecardBadge, MatrixCell, MatrixLegend } from './cells'
import { TableDocUploadModal } from '@/features/hiring/TableActionButtons'

// The first four live on the candidate row (talentChecklist_ ids); the seven documents live on the onboarding row…
const DOC_COLS = [
  { id: 'application', label: 'Application' },
  { id: 'resume', label: 'Resume' },
  { id: 'cjis', label: 'CJIS' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'dropbox-link', label: 'Dropbox' },
  { id: 'dodd-cert', label: 'DODD' },
  { id: 'cpr-cert', label: 'CPR' },
  { id: 'med-cert', label: 'Med' },
  { id: 'drivers-license', label: 'DL / ID' },
  { id: 'diploma', label: 'Diploma' },
  { id: 'ss-card', label: 'SS card' },
]

const TH = 'whitespace-nowrap px-1.5 py-1.5 text-center'

export function DocumentsSection({ rows, onb, onScorecard }: {
  rows: FlowRow[]
  onb: Record<string, ChecklistItem[]>
  // The interview column opens the scorecard; without it that column is a status like any other rather than a…
  onScorecard?: (r: FlowRow) => void
}) {
  const [open, setOpen] = useState('')
  // THE OWED CELL IS A DOOR TOO — the same upload pop-up on the warnings and the missing.
  const [uploadFor, setUploadFor] = useState<{ row: FlowRow; item: { id: string; label: string; status: string } } | null>(null)
  const { label: STAGE_LABEL, tint: STAGE_TINT } = usePhases()
  const sorted = rows.slice().sort((a, b) => a.name.localeCompare(b.name))
  const span = 2 + DOC_COLS.length + 4
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-max text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-3">
            <th className="whitespace-nowrap px-2.5 py-1.5">Candidate</th>
            <th className="whitespace-nowrap px-2.5 py-1.5">Phase</th>
            {DOC_COLS.map((c) => <th key={c.id} className={TH}>{c.label}</th>)}
            {/* WHAT WAS WRITTEN ABOUT THEM — the other half, in the same row */}
            {/* No rule between the halves — the line between SS card and
                Resume report goes; it is one table. */}
            <th className={TH}>Resume report</th>
            <th className={TH}>Phone screen</th>
            <th className={TH}>Interview</th>
            <th className={TH}>Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const hasSummary = !!(r.summary && r.summary.trim())
            const expanded = open === r.id
            return (
              // A Fragment cannot take a key from a `<>` shorthand, and the row needs one: two <tr> per person…
              <Fragment key={r.id}>
                <tr
                  onClick={hasSummary ? () => setOpen(expanded ? '' : r.id) : undefined}
                  className={cn('border-b border-border/60 last:border-0',
                    hasSummary && 'cursor-pointer hover:bg-surface-2/50')}
                >
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-text-1">
                    <DragPerson name={r.name} id={r.id} type="staff" subtitle={STAGE_LABEL[r.stage] ?? r.stage}>{r.name}</DragPerson>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', TINT_BG[STAGE_TINT[r.stage] ?? 'blue'], TINT_FG[STAGE_TINT[r.stage] ?? 'blue'])}>
                      {STAGE_LABEL[r.stage] ?? r.stage}
                    </span>
                  </td>
                  {DOC_COLS.map((c) => {
                    const item = r.checklist?.find((k) => k.id === c.id)
                      ?? onb[r.id]?.find((k) => k.id === c.id)
                    const viewable = !!item && itemViewable(r, item)
                    const owed = !!item && !viewable &&
                      (item.status === 'pending' || item.status === 'missing')
                    return (
                      // A CELL THAT OPENS SOMETHING HAS TO LOOK LIKE ONE — not even a green button: the document…
                      <td
                        key={c.id}
                        onClick={viewable
                          ? (e) => { e.stopPropagation(); void viewItemDoc(r, c.id, c.label) }
                          : owed
                            ? (e) => { e.stopPropagation(); setUploadFor({ row: r, item: { id: c.id, label: c.label, status: item!.status } }) }
                            : undefined}
                        title={viewable ? `Open ${c.label.toLowerCase()}` : owed ? `Upload ${c.label.toLowerCase()}` : undefined}
                        className={cn('px-1.5 py-1.5 text-center', (viewable || owed) && 'cursor-pointer')}
                      >
                        {viewable ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 hover:bg-success/20">
                            <MatrixCell item={item} />
                            <span className="text-[10px] font-bold uppercase tracking-wide text-success">open</span>
                          </span>
                        ) : (
                          <MatrixCell item={item} />
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1.5 py-1.5 text-center">
                    {hasSummary
                      ? <FileText size={14} className="inline text-primary" aria-label="Read below" />
                      : <span className="text-text-3">–</span>}
                  </td>
                  <td className="px-1.5 py-1.5 text-center">
                    <MatrixCell item={r.checklist?.find((k) => k.id === 'ai-report')} />
                  </td>
                  <td
                    onClick={onScorecard ? (e) => { e.stopPropagation(); onScorecard(r) } : undefined}
                    title={onScorecard ? 'Interview scorecard' : undefined}
                    className={cn('px-1.5 py-1.5 text-center', onScorecard && 'cursor-pointer hover:bg-surface-2/60')}
                  >
                    <MatrixCell item={r.checklist?.find((k) => k.id === 'interview-scorecard')} />
                  </td>
                  {/* The nota, with the same three answers the Reports table
                      gave: the badge, 'pending' when a resume is on file and
                      nobody has scored it, and '–' when there is no resume at
                      all. A dash where a pending score belongs is the screen
                      saying nothing is owed when something is. */}
                  <td className="px-1.5 py-1.5 text-center">
                    {r.resumeScorecard != null ? (
                      <ScorecardBadge score={r.resumeScorecard} />
                    ) : r.resumeLink || (r.checklist ?? []).some((k) => k.id === 'resume' && (k.status === 'done' || k.status === 'auto')) ? (
                      <span className="text-[11px] text-text-3">pending</span>
                    ) : (
                      <span className="text-text-3">–</span>
                    )}
                  </td>
                </tr>
                {expanded && hasSummary && (
                  <tr className="border-b border-border/60 bg-surface-2/40">
                    {/**
                     * THE SUMMARY HAS TO BE GIVEN A WIDTH, OR IT SETS ITS OWN
                     * — opening a document item pushed it off the screen.
                     *
                     * The table is `min-w-max` so eighteen columns can scroll
                     * sideways instead of being crushed. A cell with no width
                     * of its own then contributes its FULL text to that
                     * intrinsic width — so one paragraph laid itself out on a
                     * single line and dragged the whole table off the screen.
                     * The fixed inner width caps what this row contributes and
                     * lets the paragraph wrap; the viewport clamp keeps it
                     * honest on a narrow window.
                     */}
                    <td colSpan={span} className="px-3 py-2">
                      <div className="w-[1150px] max-w-[calc(100vw-340px)] whitespace-normal break-words text-[12.5px] leading-[1.6] text-text-2">
                        {r.summary}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <MatrixLegend />
      <TableDocUploadModal
        open={uploadFor != null}
        onOpenChange={(o) => { if (!o) setUploadFor(null) }}
        row={uploadFor ? { id: String(uploadFor.row.id), name: uploadFor.row.name, email: uploadFor.row.email, stage: uploadFor.row.stage } : { id: '', name: '', stage: '' }}
        item={uploadFor ? { ...uploadFor.item, stage: uploadFor.row.stage } : null}
        onUploaded={() => setUploadFor(null)}
      />
      <p className="px-3 pb-2 text-[11.5px] text-text-3">
        A green square marked <span className="font-bold uppercase text-success">open</span> is a
        document the platform can actually show you — press it and it opens inside the platform. A
        plain green square means the item is on file somewhere the platform cannot fetch from.
      </p>
    </Card>
  )
}
