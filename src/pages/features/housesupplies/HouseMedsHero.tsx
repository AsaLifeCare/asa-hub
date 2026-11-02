// THE BLACK HEADER — what the pharmacy's reports say, on the kit's one dark surface (the ReferralsHero anatomy…
// Four figures: the latest report and its age (amber once the next one is overdue), the prescriptions on record…
import { motion } from 'framer-motion'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { heroBand } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { fmtDay, span, type Band, type HeroFigures, type MedsView } from '@/lib/houseMedsAnalysis'
import type { HouseMedsState } from './useHouseMeds'

const BANDS: { id: Band; label: string; tint: 'mint' | 'amber' | 'danger' | 'lavender' }[] = [
  { id: 'plenty', label: 'Plenty left (over 7)', tint: 'mint' },
  { id: 'low', label: 'Low (1–7)', tint: 'amber' },
  { id: 'none', label: 'None left', tint: 'danger' },
  { id: 'ending', label: 'Ending this report', tint: 'lavender' },
]

function clock(ms: number | string): string {
  const d = typeof ms === 'number' ? new Date(ms) : new Date(String(ms))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function Figure({ value, label, sub, tone, onClick }: {
  value: string
  label: string
  sub: string
  tone?: 'amber'
  onClick?: () => void
}) {
  const body = (
    <>
      <p className="font-stat text-[34px] leading-none text-white" style={tone ? { color: heroBand('amber') } : undefined}>
        {value}
      </p>
      <p className="mt-1.5 text-[12px] font-medium text-white/80">{label}</p>
      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-white/50" style={tone ? { color: heroBand('amber') } : undefined}>
        {sub}
      </p>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick}
      className="min-w-0 rounded-md text-left outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-white/40">
      {body}
    </button>
  ) : <div className="min-w-0">{body}</div>
}

export default function HouseMedsHero({ state, figures, view, canImport, onOpen, onRetry }: {
  state: HouseMedsState
  figures: HeroFigures | null
  view: MedsView | null
  canImport: boolean
  onOpen: (tab: 'medications' | 'import', show?: string) => void
  onRetry: () => void
}) {
  const dash = '—'
  const f = figures
  const bandTotal = f ? BANDS.reduce((n, b) => n + f.band[b.id], 0) : 0
  const folder = view?.folder ?? {}
  const folderWords = !folder.at ? 'the folder has not been read yet'
    : folder.error ? `folder last read ${clock(folder.at)}, it could not be read`
      : `folder last read ${clock(folder.at)}, ${folder.new ? `${folder.new} new waiting` : 'nothing new'}`
  const unread = state.status === 'failed' && !view
  return (
    <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
        Pharmacy reports · {view?.pharmacy || 'A Brighter Dawn'}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        <Figure
          value={f?.latest ? `${f.latest.ageDays}d` : dash}
          label="Latest report"
          sub={f?.latest ? (f.latest.overdue ? `Overdue — the next report was due ${fmtDay(f.latest.due)}` : f.latest.span)
            : unread ? 'The reports could not be read' : 'No report is on file yet'}
          tone={f?.latest?.overdue ? 'amber' : undefined}
        />
        <Figure
          value={f ? f.onRecord.count.toLocaleString() : dash}
          label="On record now"
          sub={f ? `for ${f.onRecord.clients} client${f.onRecord.clients === 1 ? '' : 's'} in ${f.onRecord.houses} house${f.onRecord.houses === 1 ? '' : 's'}`
            : 'Dispensed in the last two reports'}
          onClick={f ? () => onOpen('medications') : undefined}
        />
        <Figure
          value={f ? f.low.count.toLocaleString() : dash}
          label="Running low"
          sub={f ? `7 or fewer left on the prescription · ${f.low.none} with none left` : 'Left on the prescription'}
          tone={f && f.low.none > 0 ? 'amber' : undefined}
          onClick={f ? () => onOpen('medications', 'low') : undefined}
        />
        <Figure
          value={f ? f.reports.count.toLocaleString() : dash}
          label="Reports on file"
          sub={f && f.reports.since
            ? `of ${f.reports.expected} periods since ${fmtDay(f.reports.since)}, ${f.reports.since.slice(0, 4)} · ${f.reports.missing} missing · ${f.reports.duplicates} duplicate${f.reports.duplicates === 1 ? '' : 's'} refused`
            : 'Imported from the pharmacy folder'}
          onClick={f && canImport ? () => onOpen('import') : undefined}
        />
      </div>

      <div className="mt-6">
        <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-white/10">
          {f && bandTotal > 0 && BANDS.map((b) => (f.band[b.id] ? (
            <motion.span
              key={b.id}
              title={`${f.band[b.id]} · ${b.label}`}
              initial={{ width: 0 }}
              animate={{ width: `${(f.band[b.id] / bandTotal) * 100}%` }}
              transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ background: heroBand(b.tint) }}
            />
          ) : null))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-white/65">
          {BANDS.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: heroBand(b.tint) }} />
              {b.label}
              <span className="font-stat text-white/90">{f ? f.band[b.id].toLocaleString() : dash}</span>
            </span>
          ))}
        </div>
      </div>

      {(f?.facilitySwitch || (view?.gaps.length ?? 0) > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {f?.facilitySwitch && (
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] text-white/75">{f.facilitySwitch}</span>
          )}
          {(view?.gaps ?? []).map((g) => (
            <span key={g.start} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px]"
              style={{ color: heroBand('amber') }}>
              Missing {span(g.start, g.end)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-white/10 pt-3.5">
        {state.status === 'loading' && !view && (
          <p className="text-[12px] text-white/55">Reading the pharmacy reports…</p>
        )}
        {view && (
          <p className="text-[12px] leading-[1.6] text-white/55">
            {[state.readAt ? `Read ${clock(state.readAt)}` : '', folderWords,
              view.summary.held ? `${view.summary.held} held for a person` : '',
              view.summary.failed ? `${view.summary.failed} could not be read` : ''].filter(Boolean).join(' · ')}
          </p>
        )}
        {view?.scope.why && (
          <p className="mt-1.5 text-[12px] leading-[1.55] text-white/60">{view.scope.why}</p>
        )}
        {state.status === 'failed' && (
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] leading-[1.55]" style={{ color: heroBand('amber') }}>
            <AlertTriangle size={13} className="shrink-0" />
            <span>The reports could not be read — {state.error || 'no answer'}.</span>
            <button type="button" onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] text-white/85 hover:bg-white/15">
              <RotateCw size={11} /> Try again
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
