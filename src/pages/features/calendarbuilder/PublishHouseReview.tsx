/** The Publish review: every drafted cell, base struck → value, those outside the days drawn too; a live act, said. */
import { useEffect } from 'react'
import { CloudUpload, Loader2 } from 'lucide-react'
import type { DraftEntry } from '@/pages/features/shifts/houseCalTypes'
import { AMBER_NOTE } from '@/pages/features/shifts/shiftUi'
import type { publishSummary } from './builderLogic'
import { publishGroups } from './calendarScreen'

export default function PublishHouseReview({
  location, drafts, summary, days, labelOf, saving, testMode, onClose, onConfirm,
}: {
  location: string
  drafts: DraftEntry[]
  summary: ReturnType<typeof publishSummary>
  /** the days drawn; drafts outside them are listed apart */
  days: { from: string; to: string } | null | undefined
  labelOf: (iso: string) => string
  saving: boolean
  /** test mode holds roster writes now (on, or unreadable) */
  testMode: 'on' | 'unreadable' | null
  onClose: () => void
  onConfirm: () => void
}) {
  const { inside, outside } = publishGroups(drafts, days)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const line = [
    `${summary.cells} cell${summary.cells === 1 ? '' : 's'} to ${location}`,
    summary.newPeople.length ? `${summary.newPeople.length} new row${summary.newPeople.length === 1 ? '' : 's'}` : '',
    summary.trainings ? `${summary.trainings} training${summary.trainings === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="publish-house-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-[16px] border border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2 sm:max-h-[80vh] sm:rounded-lg sm:pb-4"
        onClick={(e) => e.stopPropagation()}>
        <p id="publish-house-title" className="text-[14px] font-semibold text-text-1">
          Publish {summary.cells} cell{summary.cells === 1 ? '' : 's'} to {location}?
        </p>
        <p className="mt-0.5 text-[12.5px] text-text-2">{line}</p>
        <p className="mb-3 mt-1.5 text-[12px] leading-5 text-text-3">
          They are written into this house's tab of the house calendars workbook. If anybody changed
          one of these cells in the workbook since it was drafted, nothing is written and you are
          told which. Every shift is checked again for overlaps at every house first.
          {summary.newPeople.length > 0 && ` New rows: ${summary.newPeople.join(', ')}.`}
          {summary.trainings > 0 && ` ${summary.trainings} ${summary.trainings === 1 ? 'person has' : 'people have'} no IST for this house — publishing records the training as your approval, and a first shift nobody is free to train that hour stops the publish.`}
        </p>
        <div className="mb-3 min-h-0 flex-1 overflow-auto">
          <DraftList drafts={inside} labelOf={labelOf} />
          {outside.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Outside the days you are looking at · {outside.length}
              </p>
              <DraftList drafts={outside} labelOf={labelOf} />
            </>
          )}
        </div>
        {testMode && (
          <p className={`mb-3 rounded-md px-3 py-2 text-[12px] leading-5 text-text-1 ${AMBER_NOTE}`}>
            {testMode === 'on' ? 'Test mode is on' : 'Test mode could not be read, so it holds'}: Publish records
            these cells on the platform and does not write the workbook.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
            Not yet
          </button>
          <button onClick={onConfirm} disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} Publish the house
            <span className="rounded-[6px] bg-white/20 px-1.5 text-[10px] tracking-[0.05em]">LIVE: happens now</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function DraftList({ drafts, labelOf }: { drafts: DraftEntry[]; labelOf: (iso: string) => string }) {
  if (!drafts.length) return null
  return (
    <ul className="space-y-1">
      {drafts.map((d) => (
        <li key={`${d.employee}|${d.col_iso}`} className="rounded-sm bg-surface-2 px-2 py-1 text-[12px]">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="min-w-[140px] font-medium text-text-1">{d.employee}</span>
            <span className="text-text-3">{labelOf(d.col_iso)}</span>
            <span className="ml-auto text-text-3 line-through">{d.base || '∅'}</span>
            <span className="text-text-3">→</span>
            <span className="font-semibold text-text-1">{d.value || '∅'}</span>
          </span>
          {(d.note || d.ist) && (
            <span className="block text-[11px] text-text-3">{[d.note && `“${d.note}”`, d.ist].filter(Boolean).join(' · ')}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
