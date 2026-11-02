// THE CARD'S SPREADSHEET, INSIDE THE PLATFORM — a sheet opens HERE, never outside: the Render Sheet shape, with…
// Render Sheet proved the shape and cannot serve this: its registry is the master's list of OTHER people's…
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Check, Columns3, Loader2, Plus, RefreshCw, Table2, Trash2, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type Grid = {
  tab: string
  tabs: string[]
  header: string[]
  rows: string[][]
  colors: string[][]
  truncated: boolean
  name: string
  url: string
}

const btn =
  'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-60'

export default function TaskBoardSheetPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const card = params.get('card') ?? ''
  const [grid, setGrid] = useState<Grid | null>(null)
  const [tab, setTab] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  /** which cell is being typed in — `r:c`, 1-based, matching the server */
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState('')
  /** naming a column or a tab, inline — never a browser dialog */
  const [naming, setNaming] = useState<'' | 'col' | 'tab'>('')
  const [newName, setNewName] = useState('')

  const load = useCallback(async (which?: string) => {
    if (!card) return
    setBusy(true)
    try {
      const g = await gasAction<Grid>('sheetBoardGrid', { id: card, tab: which ?? '' }, { timeoutMs: 60_000 })
      setGrid(g)
      setTab(g.tab)
      setFailed('')
    } catch (e) {
      // AN EMPTY GRID IS A CLAIM.
      setGrid(null)
      setFailed(e instanceof Error ? e.message : 'The spreadsheet did not load.')
    } finally {
      setBusy(false)
    }
  }, [card])

  useEffect(() => { void load() }, [load])

  const call = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      await gasAction(action, { id: card, tab, ...payload }, { timeoutMs: 60_000 })
      await load(tab)
    } catch (e) {
      toast({ type: 'danger', title: 'The sheet refused that',
              body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }

  const saveCell = async () => {
    const [r, c] = editing.split(':').map(Number)
    const value = draft
    setEditing('')
    if (!(r >= 1) || !(c >= 1)) return
    await call('sheetBoardCellSet', { row: r, col: c, value })
  }

  const commitName = async () => {
    const name = newName.trim()
    const what = naming
    setNaming(''); setNewName('')
    if (!name || !what) return
    await call(what === 'col' ? 'sheetBoardColAdd' : 'sheetBoardTabAdd', { name })
  }

  if (!card) {
    return (
      <div className="w-full p-6">
        <p className="text-[14px] text-text-2">Open this from a card on the Task Board Sheet.</p>
      </div>
    )
  }

  // fits the viewport: the chrome, 2.5rem for the shell's copyright line, and the strip at the top while it is up
  return (
    <div className="flex h-[calc(100dvh-150px-2.5rem-var(--hub-strip-h,0px))] w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* THE WAY BACK — with the sheet board open there was no way back.
            It goes to the board BY NAME
            rather than to history: this screen is opened from a card and from
            saved links, and only the first of those has a back to go to. */}
        <button
          onClick={() => navigate('/app/taskboard-sheet/board')}
          title="Back to the Task Board Sheet"
          className={cn(btn, 'shrink-0')}
        >
          <ArrowLeft size={14} /> Board
        </button>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-tint-mint text-tint-fg-mint">
          <Table2 size={16} />
        </span>
        <div className="mr-auto min-w-0">
          <p className="clamp-1 text-[15px] font-semibold text-text-1">{grid?.name || 'Spreadsheet'}</p>
          <p className="text-[12px] text-text-3">
            {grid ? `${grid.rows.length} row${grid.rows.length === 1 ? '' : 's'} · ${grid.header.length} column${grid.header.length === 1 ? '' : 's'}` : '—'}
            {grid?.truncated ? ' · showing the first 500' : ''}
          </p>
        </div>

        {(grid?.tabs ?? []).length > 1 && (
          <select
            value={tab}
            onChange={(e) => { setTab(e.target.value); void load(e.target.value) }}
            className="h-9 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1"
          >
            {(grid?.tabs ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button className={btn} disabled={busy} onClick={() => void load(tab)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
        <button className={btn} disabled={busy} onClick={() => void call('sheetBoardRowAdd', {})}>
          <Plus size={14} /> Row
        </button>
        <button className={btn} disabled={busy} onClick={() => { setNaming('col'); setNewName('') }}>
          <Columns3 size={14} /> Column
        </button>
        <button className={btn} disabled={busy} onClick={() => { setNaming('tab'); setNewName('') }}>
          <Plus size={14} /> Tab
        </button>
      </div>

      {naming && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
          <span className="text-[13px] font-medium text-text-2">
            Name the new {naming === 'col' ? 'column' : 'tab'}
          </span>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitName()
              if (e.key === 'Escape') { setNaming(''); setNewName('') }
            }}
            className="h-9 flex-1 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none focus:border-primary"
          />
          <button className={btn} onClick={() => void commitName()} disabled={!newName.trim()}>
            <Check size={14} /> Add
          </button>
          <button className={btn} onClick={() => { setNaming(''); setNewName('') }}>
            <X size={14} />
          </button>
        </div>
      )}

      {failed && (
        <p className="rounded-md border border-tint-amber bg-tint-amber/30 px-3 py-2 text-[13px] text-tint-fg-amber">
          {failed}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-surface">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              <th className="w-10 border-b border-r border-border px-2 py-1.5 text-left text-[11px] font-semibold text-text-3">#</th>
              {(grid?.header ?? []).map((h, c) => (
                <th key={c} className="min-w-[140px] border-b border-r border-border px-2.5 py-1.5 text-left font-semibold text-text-1">
                  {h || <span className="text-text-3">Column {c + 1}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(grid?.rows ?? []).map((row, r) => (
              <tr key={r} className="group">
                <td className="border-b border-r border-border px-2 py-1 text-[11px] text-text-3">
                  <span className="group-hover:hidden">{r + 1}</span>
                  <button
                    title={`Delete row ${r + 1}`}
                    onClick={() => void call('sheetBoardRowDelete', { row: r + 1 })}
                    className="hidden text-tint-fg-pink group-hover:block"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
                {(grid?.header ?? []).map((_, c) => {
                  const key = `${r + 1}:${c + 1}`
                  const bg = grid?.colors?.[r]?.[c]
                  return (
                    <td
                      key={c}
                      onDoubleClick={() => { setEditing(key); setDraft(row[c] ?? '') }}
                      style={bg && bg !== '#ffffff' ? { backgroundColor: bg } : undefined}
                      className={cn('border-b border-r border-border px-2.5 py-1 align-top text-text-1',
                        editing === key && 'p-0')}
                    >
                      {editing === key ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => void saveCell()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveCell()
                            if (e.key === 'Escape') setEditing('')
                          }}
                          className="h-8 w-full border-2 border-primary bg-surface px-2 text-[13px] text-text-1 outline-none"
                        />
                      ) : (
                        row[c] ?? ''
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {grid && grid.rows.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-text-3">
            Empty so far — press Row to start, then double-click a cell to type.
          </p>
        )}
      </div>
      <p className="text-[11.5px] text-text-3">Double-click a cell to edit it · hover a row number to delete it</p>
    </div>
  )
}
