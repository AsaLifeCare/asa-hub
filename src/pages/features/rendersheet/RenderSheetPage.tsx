// RENDER SHEET — an app that renders sheets and NOTHING else: the 4-5 HUB_DB tabs every project leans on, drawn in…
// The server (RenderSheet.gs) is the whole law here: - the tab list is a literal whitelist — this screen renders…
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link2, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import SheetEditor, { type SheetEdit } from '@/components/shared/SheetEditor'
import RenderSheetHero, { openSheetFigures, renderSheetFigures, tabCounted, tabRowsLabel, type TabInfo } from './RenderSheetHero'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

type SheetList = {
  tabs: TabInfo[]; can_edit: boolean
  /** the registry of linked spreadsheets did not answer; the tabs are the rest */
  registry_unread?: boolean
}
type Grid = {
  tab: string; header: string[]; rows: string[][]; truncated: boolean
  /** the sheet's own paint, read in the same pass (RenderSheet.gs) */
  colors?: { back?: string[][]; fore?: string[][]; bold?: string[][] }
  frozen?: number
}

export default function RenderSheetPage({ pin, pinTitle }: { pin?: string; pinTitle?: string } = {}) {
  const [tabs, setTabs] = useState<TabInfo[] | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [active, setActive] = useState('')
  const [grid, setGrid] = useState<Grid | null>(null)
  const [gridLoading, setGridLoading] = useState(false)
  /** the tab whose last grid read failed — a failure, never "not answered yet" */
  const [gridFailedFor, setGridFailedFor] = useState('')
  const [registryUnread, setRegistryUnread] = useState(false)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  const loadList = useCallback(async (preferKey?: string) => {
    const res = await gasAction<SheetList>('renderSheetList', {})
    setTabs(res.tabs)
    setCanEdit(!!res.can_edit)
    setRegistryUnread(!!res.registry_unread)
    if (pin) {
      // PINNED MODE: an app embeds this screen open on ONE workbook — the first list entry whose title carries the…
      const hit = res.tabs.find((t) => t.tab.toLowerCase().includes(pin.toLowerCase()))
      setActive(hit?.key || '')
    } else {
      setActive((cur) => preferKey || cur || res.tabs[0]?.key || '')
    }
    return res
  }, [pin])

  const loadGrid = useCallback(async (key: string) => {
    if (!key) return
    setGridLoading(true)
    try {
      setGrid(await gasAction<Grid>('renderSheetGrid', { tab: key }))
      setGridFailedFor('')
      setError('')
    } catch (e) {
      // a blank grid must not read as "the tab is empty"
      setGridFailedFor(key)
      setError(e instanceof Error ? e.message : 'The sheet could not be read.')
    } finally {
      setGridLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    loadList().catch((e) => {
      if (alive) setError(e instanceof Error ? e.message : 'The sheet list could not be read.')
    })
    return () => { alive = false }
  }, [loadList])

  useEffect(() => { void loadGrid(active) }, [active, loadGrid])

  const refresh = () => {
    void loadList().catch(() => { /* the grid reload below still reports */ })
    void loadGrid(active)
  }

  // A linked spreadsheet leaves the list — two presses, never a browser dialog: the × arms, the second press within…
  const [armedRemove, setArmedRemove] = useState('')
  const removeLinked = async (key: string) => {
    if (armedRemove !== key) {
      setArmedRemove(key)
      setTimeout(() => setArmedRemove((a) => (a === key ? '' : a)), 2500)
      return
    }
    setArmedRemove('')
    try {
      await gasAction('renderSheetRemove', { id: key })
      toast({ type: 'success', title: 'Spreadsheet removed', body: 'Nothing inside it was touched.' })
      const res = await loadList(active === key ? '' : active)
      if (active === key) setActive(res.tabs[0]?.key || '')
    } catch (e) {
      toast({ type: 'danger', title: 'Not removed', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  // One cell, optimistically: the server compares `prev` with what the sheet holds NOW and refuses 409 when a…
  const commit = useCallback(async ({ row, col, value, prev }: SheetEdit) => {
    if (!grid) return
    const colIdx = Number(col.slice(1))
    const colName = grid.header[colIdx]
    try {
      const res = await gasAction<{ value: string }>('renderSheetCellSet', {
        tab: grid.tab, row: row + 1, col: colName, value, prev,
      })
      setGrid((g) => {
        if (!g || g.tab !== grid.tab) return g
        const rows = g.rows.map((r, i) => (i === row ? r.map((v, j) => (j === colIdx ? res.value : v)) : r))
        return { ...g, rows }
      })
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        toast({
          type: 'danger',
          title: 'The cell changed under you',
          body: 'Somebody edited it first — reloading the sheet with the fresh values.',
        })
        void loadGrid(grid.tab)
      } else {
        toast({
          type: 'danger',
          title: 'Edit not saved',
          body: err instanceof Error ? err.message : 'The server did not take the change — try again.',
        })
      }
    }
  }, [grid, loadGrid])

  const activeInfo = tabs?.find((t) => t.key === active)
  // The server already said no about this tab — obey it BEFORE anything opens.
  const readOnlyTab = !!activeInfo?.read_only
  // and never on a grid that belongs to the PREVIOUS tab: renderSheetGrid echoes the key it was asked for, so while…
  const mayEdit = canEdit && !readOnlyTab && (!grid || grid.tab === active)

  /** The opening surface — the list's own counts (renderSheetFigures). */
  const onGrid = grid && grid.tab === active ? grid : null
  const heroFigures = tabs
    ? renderSheetFigures(tabs, {
        ...openSheetFigures(activeInfo, onGrid, !!active && gridFailedFor === active),
        openReadOnly: readOnlyTab,
        canEdit,
      }, registryUnread)
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="w-full px-4 pb-16 pt-4 sm:px-6"
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold leading-7 text-text-1">
            {pin ? (pinTitle ?? pin) : 'Render Sheet'}
          </h1>
          <p className="mt-0.5 text-[13px] text-text-2">
            {readOnlyTab
              ? `${activeInfo?.tab ?? 'This tab'} is the engine's own ledger — read-only here. Only the engine that sends writes it.`
              : pin
                ? (canEdit ? 'The sheet itself, tools and all — double-click a cell to edit.'
                           : 'The sheet itself. Read-only for your badge.')
                : canEdit
                  ? 'Sheets, as sheets — add any spreadsheet by its link. Double-click a cell to edit.'
                  : 'Sheets, as sheets. Read-only for your badge.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && !pin && (
            <button
              onClick={() => setLinkOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <Link2 size={14} /> Add spreadsheet
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setAddOpen(true)}
              disabled={!grid || grid.header.length === 0 || gridLoading || readOnlyTab}
              title={readOnlyTab ? 'The engine owns this ledger — rows are not typed here.' : undefined}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              <Plus size={14} /> Add row
            </button>
          )}
          <button
            onClick={refresh}
            disabled={gridLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={gridLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {/* THE BLACK HEADER — the app's own, so it is drawn only when this
          screen IS the app. Pinned into another app, that app's header is
          already above this one. */}
      {!pin && (
        <RenderSheetHero
          read={tabs === null && error ? { state: 'failed', reason: error }
            : tabs === null ? { state: 'loading' } : { state: 'ready' }}
          figures={heroFigures}
          onRetry={refresh}
        />
      )}

      {/* Every sheet on the list — the built-ins and every spreadsheet added
          by link. One is open at a time; the × on a linked chip removes it
          (press twice — the first press arms). */}
      {pin && tabs !== null && !active && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-[13px] text-text-2">
          {registryUnread ? (
            <>
              The list of linked spreadsheets could not be read, so whether the <b>{pinTitle ?? pin}</b> workbook
              is linked is unknown right now — press <b>Refresh</b> to ask again.
            </>
          ) : (
            <>
              The <b>{pinTitle ?? pin}</b> workbook is not linked yet. Open <b>Render Sheet</b> (Manage)
              → <b>Add spreadsheet</b> and paste its link — this view lights up by itself.
            </>
          )}
        </div>
      )}
      {!pin && registryUnread && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-[13px] text-text-2">
          The list of linked spreadsheets could not be read — only the built-in sheets are shown. Press <b>Refresh</b> to ask again.
        </div>
      )}
      {tabs === null && !error ? (
        <p className="flex items-center gap-2 py-3 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the sheet list…
        </p>
      ) : pin ? null : (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {(tabs ?? []).map((t) => (
            <span key={t.key} className="inline-flex items-center">
              <button
                onClick={() => setActive(t.key)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 border px-3 font-mono text-[11.5px] font-semibold transition-colors',
                  t.source === 'linked' && canEdit && !t.key.startsWith('est_') ? 'rounded-l-full' : 'rounded-full',
                  active === t.key
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                  t.alive === false && 'opacity-50',
                )}
                title={t.alive === false
                  ? t.source === 'hub'
                    ? 'This tab could not be opened, or does not exist yet — its rows are not counted'
                    : 'The platform account lost access to this spreadsheet — its rows are not counted'
                  : undefined}
              >
                {t.source === 'linked' && <Link2 size={11} className="shrink-0" />}
                {t.tab}
                <span className={cn('text-[10px] font-normal', active === t.key ? 'opacity-80' : 'text-text-3')}>
                  {tabRowsLabel(t)}
                </span>
              </button>
              {/* estate built-ins (est_) have no × — the platform knows them
                  by property; there is nothing to unlink */}
              {t.source === 'linked' && canEdit && !t.key.startsWith('est_') && (
                <button
                  onClick={() => void removeLinked(t.key)}
                  title={armedRemove === t.key ? 'Press again to remove from the list' : 'Remove from the list'}
                  className={cn(
                    'inline-flex h-8 items-center rounded-r-full border border-l-0 px-1.5 transition-colors',
                    armedRemove === t.key
                      ? 'border-danger bg-tint-pink text-tint-fg-pink'
                      : 'border-border bg-surface text-text-3 hover:text-danger',
                  )}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-[12px] border border-border bg-tint-danger px-3 py-2.5 text-[13px] text-tint-fg-danger">
          {error}
        </div>
      )}

      {/* No silent caps: a trimmed sheet says so in one line. */}
      {grid?.truncated && (
        <p className="mb-2 text-[12px] text-text-3">
          Showing the first {grid.rows.length.toLocaleString()} rows
          {activeInfo && tabCounted(activeInfo) ? ` of ${activeInfo.rows.toLocaleString()}` : ''} — the rest stay in the sheet itself.
        </p>
      )}

      {grid && grid.header.length === 0 && !gridLoading && !error && (
        <p className="py-10 text-center text-[13px] text-text-2">
          This tab does not exist in the database yet — it appears here the day something writes it.
        </p>
      )}

      {grid && grid.header.length > 0 && (
        <SheetEditor
          title={activeInfo?.tab ?? grid.tab}
          // the sheet's own colours and the tools above the grid — the replica stops being a paler document
          colors={grid.colors}
          toolbar
          columns={grid.header.map((h, i) => ({ key: `c${i}`, label: h }))}
          rows={grid.rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, v])))}
          canEdit={mayEdit}
          onCommit={commit}
        />
      )}

      {!grid && gridLoading && (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading…
        </p>
      )}

      <AddRowModal
        // switching to a ledger while the modal is open closes it — the door must not survive the tab that allowed…
        open={addOpen && !readOnlyTab}
        header={grid?.header ?? []}
        tab={grid?.tab ?? ''}
        onClose={() => setAddOpen(false)}
        onAdded={() => { setAddOpen(false); refresh() }}
      />
      <AddSpreadsheetModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onAdded={(key) => { setLinkOpen(false); void loadList(key) }}
      />
    </motion.div>
  )
}

// A spreadsheet joins the list by its LINK.
function AddSpreadsheetModal({
  open, onClose, onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: (key: string) => void
}) {
  const [url, setUrl] = useState('')
  const [tabName, setTabName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setUrl(''); setTabName('') } }, [open])

  const submit = async () => {
    if (busy || !url.trim()) return
    setBusy(true)
    try {
      const res = await gasAction<{ id: string; title: string }>('renderSheetAdd', {
        url: url.trim(), tab: tabName.trim(),
      })
      toast({ type: 'success', title: 'Spreadsheet added', body: `${res.title} is on the list now.` })
      onAdded(res.id)
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Not added',
        body: err instanceof Error ? err.message : 'The server did not take it — try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            role="dialog"
            aria-modal="true"
            aria-label="Add a spreadsheet by link"
            className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div>
                <h2 className="text-[15px] font-bold text-text-1">Add spreadsheet</h2>
                <p className="mt-0.5 text-[12px] text-text-3">
                  Paste the Google Sheets link — the platform account must have access to it.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-sm p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-3">Spreadsheet link</span>
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  className="h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none transition-colors focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-3">Tab (optional — first tab when empty)</span>
                <input
                  value={tabName}
                  onChange={(e) => setTabName(e.target.value)}
                  placeholder="Sheet1"
                  className="h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none transition-colors focus:border-primary"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button
                onClick={onClose}
                className="h-9 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={busy || !url.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Add
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// One header-bound row — every column an optional text input, exactly the sheet's own vocabulary.
function AddRowModal({
  open, header, tab, onClose, onAdded,
}: {
  open: boolean
  header: string[]
  tab: string
  onClose: () => void
  onAdded: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) setValues({}) }, [open])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      // only what was typed — an empty input is not a value to write
      const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''))
      await gasAction('renderSheetRowAdd', { tab, values: filled })
      toast({ type: 'success', title: 'Row added', body: `A new row landed at the bottom of ${tab}.` })
      onAdded()
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Row not added',
        body: err instanceof Error ? err.message : 'The server did not take the row — try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            role="dialog"
            aria-modal="true"
            aria-label={`Add a row to ${tab}`}
            className="w-full max-w-2xl rounded-lg border border-border bg-surface shadow-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div>
                <h2 className="text-[15px] font-bold text-text-1">Add row</h2>
                <p className="mt-0.5 text-[12px] text-text-3">
                  Appended to the bottom of <span className="font-mono font-semibold">{tab}</span> — every field optional.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-sm p-1.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <X size={16} />
              </button>
            </div>
            <div className="scroll-thin grid max-h-[55vh] grid-cols-1 gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2">
              {header.map((h, i) => (
                <label key={`${h}-${i}`} className="block">
                  <span className="mb-1 block font-mono text-[11px] font-semibold text-text-2">{h || `(column ${i + 1})`}</span>
                  <input
                    value={values[h] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [h]: e.target.value }))}
                    className="h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none transition-colors focus:border-primary"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button
                onClick={onClose}
                className="h-9 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Add row
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// The Incidents app's Sheet tab — the "Asa | UIs and MUIs" workbook, pinned — two views, one of them the sheet…
export function UiMuiSheetPage() {
  return <RenderSheetPage pin="uis and muis" pinTitle="UIs & MUIs — the sheet" />
}

// The MAR app's Sheet tab — OUR OWN mar_entries tab (the eMAR history is copied into it once; the app feeds it from…
export function MarSheetPage() {
  return <RenderSheetPage pin="mar_entries" pinTitle="MAR — the sheet" />
}
