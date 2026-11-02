/** ops-flows (additive): computed summary strip under the header (e.g. "MUI Watch") — moved verbatim from SheetTemplate.tsx. */
import { AppIcon } from '@/lib/icons'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import type { SummaryStripConfig } from './types'

export function SummaryStrip({ summaryStrip, data }: { summaryStrip: SummaryStripConfig; data: any[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-surface px-4 py-3">
      <span className="flex items-center gap-2">
        <span
          className="grid h-7 w-7 place-items-center rounded-[9px]"
          style={{
            background: TINT_BG_VAR[summaryStrip.tint ?? 'pink'],
            color: TINT_VAR[summaryStrip.tint ?? 'pink'],
          }}
        >
          <AppIcon name={summaryStrip.icon ?? 'activity'} size={14} />
        </span>
        <span className="text-[13px] font-semibold text-text-1">{summaryStrip.title}</span>
      </span>
      {summaryStrip.items.map((it) => {
        let v: string | number = it.value ?? '—'
        if (it.compute) {
          try {
            v = it.compute(data)
          } catch {
            v = '—'
          }
        }
        return (
          <span key={it.label} className="flex items-center gap-1.5 text-[12px] text-text-3">
            <AppIcon name={it.icon} size={13} style={{ color: TINT_VAR[it.tint] }} />
            {it.label}
            <span className="font-stat text-[14px] font-bold text-text-1">{v}</span>
          </span>
        )
      })}
    </div>
  )
}
