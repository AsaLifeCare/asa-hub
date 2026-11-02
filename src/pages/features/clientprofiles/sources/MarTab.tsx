// Clients › Medication › Administration: the client's monthly MARS papers, the eMAR passes and the MAR errors audit…
// A paper opens in the platform's centred viewer from its bytes; its details and its OCR text (kept already, opened…
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Eye, Info, Loader2, RotateCw } from 'lucide-react'
import { MedName } from '@/components/shared/MedThumb'
import SidePanel from '@/components/shared/SidePanel'
import SearchInput from '@/components/shared/SearchInput'
import { RetryButton } from '@/pages/features/locations/LocationParts'
import { readKey, useLocationRead, type ReadState } from '@/pages/features/locations/useLocation'
import { cn } from '@/lib/utils'
import { NotOpenNote } from '../ClientParts'
import { shownViews, useClientReader } from '../clientViewer'
import {
  MAR_ACTIONS, MAR_VIEWS, PAGE, asOfLine, clockWords, dateCell, dayWords, emptyLine, filterMarRows, instantWords, kpiCards,
  marOf, marPanelOf, marPanelParam, monthWords, readMar, readMarText, readRefusal, statusTone, textOf, useAsked,
  usePaperOpener, type ErrorRow, type MarAnswer, type MarAsk, type MarRow, type MarTabData, type MarView, type PaperOpener,
  type PaperRow, type PassRow, type Tone,
} from './mar'

export type { MarAsk }

export default function MarTab({ client, panel, onPanel }: {
  client: string
  /** the panel as the address carries it, when the page keeps it; held here otherwise */
  panel?: string | null
  onPanel?: (panel: string | null) => void
}) {
  const read = useLocationRead(client ? readKey(MAR_ACTIONS.read, client) : null, () => readMar(client), marOf)
  const [view, setView] = useState<MarView>('papers')
  const [ownAsk, setOwnAsk] = useState<MarAsk | null>(null)
  const ask = panel !== undefined ? marPanelOf(panel) : ownAsk
  const setAsk = (next: MarAsk | null) => (onPanel ? onPanel(marPanelParam(next) || null) : setOwnAsk(next))
  const papers = usePaperOpener(client)
  return (
    <>
      <MarBody state={read} view={view} onView={setView} onAsk={setAsk} onRetry={read.reload}
        onPaper={papers.open} opening={papers.opening} />
      <MarPanel client={client} answer={read.data} ask={ask} onClose={() => setAsk(null)} papers={papers} />
    </>
  )
}

/* ---------- the section ---------- */

export function MarBody({ state, view, onView, onAsk, onRetry, onPaper = () => {}, opening = '' }: {
  state: ReadState<MarAnswer>
  view: MarView
  onView: (view: MarView) => void
  onAsk: (ask: MarAsk) => void
  onRetry: () => void
  /** a paper opens in the centred viewer */
  onPaper?: (paper: PaperRow) => void
  opening?: string
}) {
  const a = state.data
  const { viewer } = useClientReader()
  const views = shownViews('administration', MAR_VIEWS, viewer)
  if (!views.some((t) => t.id === view)) return <NotOpenNote />
  return (
    <div className="grid gap-4" data-mar={view}>
      <SubTabs views={views} value={view} onChange={onView} />
      <ReadLine state={state} onRetry={onRetry} />
      {a && view === 'papers' && <TabBlock view="papers" tab={a.papers} onAsk={onAsk} onPaper={onPaper} opening={opening} />}
      {a && view === 'passes' && <TabBlock view="passes" tab={a.passes} onAsk={onAsk} />}
      {a && view === 'errors' && <TabBlock view="errors" tab={a.errors} onAsk={onAsk} />}
    </div>
  )
}

function SubTabs({ views, value, onChange }: {
  views: typeof MAR_VIEWS
  value: MarView
  onChange: (view: MarView) => void
}) {
  return (
    <div role="tablist" aria-label="Administration" className="scroll-thin flex gap-1 overflow-x-auto border-b border-border pb-3"
      data-subtabs="">
      {views.map((t) => {
        const on = t.id === value
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)} data-view={t.id}
            className={cn('shrink-0 whitespace-nowrap rounded-[12px] px-3.5 py-2 text-[13px] transition-colors',
              on ? 'bg-primary-soft font-semibold text-primary' : 'text-text-2 hover:bg-surface-2')}>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function ReadLine({ state, onRetry }: { state: ReadState<unknown>; onRetry: () => void }) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-text-3" data-read="loading">
        <Loader2 size={13} className="animate-spin" /> Reading the administration record…
      </p>
    )
  }
  if (state.status !== 'failed') return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] leading-5 text-[var(--danger)]" data-read="failed">
      {state.data ? `The last read failed: ${readRefusal(state.error)} What is shown is from the read before.`
        : `The administration record could not be read: ${readRefusal(state.error)}`}
      <RetryButton onRetry={onRetry} busy={state.refreshing} />
    </p>
  )
}

