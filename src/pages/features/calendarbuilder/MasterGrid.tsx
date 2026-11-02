/** The Builder's "All houses · master grid": every house at once, its own draft, published through the fail-closed doors. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck2, CloudUpload, Home, Loader2, ShieldAlert, Wand2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import BuilderGrid from './BuilderGrid'
import { useBuilderRefresh } from './builderRefresh'
import { testModeHolds, type MasterSummary } from './calendarScreen'
// the Shift Board's Time switch, and the same one: the draft grid carries the same cell texts, so one person's…
import ClockTimesToggle from '@/pages/features/shifts/ClockTimesToggle'
import { useClockTimes } from '@/pages/features/shifts/clockPref'
import { AMBER_NOTE } from '@/pages/features/shifts/shiftUi'
import type { GridCell, GridRow } from './useCalendarData'
import {
  builderLane, draftKey, generateSummary, PublishRefused,
  type BuilderLaneData, type DraftEntry, type HousePublishResult, type PublishBlocked,
} from './useBuilderLane'

// The quick picks, read off the estate's own spelling — the free-text box stays for everything the list has not…
const QUICK_SHIFTS = ['7A-230P', '7A-3P', '230P-10P', '2P-10P', '10P-7A', '10P-8A', '8A-8P', '8P-8A', 'OFF', 'R/O']

/** 'YYYY-MM-DD' → 'Mon D' — local-noon parse, never `new Date(iso)`. */
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '')
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The 28-day master grid, every house; drawn only for a reader the relay says edits every house. */
export default function MasterGrid({ onSummary, publishAsk = 0 }: {
  /** what the band's tiles say: the master draft, its conflicts, test mode (null while unread) */
  onSummary?: (summary: MasterSummary | null) => void
  /** a band tile asking for the Publish review; each new value asks again */
  publishAsk?: number
}) {
  const [data, setData] = useState<BuilderLaneData | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ row: GridRow; cell: GridCell } | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [housesOpen, setHousesOpen] = useState(false)
  const [blocked, setBlocked] = useState<PublishBlocked[] | null>(null)

  const load = useCallback(() => {
    setFailed('')
    builderLane.grid()
      .then(setData)
      .catch((err) => setFailed(err instanceof Error ? err.message : 'The calendar service did not answer.'))
  }, [])
  useEffect(() => { load() }, [load])
  useBuilderRefresh(load)

  /** test mode as the grid's door says it; a door that did not say is not "off" */
  const held = data?.test_mode ? testModeHolds(data) : undefined
  const told = onSummary
  useEffect(() => {
    told?.(data ? { drafts: data.draftCount, conflicts: data.conflicts.length, testMode: held } : null)
  }, [told, data, held])
  // a band tile asks for the review; nothing staged has nothing to review
  const [asked, setAsked] = useState(publishAsk)
  if (asked !== publishAsk) {
    setAsked(publishAsk)
    if (publishAsk && (data?.draftCount ?? 0) > 0) { setBlocked(null); setPublishOpen(true) }
  }

  const draftMap = useMemo(() => {
    const m = new Map<string, DraftEntry>()
    for (const d of data?.draft ?? []) m.set(draftKey(d.sheetRow, d.date), d)
    return m
  }, [data])

  const run = useCallback(async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      if (done) toast({ type: 'success', title: done })
      load()
    } catch (err) {
      if (err instanceof PublishRefused) {
        setBlocked(err.blocked)
        setPublishOpen(false)
      } else {
        toast({ type: 'danger', title: 'The calendar service refused', body: err instanceof Error ? err.message : 'Try again.' })
      }
    } finally {
      setBusy(false)
    }
  }, [busy, load])

  const commitCell = useCallback((sheetRow: number, dateIso: string, value: string) => {
    setEditing(null)
    void run(() => builderLane.setCell(sheetRow, dateIso, value), '')
  }, [run])

  /** a grid that arrived is one this reader may edit */
  const mayEdit = data !== null
  const draftCount = data?.draftCount ?? 0
  const conflictCount = data?.conflicts.length ?? 0
  // The Time switch — the grid below drawn in clock times.
  const clock = useClockTimes()

  return (
    <div>
      {/* the desk's toolbar: draft state, the two staging doors, publish */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <span className={cn(
          'rounded-full px-2.5 py-1 text-[12px] font-semibold',
          draftCount > 0 ? 'bg-tint-amber text-tint-fg-amber' : 'bg-surface-3 text-text-3',
        )}>
          {draftCount === 0 ? 'No draft edits' : `${draftCount} draft edit${draftCount === 1 ? '' : 's'}`}
        </span>
        <span className={cn(
          'rounded-full px-2.5 py-1 text-[12px] font-semibold',
          conflictCount > 0 ? 'bg-tint-danger text-tint-fg-danger' : 'bg-surface-3 text-text-3',
        )}>
          {conflictCount === 0 ? 'No conflicts' : `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <ClockTimesToggle />
          {mayEdit && (
            <>
              <button
                onClick={() => void run(async () => {
                  const r = await builderLane.generate()
                  toast({
                    type: 'success',
                    title: `${r.staged} blank cell${r.staged === 1 ? '' : 's'} filled from staff patterns`,
                    body: generateSummary(r),
                  })
                }, '')}
                disabled={busy}
                title="Fill the period's blank cells from each person's own shift pattern, preferences and time-off — staged as draft, never touching cells that already say something"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <Wand2 size={14} /> Auto-fill blanks
              </button>
              <button
                onClick={() => void run(async () => {
                  const r = await builderLane.applyRequests()
                  toast({ type: 'success', title: `${r.applied} edit${r.applied === 1 ? '' : 's'} staged from approved time off` })
                }, '')}
                disabled={busy}
                title="Stage approved (scheduled) time off as R/O draft edits — displaced shifts move to OPEN slots; requests still waiting are left alone"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <CalendarCheck2 size={14} /> Apply time-off
              </button>
              <button
                onClick={() => setHousesOpen(true)}
                disabled={busy}
                title="Push each house block to the live house-calendars workbook (what Live reads) — a dry run reviews first"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <Home size={14} /> Houses…
              </button>
              <button
                onClick={() => { setBlocked(null); setPublishOpen(true) }}
                disabled={busy || draftCount === 0}
                title={draftCount === 0 ? 'Nothing staged yet'
                  : held ? 'Test mode holds roster writes: the door refuses this publish and keeps the draft'
                    : 'Review and publish the draft to the Google workbook'}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <CloudUpload size={14} /> Publish master grid…
                <span className="rounded-[6px] bg-white/20 px-1.5 text-[10px] tracking-[0.05em]">LIVE</span>
              </button>
            </>
          )}
        </span>
      </div>

      {/* test mode holds roster writes: the master publish is refused, said before it is pressed */}
      {held && (
        <div className={cn('mb-3 flex items-start gap-2 rounded-md px-3 py-2', AMBER_NOTE)}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[12px] leading-5 text-text-1">
            {held === 'on' ? 'Test mode is on' : 'Test mode could not be read, so it holds'}: Publish master grid is
            refused and the draft is kept as it is. Houses… records each house&apos;s cells on the platform instead
            of the workbook.
          </p>
        </div>
      )}

      {blocked && (
        <Card className="mb-3 border-tint-danger p-3">
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-text-1">
            <ShieldAlert size={15} className="text-tint-fg-danger" />
            The publish stopped — {blocked.length} cell{blocked.length === 1 ? '' : 's'} moved under the draft
          </p>
          <ul className="max-h-48 space-y-1 overflow-auto text-[12px] text-text-2">
            {blocked.map((b, i) => (
              <li key={i} className="rounded-sm bg-surface-2 px-2 py-1">
                <strong>{b.employee || `row ${b.sheetRow}`}</strong>
                {b.house ? ` · ${b.house}` : ''} · {fmtDay(b.date)} — {b.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-text-3">
            Refresh to see the sheet as it is now, then stage those cells again.
          </p>
        </Card>
      )}

      {failed ? (
        <Card className="p-6 text-center text-[13px] text-text-3">{failed}</Card>
      ) : !data ? (
        <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Loading the live grid…
        </p>
      ) : data.rows.length === 0 ? (
        <EmptyState title="The grid is empty" body="The current period has no roster rows." />
      ) : (
        <BuilderGrid
          cols={data.period.cols}
          rows={data.rows}
          draft={draftMap}
          mayEdit={mayEdit}
          clock={clock}
          onEditCell={(row, cell) => setEditing({ row, cell })}
          onCopyCell={(_from, to) => {
            commitCell(to.row.sheetRow, to.cell.date, _from.cell.text)
          }}
        />
      )}

      {editing && (
        <CellEditor
          row={editing.row}
          cell={editing.cell}
          staged={draftMap.get(draftKey(editing.row.sheetRow, editing.cell.date))}
          onClose={() => setEditing(null)}
          onCommit={commitCell}
        />
      )}

      {publishOpen && data && (
        <MasterPublishReview
          draft={data.draft}
          rows={data.rows}
          onClose={() => setPublishOpen(false)}
          onConfirm={() => void run(async () => {
            const r = await builderLane.publish()
            setPublishOpen(false)
            toast({
              type: 'success',
              title: `Published ${r.written} cell${r.written === 1 ? '' : 's'} to the workbook`,
              body: `${r.appended} rows appended to the shift table.`,
            })
          }, '')}
        />
      )}

      {housesOpen && (
        <HousesPush
          onClose={() => setHousesOpen(false)}
          onDone={(written, testMode) => {
            setHousesOpen(false)
            toast(testMode ? {
              type: 'warning',
              title: `Recorded in test mode — ${written} cell${written === 1 ? '' : 's'}, not written to the house calendars`,
              body: 'Each house\'s cells wait under "Published in test mode" in its Builder, to be published or discarded once test mode is off.',
            } : {
              type: 'success',
              title: `Pushed ${written} cell${written === 1 ? '' : 's'} to the house calendars`,
              body: 'Live and the shift screens reflect them on the next mirror pass.',
            })
          }}
        />
      )}
    </div>
  )
}

/* ---------- the houses push: dry run first, always ---------- */

function HousesPush({ onClose, onDone }: {
  onClose: () => void; onDone: (written: number, testMode: boolean) => void
}) {
  const [plan, setPlan] = useState<HousePublishResult[] | null>(null)
  const [failed, setFailed] = useState('')
  const [pushing, setPushing] = useState(false)

  // the look before the leap: opening this modal IS the dry run
  useEffect(() => {
    builderLane.publishHouses(true)
      .then((r) => setPlan(r.houses))
      .catch((err) => setFailed(err instanceof Error ? err.message : 'The dry run did not answer.'))
  }, [])

  const total = (plan ?? []).reduce((n, h) => n + h.written, 0)
  const push = async () => {
    if (pushing) return
    setPushing(true)
    try {
      const r = await builderLane.publishHouses(false)
      onDone(r.written, Boolean(r.test_mode))
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'The push was refused.')
      setPushing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-lg border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-[14px] font-semibold text-text-1">Push the master grid to the house calendars</p>
        <p className="mb-3 text-[12px] text-text-3">
          One tab per house in the live workbook, matched by date and by name, through the same writer
          and the same checks as a house&apos;s own Publish. A house that does not answer, a layout
          that is not a roster grid, a name that does not match, a cell the house changed on its own
          since — skipped and listed; an overlap or a first shift nobody is free to train stops that
          house. Never forced.
        </p>
        {failed ? (
          <p className="p-4 text-center text-[13px] text-text-3">{failed}</p>
        ) : !plan ? (
          <p className="flex items-center justify-center gap-2 p-6 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Planning the push (dry run)…
          </p>
        ) : (
          <ul className="mb-3 min-h-0 flex-1 space-y-1 overflow-auto">
            {plan.map((h) => (
              <li key={h.house} className="rounded-sm bg-surface-2 px-2 py-1.5 text-[12px]">
                <span className="font-semibold text-text-1">{h.house}</span>
                <span className={cn('ml-2', h.status === 'refused' ? 'text-danger'
                  : h.written > 0 ? 'text-text-1' : 'text-text-3')}>
                  {h.status === 'skipped' ? 'skipped'
                    : h.status === 'refused' ? 'refused — nothing is written there'
                      : `${h.written} cell${h.written === 1 ? '' : 's'} to update`}
                </span>
                {/* cells the house's writer refused, named, never forced */}
                {(h.refused ?? []).slice(0, 3).map((c) => (
                  <span key={`${c.employee}|${c.col_iso}`} className="block text-danger">
                    {c.employee} · {c.col_iso}: {c.reason}
                  </span>
                ))}
                {h.skipped.length > 0 && (
                  <span className="ml-2 text-text-3" title={h.skipped.join('\n')}>
                    · {h.skipped.length} note{h.skipped.length === 1 ? '' : 's'}
                  </span>
                )}
                {(h.preview ?? []).slice(0, 2).map((p) => (
                  <span key={p.range} className="block text-text-3">
                    {p.range}: <span className="line-through">{p.from || '∅'}</span> → {p.to || '∅'}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
            Not yet
          </button>
          <button
            onClick={() => void push()}
            disabled={!plan || total === 0 || pushing}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pushing ? <Loader2 size={14} className="animate-spin" /> : <Home size={14} />}
            Push {total} cell{total === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- the cell editor ---------- */

function CellEditor({
  row, cell, staged, onClose, onCommit,
}: {
  row: GridRow
  cell: GridCell
  staged?: DraftEntry
  onClose: () => void
  onCommit: (sheetRow: number, dateIso: string, value: string) => void
}) {
  const [value, setValue] = useState(staged ? staged.value : cell.text)
  const shown = staged ? staged.value : cell.text
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-[14px] font-semibold text-text-1">{row.employee}</p>
        <p className="mb-3 text-[12px] text-text-3">
          {row.house} · {fmtDay(cell.date)}
          {staged ? ` · draft (sheet says ${staged.baseValue || 'empty'})` : shown ? ` · sheet says ${shown}` : ' · empty on the sheet'}
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {QUICK_SHIFTS.map((s) => (
            <button
              key={s}
              onClick={() => setValue(s)}
              className={cn(
                'rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors',
                value === s
                  ? 'border-primary bg-tint-primary text-tint-fg-primary'
                  : 'border-border bg-surface-2 text-text-2 hover:bg-surface-3',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommit(row.sheetRow, cell.date, value.trim()) }}
          placeholder="Or type it the way the houses write it — 230P-10P, BM > 8P-8A…"
          className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none focus:border-primary"
        />
        <div className="flex items-center justify-between">
          <button
            onClick={() => onCommit(row.sheetRow, cell.date, '')}
            className="rounded-md px-3 py-2 text-[13px] font-semibold text-text-3 transition-colors hover:bg-surface-2"
          >
            Clear cell
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
              Cancel
            </button>
            <button
              onClick={() => onCommit(row.sheetRow, cell.date, value.trim())}
              className="rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90"
            >
              Stage edit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- the publish review ---------- */

function MasterPublishReview({
  draft, rows, onClose, onConfirm,
}: {
  draft: DraftEntry[]
  rows: GridRow[]
  onClose: () => void
  onConfirm: () => void
}) {
  const byRow = useMemo(() => new Map(rows.map((r) => [r.sheetRow, r])), [rows])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-[14px] font-semibold text-text-1">
          Publish {draft.length} cell{draft.length === 1 ? '' : 's'} to the Master Calendar Creator?
        </p>
        <p className="mb-3 text-[12px] text-text-3">
          The workbook is also edited by hand — if any of these cells moved since they were staged,
          the publish stops and tells you instead of overwriting. Every written cell is logged with
          its previous value.
        </p>
        <ul className="mb-3 min-h-0 flex-1 space-y-1 overflow-auto">
          {draft.map((d) => {
            const row = byRow.get(d.sheetRow)
            return (
              <li key={`${d.sheetRow}-${d.date}`} className="flex items-center gap-2 rounded-sm bg-surface-2 px-2 py-1 text-[12px]">
                <span className="min-w-[140px] font-medium text-text-1">{row?.employee ?? `row ${d.sheetRow}`}</span>
                <span className="text-text-3">{row?.house} · {fmtDay(d.date)}</span>
                <span className="ml-auto text-text-3 line-through">{d.baseValue || '∅'}</span>
                <span className="text-text-3">→</span>
                <span className="font-semibold text-text-1">{d.value || '∅'}</span>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-[13px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
            Not yet
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90"
          >
            <CloudUpload size={14} /> Publish to Google
            <span className="rounded-[6px] bg-white/20 px-1.5 text-[10px] tracking-[0.05em]">LIVE: happens now</span>
          </button>
        </div>
      </div>
    </div>
  )
}
