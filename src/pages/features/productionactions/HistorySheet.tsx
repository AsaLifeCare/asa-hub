import { Undo2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { ago, resultWord, runsFor, undoable, type PAction, type PRun } from '@/lib/productionActions'

const RESULT_TINT: Record<string, 'mint' | 'slate' | 'danger' | 'amber'> = {
  ok: 'mint', noop: 'slate', refused: 'amber', failed: 'danger',
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function HistoryBody({ action, runs, now, busy, onUndo }: {
  action: PAction
  runs: PRun[] | undefined
  now: number
  busy: boolean
  onUndo: (run: PRun) => void
}) {
  const mine = runsFor(action.id, runs).reverse()
  const undo = undoable(action.id, runs)
  return (
    <>
      {runs === undefined && <p className="text-[12.5px] text-tint-fg-amber">The History could not be read.</p>}
      {runs !== undefined && !mine.length && <p className="text-[12.5px] text-text-3">Nothing has happened to this action yet.</p>}
      <ol className="space-y-2.5">
        {mine.map((r) => (
          <li key={r.id} className="rounded-md border border-border bg-surface-2/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_PAIR(RESULT_TINT[r.result] ?? 'slate'))}>
                {resultWord(r)}
              </span>
              <span className="text-[12px] text-text-2">{when(r.createdAt)} · {ago(r.createdAt, now)}</span>
              {r.by_name && <span className="text-[12px] text-text-3">by {r.by_name}</span>}
              {r.test_mode && <span className="text-[11px] text-text-3">test mode {r.test_mode}</span>}
            </div>
            {r.target && <p className="mt-1.5 text-[12px] font-medium text-text-1">{r.target}</p>}
            {r.detail && <p className="mt-1 text-[12px] leading-[1.45] text-text-2">{r.detail}</p>}
            {r.act === 'rehearse' && r.mock_row_id && (
              <p className="mt-1 text-[11.5px] text-text-3">CommMock row {r.mock_row_id}</p>
            )}
            {undo && undo.id === r.id && (
              <button type="button" disabled={busy} onClick={() => onUndo(r)}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
                <Undo2 size={13} /> Undo
              </button>
            )}
          </li>
        ))}
      </ol>
    </>
  )
}

export default function HistorySheet({ action, runs, now, busy, onClose, onUndo }: {
  action: PAction | null
  runs: PRun[] | undefined
  now: number
  busy: boolean
  onClose: () => void
  onUndo: (run: PRun) => void
}) {
  return (
    <Sheet open={action !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface p-6 sm:max-w-[384px]">
        {action && (
          <>
            <SheetHeader className="mb-3">
              <SheetTitle className="font-display text-[17px] font-bold text-text-1">History · #{action.number} {action.title}</SheetTitle>
              <SheetDescription className="text-[12px] text-text-3">
                Every rehearsal, run, mark and undo, newest first.
              </SheetDescription>
            </SheetHeader>
            <HistoryBody action={action} runs={runs} now={now} busy={busy} onUndo={onUndo} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
