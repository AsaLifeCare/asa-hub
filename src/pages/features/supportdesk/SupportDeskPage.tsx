// SUPPORT REQUESTS — every Employee Support Hotline request and every Scheduling request in one table, opened in a…
// Apps Script decides whose rows these are, what each may be answered with and every status word (SupportDesk.gs…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SearchInput from '@/components/shared/SearchInput'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import RequestTable, { TableSkeleton } from './RequestTable'
import RequestPanel from './RequestPanel'
import SupportPageSwitch from './SupportPageSwitch'
import { adpAct, decide, useSupportDesk, type DeskState } from './supportDeskLane'
import {
  SEARCH_PLACEHOLDER, TEST_MODE_PILL, adpOpenHref, countChips, decideToast, emptyLine, isConflict, openRefOf, saidOf, sentence,
  sourceLines, visibleRows, type DecideAnswer, type Row, type SortDir, type Verdict,
} from './supportDeskModel'
import { useShellHides, useTestWarningsHidden } from '@/lib/myWorkHides'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'

export const PAGE_SUB = 'Every hotline request and every scheduling request, in one place.'
export const STALE_LINE = 'Could not refresh — showing the last answer'

export default function SupportDeskPage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [completed, setCompleted] = useState(false)
  const desk = useSupportDesk(completed)
  const opened = openRefOf(new URLSearchParams(search))
  const onOpen = useCallback((ref: string) => {
    navigate(`${pathname}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, { replace: true })
  }, [navigate, pathname])
  const [busy, setBusy] = useState('')

  const onDecide = async (row: Row, verdict: Verdict, note: string, to?: string) => {
    setBusy(`decide:${row.ref}`)
    try {
      const a = await decide(row.ref, verdict, note, to)
      toast(decideToast(verdict, a))
      if (!desk.absorb(a)) desk.reload()
    } catch (err) {
      toast({ type: isConflict(err) ? 'warning' : 'danger', title: isConflict(err) ? 'Somebody answered first' : 'Not recorded', body: saidOf(err) })
      if (isConflict(err)) desk.reload()
    } finally {
      setBusy('')
    }
  }

  const onAdp = async (row: Row, op: 'approve' | 'undo') => {
    setBusy(`adp:${row.ref}`)
    try {
      const a: DecideAnswer = await adpAct(row.ref, op, row.adp?.proof ?? '')
      toast({ type: a.changed === false ? 'info' : 'success', title: op === 'approve' ? 'Change approved' : 'Change undone', body: a.said || 'Recorded.' })
      if (!desk.absorb(a)) desk.reload()
      // an e-mail or phone is saved on the person's profile, through its own door
      const href = op === 'approve' ? adpOpenHref(a) : ''
      if (href) navigate(href, { state: { from: `${pathname}?ref=${encodeURIComponent(row.ref)}` } })
    } catch (err) {
      toast({ type: 'danger', title: 'Nothing was changed', body: saidOf(err) })
      if (isConflict(err)) desk.reload()
    } finally {
      setBusy('')
    }
  }

  return (
    <SupportDeskView state={desk} completed={completed} opened={opened} busy={busy}
      onCompleted={setCompleted} onOpen={onOpen} onReload={desk.reload}
      onDecide={(row, v, note, to) => void onDecide(row, v, note, to)} onAdp={(row, op) => void onAdp(row, op)} />
  )
}

export function SupportDeskView({ state, completed, opened, busy, onCompleted, onOpen, onReload, onDecide, onAdp, initialQuery = '' }: {
  state: DeskState
  completed: boolean
  /** the ref whose panel is open ('' for none) */
  opened: string
  busy: string
  onCompleted: (on: boolean) => void
  onOpen: (ref: string) => void
  onReload: () => void
  onDecide: (row: Row, verdict: Verdict, note: string, to?: string) => void
  onAdp: (row: Row, op: 'approve' | 'undo') => void
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [dir, setDir] = useState<SortDir>('desc')
  const board = state.board
  const rows = useMemo(() => (board ? visibleRows(board.rows, { query, completed, dir }) : []), [board, query, completed, dir])
  const row = board?.rows.find((r) => r.ref === opened) ?? null
  const lines = board ? sourceLines(board) : []
  // an address naming a request already completed (a link from My Inbox) shows the completed ones too
  const missing = Boolean(opened && board && !row && !state.refreshing)
  useEffect(() => { if (missing && !completed) onCompleted(true) }, [missing, completed, onCompleted])
  // Settings › My Work hides every test mode warning from anyone but the master
  const noTest = useTestWarningsHidden()
  // and the line under the title
  const master = useEffectiveIsMaster()
  const hides = useShellHides()
  const noSub = !master && hides.support_desk_subtitle

  return (
    <div className="w-full pb-16">
      <PageHeader title="Support Requests" subtitle={noSub ? undefined : PAGE_SUB}
        actions={(
          <>
            {board?.test_mode.on && !noTest && (
              <span className="inline-flex items-center rounded-full bg-tint-amber px-3 py-1 text-[12px] font-semibold text-tint-fg-amber" data-test-mode="">
                {TEST_MODE_PILL}
              </span>
            )}
            <SupportPageSwitch current="requests" />
            <button type="button" onClick={onReload} disabled={state.refreshing} data-act="refresh"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-50">
              <RefreshCw size={13} className={state.refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        )} />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-surface p-3 shadow-1" data-toolbar="">
        <SearchInput value={query} onChange={setQuery} placeholder={SEARCH_PLACEHOLDER} className="min-w-[220px] flex-1 sm:max-w-[420px]" />
        <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-text-2">
          <Switch checked={completed} onCheckedChange={(on) => onCompleted(on)} aria-label="Show completed" data-show-completed="" />
          Show completed
        </label>
        <button type="button" data-act="clear" onClick={() => { setQuery(''); onCompleted(false); if (missing) onOpen('') }}
          disabled={!query && !completed}
          className="h-9 rounded-md px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          Clear
        </button>
        {board && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5" data-counts="">
            {countChips(board).map((c) => (
              <span key={c.key} data-count={c.key}
                className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                  c.key === 'warnings' && c.n > 0 ? 'bg-tint-pink text-danger' : c.key === 'waiting_on_me' && c.n > 0 ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-text-2')}>
                {c.label} <span className="tabular-nums">{c.n}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {board && state.error && (
        <p role="alert" className="mb-3 text-[12.5px] text-[var(--warning)]" data-stale="">
          {STALE_LINE}: {sentence(state.error)}
        </p>
      )}
      {lines.map((l) => (
        <p key={l.key} role="status" data-source-why={l.key}
          className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-amber px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber">
          {l.text}
        </p>
      ))}
      {board && board.unreadRows > 0 && (
        <p role="status" className="mb-2 text-[12.5px] text-[var(--warning)]" data-unread-rows="">
          {board.unreadRows === 1 ? 'One request came back in a shape this screen cannot read; it is not listed.'
            : `${board.unreadRows} requests came back in a shape this screen cannot read; they are not listed.`}
        </p>
      )}
      {board?.note && <p className="mb-3 text-[12.5px] text-text-3" data-note="">{sentence(board.note)}</p>}
      {missing && completed && (
        <p role="status" className="mb-3 text-[12.5px] text-[var(--warning)]" data-missing={opened}>
          {`${opened} is not on the list any more, or it is not shown to you.`}
        </p>
      )}
      {board && !board.directors_readable && board.directors_why && (
        <p className="mb-3 text-[12.5px] text-[var(--warning)]" data-directors-why="">{sentence(board.directors_why)}</p>
      )}

      {!board && state.status === 'failed' && (
        <div role="alert" className="rounded-[16px] border border-border bg-surface p-5 text-[12.5px] text-danger shadow-1" data-failed="">
          Support Requests could not be read: {sentence(state.error) || 'no answer.'} Nothing is listed rather than an empty list.
          <button type="button" onClick={onReload} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      {!board && state.status !== 'failed' && <TableSkeleton />}
      {board && (rows.length === 0 ? (
        <div className="rounded-[16px] border border-border bg-surface px-6 py-10 text-center text-[13px] text-text-2 shadow-1" data-empty="">
          {emptyLine(board, Boolean(query.trim()))}
        </div>
      ) : (
        <RequestTable rows={rows} dir={dir} onSort={() => setDir(dir === 'desc' ? 'asc' : 'desc')} onOpen={onOpen} selected={opened} />
      ))}

      {board && (
        <RequestPanel row={row} viewer={board.viewer} people={board.people} peopleWhy={board.people_why} busy={busy}
          onClose={() => onOpen('')} onDecide={onDecide} onAdp={onAdp} />
      )}
    </div>
  )
}
