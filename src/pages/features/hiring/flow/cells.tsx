// FLOW · the shared CELLS — the three little components every Flow view draws with (extracted from FlowPage.tsx).
// Components only: their vocabulary and helpers live beside them in ./shared.ts.
import { CheckCircle2, Clock, X } from 'lucide-react'
import { type ChecklistItem } from './shared'

// The nota's badge MOVED INTO THE ENGINE when the Pipeline card started wearing it too — the scorecard belongs on…
export { ScorecardBadge } from '@/engine/templates/pipeline/ScorecardChip'

// ------------------------------------------------------------------ the matrices' shared cells (Documents +…

export function MatrixCell({ item }: { item: ChecklistItem | undefined }) {
  if (!item) return <span title="Not yet applicable" className="text-text-3">–</span>
  if (item.status === 'done' || item.status === 'auto') {
    return <CheckCircle2 size={15} className="inline text-success" aria-label="On file" />
  }
  if (item.status === 'pending') return <Clock size={14} className="inline text-warning" aria-label="Pending" />
  return <X size={14} className="inline text-danger" aria-label="Missing" />
}

export function MatrixLegend() {
  return (
    <p className="flex items-center gap-3 px-3 py-2 text-[11.5px] text-text-3">
      <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-success" /> On file</span>
      <span className="flex items-center gap-1"><Clock size={12} className="text-warning" /> Pending</span>
      <span className="flex items-center gap-1"><X size={12} className="text-danger" /> Missing</span>
      <span className="flex items-center gap-1">– Not yet applicable</span>
    </p>
  )
}