const PILL: Record<Tone, string> = {
  mint: 'bg-tint-mint text-tint-fg-mint',
  danger: 'bg-tint-danger text-tint-fg-danger',
  amber: 'bg-tint-amber text-tint-fg-amber',
  slate: 'bg-tint-slate text-tint-fg-slate',
  blue: 'bg-tint-blue text-tint-fg-blue',
  lavender: 'bg-tint-lavender text-tint-fg-lavender',
}

export function StatusPill({ status }: { status: string }) {
  if (!status) return <span className="text-text-3">—</span>
  return (
    <span data-status={status}
      className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL[statusTone(status)])}>
      {status}
    </span>
  )
}

function Note({ children, kind }: { children: ReactNode; kind: 'empty' | 'missing' }) {
  return (
    <div data-empty={kind}
      className="rounded-[16px] border border-dashed border-border bg-surface px-5 py-6 text-center text-[13px] leading-5 text-text-3">
      {children}
    </div>
  )
}

const SELECT = 'h-10 rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
const TH = 'whitespace-nowrap px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const TD = 'px-4 py-3.5 align-middle text-text-2'
const ASK_KIND: Record<MarView, 'paper' | 'pass' | 'error'> = { papers: 'paper', passes: 'pass', errors: 'error' }

function TabBlock({ view, tab, onAsk, onPaper, opening = '' }: {
  view: MarView
  tab: MarTabData<MarRow>
  onAsk: (ask: MarAsk) => void
  onPaper?: (paper: PaperRow) => void
  opening?: string
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [shownCount, setShownCount] = useState(PAGE)
  const cards = kpiCards(view, tab)
  const line = asOfLine(view, tab)
  const matched = filterMarRows(tab.rows, query, status)
  const shown = matched.slice(0, shownCount)
  const open = (id: string) => onAsk({ kind: ASK_KIND[view], id })
  // a pass and an error name a medication, drawn behind its photo; a paper is a document
  const recordButton = (r: MarRow) => (
    <button type="button" onClick={() => open(r.id)} className="clamp-2 text-left hover:underline">{r.record}</button>
  )
  return (
    <div className="grid gap-3" data-mar-tab={view}>
      {cards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-kpis="">
          {cards.map((k) => (
            <div key={k.label} className="rounded-[16px] border border-border bg-surface px-4 py-4 shadow-1" data-kpi={k.label}>
              <p className="font-display text-[20px] font-semibold leading-7 text-text-1 tabular-nums">{k.value}</p>
              <p className="mt-1.5 text-[12px] text-text-3">{k.label}</p>
            </div>
          ))}
        </div>
      )}
      {line && <p className="text-[12.5px] leading-5 text-text-3" data-as-of="">{line}</p>}
      {tab.why ? (
        <Note kind="missing">This source could not be read: {tab.why}.</Note>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={(v) => { setQuery(v); setShownCount(PAGE) }} placeholder="Search this view…"
              className="h-10 min-w-[200px] flex-1 rounded-[12px]" />
            <select aria-label="Status" value={status} data-filter="status" className={SELECT}
              onChange={(e) => { setStatus(e.target.value); setShownCount(PAGE) }}>
              <option value="">All statuses</option>
              {tab.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {tab.rows.length === 0 ? <Note kind="empty">{emptyLine(view, tab)}</Note> : matched.length === 0 ? (
            <Note kind="empty">Nothing here matches the search and the status.</Note>
          ) : (
            <div className="scroll-thin overflow-x-auto rounded-[16px] border border-border bg-surface shadow-1">
              <table className="w-full min-w-[720px] border-collapse text-[13px]" data-record-table="">
                <thead className="border-b border-border bg-surface-2/50">
                  <tr>
                    <th className={TH}>Record</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Details</th>
                    <th className={TH}>Status</th>
                    <th className={cn(TH, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => (
                    <tr key={r.id} data-row={r.id}>
                      <td className={cn(TD, 'max-w-[260px] font-semibold text-text-1')}>
                        {view === 'papers' ? recordButton(r) : <MedName name={r.record}>{recordButton(r)}</MedName>}
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap')}>{dateCell(view, r)}</td>
                      <td className={cn(TD, 'max-w-[380px]')}><span className="clamp-2">{r.details || '—'}</span></td>
                      <td className={TD}><StatusPill status={r.status} /></td>
                      <td className={cn(TD, 'text-right')}>
                        {view === 'papers' && onPaper && (r as PaperRow).fileId ? (
                          <span className="inline-flex gap-1.5">
                            <button type="button" onClick={() => open(r.id)} aria-label={`Details of ${r.record}`} data-details={r.id}
                              className="inline-grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
                              <Info size={14} />
                            </button>
                            <button type="button" onClick={() => onPaper(r as PaperRow)} aria-label={`View ${r.record}`} data-view-paper={r.id}
                              disabled={opening === (r as PaperRow).fileId} aria-busy={opening === (r as PaperRow).fileId || undefined}
                              className="inline-grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-60">
                              {opening === (r as PaperRow).fileId ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => open(r.id)} aria-label={`Open ${r.record}`} data-open={r.id}
                            className="inline-grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
                            <Eye size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {matched.length > shown.length && (
            <button type="button" onClick={() => setShownCount((n) => n + PAGE)} data-more=""
              className="justify-self-center rounded-full border border-border bg-surface px-4 py-2 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
              Show {Math.min(PAGE, matched.length - shown.length)} more of {matched.length - shown.length}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/* ---------- the right panel ---------- */

export function MarPanel({ client, answer, ask, onClose, papers }: {
  client: string
  answer: MarAnswer | null
  ask: MarAsk | null
  onClose: () => void
  papers?: PaperOpener
}) {
  const paper = ask?.kind === 'paper' ? answer?.papers.rows.find((r) => r.id === ask.id) ?? null : null
  const pass = ask?.kind === 'pass' ? answer?.passes.rows.find((r) => r.id === ask.id) ?? null : null
  const error = ask?.kind === 'error' ? answer?.errors.rows.find((r) => r.id === ask.id) ?? null : null
  // a pass and an error name a medication: its photo heads the panel, one element per name (the panel refocuses on a new title)
  const medName = (pass ?? error)?.record ?? ''
  const medHeading = useMemo(() => <MedName name={medName} size={56} eager />, [medName])
  const title = !answer ? 'Administration' : pass || error ? medHeading : paper?.record ?? 'No longer listed'
  return (
    <SidePanel open={!!ask} onClose={onClose} label="Administration" title={title}>
      {ask && !answer && <p className="pt-1 text-[12.5px] text-text-3" data-read="loading">Reading the administration record…</p>}
      {ask?.kind === 'paper' && answer && (paper ? <PaperBody key={paper.id} client={client} paper={paper} papers={papers} /> : <Gone />)}
      {ask?.kind === 'pass' && answer && (pass ? <PassBody pass={pass} /> : <Gone />)}
      {ask?.kind === 'error' && answer && (error ? <ErrorBody error={error} /> : <Gone />)}
    </SidePanel>
  )
}

function Gone() {
  return <p className="pt-1 text-[12.5px] text-text-3">This row is no longer listed for the client.</p>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{children}</dd>
    </div>
  )
}

function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-3">
      {items.filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false).map(([label, v]) => (
        <Row key={label} label={label}>{v}</Row>
      ))}
    </dl>
  )
}

/** A paper's details: the paper itself opens in the centred viewer; its OCR text, read once already, opens with the panel. */
export function PaperBody({ client, paper, papers }: { client: string; paper: PaperRow; papers?: PaperOpener }) {
  const opening = !!papers && papers.opening === paper.fileId
  return (
    <div className="grid gap-4 pt-1" data-paper-panel={paper.id}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={paper.status} />
        <span className="text-[12.5px] text-text-3">{paper.details}</span>
      </div>
      {paper.fileId ? (
        papers && (
          <button type="button" onClick={() => papers.open(paper)} disabled={opening} aria-busy={opening || undefined} data-view-paper={paper.id}
            className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
            {opening ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} View the paper
          </button>
        )
      ) : <p className="text-[12.5px] text-text-3">No file is on record for this paper.</p>}
      <Rows items={[
        ['Month', monthWords(paper.date) || 'The file name states no month'],
        ['File', paper.title],
        ['Folder', paper.folder],
        ['Indexed on', dayWords(paper.indexedAt)],
        ['OCR read on', instantWords(paper.ocrReadAt)],
      ]} />
      {paper.fileId && <OcrText client={client} paper={paper} />}
    </div>
  )
}

/** The OCR text the MARS lane kept, asked as the panel opens; a paper still owed its reading says where it stands. */
function OcrText({ client, paper }: { client: string; paper: PaperRow }) {
  const text = useAsked(() => readMarText(client, paper.fileId), textOf)
  const { ask } = text
  const owed = paper.hasText
  useEffect(() => {
    if (owed) ask()
  }, [owed, ask])
  const next = instantWords(paper.ocrNextTryAt)
  return (
    <div className="grid gap-2 border-t border-border pt-3" data-full-text={owed ? text.status : paper.ocrState || 'none'}>
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">OCR text</h3>
      {!owed && (paper.ocrState === 'failed' ? (
        <p className="text-[12.5px] text-[var(--danger)]" data-ocr="failed">
          The OCR reading of this paper failed{paper.ocrError ? `: ${paper.ocrError}` : ''}. It is tried again by
          itself{next ? ` on ${next}` : ''}.
        </p>
      ) : paper.ocrState === 'pending' ? (
        <p className="text-[12.5px] text-text-3" data-ocr="pending">This paper is being read; its OCR text shows here once it is.</p>
      ) : <p className="text-[12.5px] text-text-3">No OCR text is on file for this paper.</p>)}
      {owed && (text.status === 'loading' || text.status === 'idle') && (
        <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Opening the OCR text…</p>
      )}
      {owed && text.status === 'failed' && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--danger)]">
          The OCR text could not be opened: {readRefusal(text.error)}
          <button type="button" onClick={ask} className="inline-flex items-center gap-1 font-semibold underline">
            <RotateCw size={12} /> Try again
          </button>
        </p>
      )}
      {text.data && (
        <>
          <pre className="scroll-thin max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2/50 p-3 text-[12px] leading-5 text-text-2">{text.data.text}</pre>
          {text.data.truncated && <p className="text-[11.5px] text-text-3">The first {text.data.text.length.toLocaleString('en-US')} of {text.data.chars.toLocaleString('en-US')} characters.</p>}
        </>
      )}
    </div>
  )
}

export function PassBody({ pass }: { pass: PassRow }) {
  const day = pass.date ? dayWords(pass.date)
    : pass.time ? 'No day — the eMAR row holds only a time' : 'No day — the eMAR row names none'
  const takenFrom = pass.dateFrom === 'PRN pass time' ? pass.prnTimeAsWritten : pass.scheduleAsWritten
  const written = pass.dateFrom ? takenFrom : pass.dateAsWritten
  const dayNote = [
    pass.dateFrom ? `Taken from the eMAR's ${pass.dateFrom} column ("${takenFrom}"); the date cell holds ` +
      `${pass.dateAsWritten ? `only "${pass.dateAsWritten}"` : 'nothing'}.` : '',
    pass.dateFixed ? `Read day-first from the eMAR's own text; the tab holds "${written}".`
      : pass.dateUnsure ? `The eMAR's text reads two ways ("${written}"); shown as written.` : '',
  ].filter(Boolean).join(' ')
  return (
    <div className="grid gap-4 pt-1" data-pass-panel={pass.id}>
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={pass.status} /></div>
      <Rows items={[
        ['Day', <>{day}{dayNote && <span className="mt-0.5 block text-[11.5px] text-text-3" data-date-note="">{dayNote}</span>}</>],
        ['Recorded at', pass.time ? clockWords(pass.time) : ''],
        ['Due', pass.schedule],
        ['Pass time', pass.passTime],
        ['Reason', pass.reason],
        ['Dose', [pass.dose, pass.form].filter(Boolean).join(' · ')],
        ['PRN', pass.prn ? [pass.prnReason || 'As needed', pass.prnTime].filter(Boolean).join(' · ') : ''],
        ['Given by', pass.givenBy],
        ['Blood pressure', pass.bloodPressure],
        ['Blood sugar', pass.bloodSugar],
        ['Quantity remaining', pass.quantityRemaining],
        ['Comment', pass.comment],
        ['Instructions', pass.instructions],
        ['eMAR status', pass.sourceStatus],
      ]} />
      <p className="text-[11.5px] text-text-3">From the eMAR pass log{pass.sourceRow ? ` (${pass.sourceRow})` : ''}. Read only.</p>
    </div>
  )
}

export function ErrorBody({ error }: { error: ErrorRow }) {
  return (
    <div className="grid gap-4 pt-1" data-error-panel={error.id}>
      <div className="flex flex-wrap items-center gap-2">
        {(error.kinds.length ? error.kinds : [error.status]).map((k) => <StatusPill key={k} status={k} />)}
      </div>
      <Rows items={[
        ['Day', error.date ? dayWords(error.date) : `No day${error.dateAsWritten ? ` — the audit wrote "${error.dateAsWritten}"` : ''}`],
        ['Until', error.endDate && error.endDate !== error.date ? dayWords(error.endDate) : ''],
        ['Pass time', error.passTime],
        ['Problem', error.problem],
        ['Flags', error.flags.join(' · ')],
        ['Notes', error.notes],
        ['Staff', error.staff],
        ['Passer', error.passer],
        ['Reading', error.reading],
        ['Source', error.source],
      ]} />
      {error.matchedBy === 'initials' && (
        <p className="text-[12px] leading-5 text-text-2" data-filed-as={error.filedAs}>
          The audit files this row only under the initials {error.filedAs}. It is counted for this client because no
          other client, and nobody else the records name, has those initials.
        </p>
      )}
      <p className="text-[11.5px] text-text-3">From the MAR errors audit. Read only.</p>
    </div>
  )
}
