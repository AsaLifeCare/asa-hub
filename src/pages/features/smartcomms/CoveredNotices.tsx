/** The automatic "covered" follow-ups (CommOpenShiftCovered.gs) and what each did, so nobody sends it twice. */
import { useCallback, useEffect, useState } from 'react'
import { CheckCheck, Loader2, Printer, RefreshCw, Share2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import ExportMenu from '@/components/shared/ExportMenu'
import { gasAction } from '@/features/hiring/shared'
import { share } from '@/stores/useShareStore'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import {
  COVERED_COLUMNS, coveredChip, coveredSentence, type CoveredBoard,
} from '@/pages/features/smartcomms/coveredLogic'

const ICON_BTN = 'grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

export default function CoveredNotices({ initial }: { initial?: CoveredBoard | null }) {
  const [board, setBoard] = useState<CoveredBoard | null>(initial ?? null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!initial)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await gasAction<CoveredBoard>('openShiftCoveredBoard', {}, { timeoutMs: 120_000 })
      setBoard(d)
      setError('')
    } catch (e) {
      /* the list stays as it was — a failed refresh is not an empty list */
      setError(e instanceof Error && e.message ? e.message : 'The follow-ups could not be read.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { if (!initial) void load() }, [load, initial])

  /* hidden entirely from readers it is not open to */
  if (board && !board.can_see) return null
  const items = board?.items ?? []

  return (
    <section className="mt-8" aria-label="Covered, said by itself">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
            <CheckCheck size={16} className="text-text-3" />
            “Covered” — said by itself
            <span className="ml-1 font-stat text-[12.5px] text-text-3">{board ? items.length : '—'}</span>
          </h2>
          <p className="mt-0.5 max-w-[80ch] text-[12.5px] leading-5 text-text-2">
            When a call-off’s shift is filled on Requests, the people its URGENT OPEN SHIFT reached are told it is
            covered — once, and nobody else. There is no need to broadcast it again.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Refresh the follow-ups" title="Refresh" onClick={() => void load()} className={ICON_BTN}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <ExportMenu filename="covered-follow-ups" columns={COVERED_COLUMNS} rows={items} />
          <button
            type="button"
            aria-label="Share these follow-ups"
            title="Share these follow-ups"
            onClick={() => share({
              title: 'Covered — said by itself',
              subtitle: `${items.length} ${items.length === 1 ? 'follow-up' : 'follow-ups'} — as shown on screen`,
              rows: items,
              columns: COVERED_COLUMNS,
              filename: 'covered-follow-ups',
              icon: 'check-check',
            })}
            className={ICON_BTN}
          >
            <Share2 size={15} />
          </button>
          <button type="button" aria-label="Print" title="Print these follow-ups" onClick={() => window.print()} className={ICON_BTN}>
            <Printer size={15} />
          </button>
        </div>
      </div>

      {board && (
        <p className="mb-3 text-[11.5px] leading-4 text-text-3">
          {board.situation.on
            ? <>The words are the Desk’s (row <span className="font-mono">open_shift_covered</span>): <span className="whitespace-pre-wrap font-mono text-text-2">{board.situation.sms_text}</span></>
            : <>The row <span className="font-mono">open_shift_covered</span> is switched off on the Desk — nothing is said until it is on.</>}
        </p>
      )}
      {(error || board?.error) && (
        <p className="mb-3 rounded-md bg-tint-amber px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
          {board?.error || error}
        </p>
      )}

      {!board ? (
        <p className="flex items-center gap-2 py-4 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading…
        </p>
      ) : items.length === 0 && !board.error ? (
        <Card padded={false} className="p-5">
          <p className="text-[13px] font-semibold text-text-1">No call-off shift has been filled since this began</p>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-5 text-text-2">
            Each one lands here with what the follow-up did — told, written into the mock outbox while test mode is
            on, or why nothing was sent.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const chip = coveredChip(it.state)
            const said = coveredSentence(it)
            return (
              <Card key={it.id} padded={false} className="p-4">
                <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
                  <span>{it.at ? ohioDateTime(it.at) : '—'}</span>
                  <span>·</span>
                  <span className="font-semibold text-text-2">{it.house || 'a house the call did not name'}</span>
                  <span>·</span>
                  <span>shift {it.day || '—'}</span>
                  {it.audience !== null && (
                    <>
                      <span>·</span>
                      <span>the ask reached <span className="font-stat">{it.audience}</span></span>
                    </>
                  )}
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', TINT_BG[chip.tint], TINT_FG[chip.tint])}>
                    {chip.label}
                  </span>
                </p>
                <p className={cn('mt-2 rounded-md px-3 py-2 text-[12.5px] leading-5', TINT_BG[said.tone], TINT_FG[said.tone])}>
                  {said.text}
                </p>
                {it.why && <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">{it.why}</p>}
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}
