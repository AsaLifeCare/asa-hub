// The eye's card, in the right panel.
// On My Requirements: "Current version" — the requirement, what it owes, and its newest filed version with the…
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'
import { useCertDoc, type CertDoc } from './certDocFile'
import {
  dayWords, docType, docsFor, filedStatus, rowFor, versionFor, type Docs, type Filed, type MyProfileView,
  type RequirementRow, type UploadsState, type VersionRow,
} from './myProfileModel'

/** Which card is open: a requirement row's, or one document's. The rest is read from the latest answers. */
export type VersionAsk = { kind: 'requirement' | 'doc'; id: string }

const TILE = 'rounded-2xl border border-border bg-surface-2/60 p-4'
const READ_TONE = { success: 'text-[var(--success)]', warning: 'text-[var(--warning)]', muted: 'text-text-2' } as const

type Seen = { on?: string; win?: number; own: boolean; master: boolean }

const seenOf = (view: MyProfileView): Seen => ({
  on: view.requirements.on,
  win: view.requirements.window,
  own: view.person.own,
  // the master's own session, on a person it chose
  master: view.scope.mode === 'mass' && !view.person.own,
})

const isDay = (s: unknown): s is string => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))

/** The card's title and subtitle; null when what was asked for is no longer on the profile. */
export function versionCardHead(ask: VersionAsk, view: MyProfileView, docs: Docs): { title: string; subtitle: string } | null {
  if (ask.kind === 'requirement') {
    const row = view.requirements.rows.find((r) => r.id === ask.id)
    return row ? { title: 'Current version', subtitle: row.requirement } : null
  }
  const doc = docs.rows.find((d) => d.id === ask.id)
  if (!doc) return null
  return {
    title: doc.cert || doc.name || 'A document',
    subtitle: `${docType(doc, view.requirements.rows)} · Uploaded ${dayWords(doc.at) || 'on a day not recorded'}`,
  }
}

export function VersionCardBody({ ask, view, docs, onConfirmed }: {
  ask: VersionAsk
  view: MyProfileView
  docs: Docs
  onConfirmed: () => void
}) {
  if (ask.kind === 'requirement') {
    const row = view.requirements.rows.find((r) => r.id === ask.id)
    return row ? <RequirementBody row={row} view={view} docs={docs} onConfirmed={onConfirmed} /> : null
  }
  const doc = docs.rows.find((d) => d.id === ask.id)
  return doc ? <DocBody doc={doc} view={view} docs={docs} /> : null
}

function owedWords(row: RequirementRow, f: Filed): string {
  return `${f.status.word} · ${f.due ? `due ${dayWords(f.due)}` : row.due_why || 'no due date is on record'}`
}

function RequirementBody({ row, view, docs, onConfirmed }: {
  row: RequirementRow
  view: MyProfileView
  docs: Docs
  onConfirmed: () => void
}) {
  const seen = seenOf(view)
  const version = docs.landed ? versionFor(row, docs.rows) : null
  const f = filedStatus(row, version, seen.on, seen.win, seen.own)
  const evidence = row.details.find((d) => d.label === 'Evidence')?.value ?? ''
  return (
    <div className="space-y-3" data-card={row.id}>
      <div className={TILE}>
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-text-1">
          <FileText size={16} strokeWidth={1.8} className="shrink-0 text-text-2" /> {row.requirement}
        </p>
        <p className="mt-2 text-[12.5px] text-text-2" data-owed={row.id}>{owedWords(row, f)}</p>
        {evidence && <p className="mt-1 text-[12px] text-text-3">Evidence: {evidence}</p>}
        {f.sub && <p className="mt-1 text-[12px] text-text-3">{f.sub}</p>}
        {!docs.landed && (
          <p className="mt-3 text-[12px] text-text-3">{docs.note || 'The submitted documents are still being read.'}</p>
        )}
        {docs.landed && !version && <p className="mt-3 text-[12px] text-text-3">No version file is attached to this requirement.</p>}
      </div>
      {version && <VersionTile version={version} filed={f} />}
      {version && seen.master && <ConfirmDate key={version.id} row={row} version={version} onConfirmed={onConfirmed} />}
    </div>
  )
}

function VersionTile({ version, filed }: { version: VersionRow; filed: Filed }) {
  return (
    <div className={TILE} data-version={version.id}>
      <p className="break-all text-[13px] font-medium text-text-1">{version.name || version.cert || 'A document'}</p>
      <p className="text-[12px] text-text-3">Uploaded {dayWords(version.at) || 'on a day not recorded'}</p>
      {filed.reads && <p className={cn('mt-1 text-[12.5px] leading-[1.5]', READ_TONE[filed.tone])} data-reads={version.id}>{filed.reads}</p>}
      <div className="mt-3"><Preview doc={version} /></div>
    </div>
  )
}

function DocBody({ doc, view, docs }: { doc: VersionRow; view: MyProfileView; docs: Docs }) {
  const seen = seenOf(view)
  const row = rowFor(doc, view.requirements.rows)
  const attached = seen.own ? 'This document is attached to your profile.' : 'This document is attached to this person’s profile.'
  let line = attached
  let tone: Filed['tone'] = 'muted'
  if (row) {
    // the requirement's status as the row draws it; the reading is this document's own
    const shown = filedStatus(row, docs.landed ? versionFor(row, docs.rows) : null, seen.on, seen.win, seen.own)
    const mine = filedStatus(row, doc, seen.on, seen.win, seen.own)
    line = `Status: ${shown.status.word}. ${mine.reads || attached}`
    tone = mine.reads ? mine.tone : 'muted'
  }
  return (
    <div className="space-y-3" data-card-doc={doc.id}>
      <p className={cn('text-[12.5px] leading-[1.55]', READ_TONE[tone])}>{line}</p>
      <Preview doc={doc} />
    </div>
  )
}

function Preview({ doc }: { doc: VersionRow }) {
  if (!doc.id) return <p className="text-[12px] text-text-3">The ledger keeps no id for this document, so it cannot be opened here.</p>
  return <DocPreview id={doc.id} name={doc.name || doc.cert || 'The document'} />
}

/** The document itself, inline, once its bytes are read. */
export function DocPreview({ id, name }: { id: string; name: string }) {
  const got = useCertDoc(id)
  if (got.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-text-3" data-preview="opening">
        <Loader2 size={13} className="animate-spin" /> Opening the document…
      </p>
    )
  }
  if (got.status === 'failed' || !got.doc) {
    return <p role="alert" className="text-[12px] text-[var(--danger)]">{got.error || 'The document could not be opened.'}</p>
  }
  return <DocView doc={got.doc} name={name} />
}

export const DOC_UNSHOWN = 'This file is not a PDF or a picture, so it cannot be shown here.'

// A PDF framed, a picture drawn — and nothing else: only a blob URL of one of those types is ever put in the page…
export function DocView({ doc, name }: { doc: Pick<CertDoc, 'src' | 'shape'>; name: string }) {
  const [broken, setBroken] = useState(false)
  const src = doc.src.startsWith('blob:') ? doc.src : ''
  if (src && doc.shape === 'pdf') {
    return <iframe src={src} title={name} data-preview="pdf" className="h-[60vh] w-full rounded-xl border border-border bg-surface" />
  }
  if (src && doc.shape === 'image') {
    if (broken) return <p className="text-[12px] text-text-3">This photo format cannot be shown here — a JPG or PDF of the same paper can.</p>
    return (
      <img src={src} alt={name} onError={() => setBroken(true)} data-preview="image"
        className="max-h-[60vh] w-full rounded-xl border border-border bg-surface object-contain" />
    )
  }
  return <p className="text-[12px] text-text-3" data-preview="unshown">{DOC_UNSHOWN}</p>
}

/* ---------- the master's confirmation ---------- */

export type RecordAnswer = {
  id: string
  person: string
  req_id: string
  date_source: string
  record: string
  record_why: string
  confirm: { allowed: boolean; why: string }
}

export type ConfirmAnswer = {
  id: string
  req_id: string
  date_source: string
  confirmed_on: string
  confirmed_by: string
  confirmed_at: string
  ledger_stamped: boolean
  message: string
}

/** What the record holds now for a filed document — the value a confirmation is checked against. */
export function recordOf(id: string): Promise<RecordAnswer> {
  return gasAction<RecordAnswer>('certUploadRecord', { id })
}

// Writes `date` into the record, only while it still holds `expected`.
export function confirmDate(id: string, date: string, expected: string): Promise<ConfirmAnswer> {
  return gasAction<ConfirmAnswer>('certUploadConfirm', { id, date, expected }, { retry: false })
}

type RecordState = { status: 'loading' | 'ready' | 'failed'; record: string; why: string; allowed: boolean }

export function ConfirmDate({ row, version, onConfirmed }: { row: RequirementRow; version: VersionRow; onConfirmed: () => void }) {
  const shut = row.confirm && !row.confirm.allowed ? row.confirm.why : ''
  // the date the record keeps: the paper's own for an abstract, its expiry for the rest
  const issued = row.date_role === 'issued'
  const readDay = version.read_state === 'read' ? (issued ? version.issued_on : version.expires_on) : ''
  const read = isDay(readDay) ? readDay : ''
  const [rec, setRec] = useState<RecordState>({ status: 'loading', record: '', why: '', allowed: false })
  const [date, setDate] = useState(read || (isDay(version.confirmed_on) ? version.confirmed_on : ''))
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const live = useRef(true)

  const load = useCallback(async () => {
    try {
      const got = await recordOf(version.id)
      if (!live.current) return
      setRec({ status: 'ready', record: String(got?.record ?? ''), why: String(got?.record_why || got?.confirm?.why || ''),
        allowed: !!got?.confirm?.allowed })
    } catch (err) {
      if (live.current) setRec({ status: 'failed', record: '', why: err instanceof Error ? err.message : String(err), allowed: false })
    }
  }, [version.id])

  useEffect(() => {
    live.current = true
    if (!shut) void load()
    return () => { live.current = false }
  }, [load, shut])

  if (shut) {
    return (
      <div className={TILE} data-confirm={row.id}>
        <p className="text-[12.5px] text-text-2">{shut}</p>
      </div>
    )
  }

  const run = async () => {
    setBusy(true)
    setSaid(null)
    try {
      const got = await confirmDate(version.id, date, rec.record)
      if (!live.current) return
      setSaid({ tone: 'success', text: got?.message || `The record now holds ${date}.` })
      setRec((r) => ({ ...r, status: 'loading' }))
      void load()
      onConfirmed()
    } catch (err) {
      if (!live.current) return
      // the record changed since it was shown: the new value is what the next confirmation is checked against
      const current = (err as { envelope?: { data?: { current?: unknown } } } | null)?.envelope?.data?.current
      if (typeof current === 'string') setRec((r) => ({ ...r, record: current }))
      // an answer that could not be read leaves the outcome unknown: the record is read again to show what it holds
      else void load()
      setSaid({ tone: 'danger', text: err instanceof Error ? err.message : String(err) })
    } finally {
      if (live.current) setBusy(false)
    }
  }

  const can = rec.status === 'ready' && rec.allowed && isDay(date) && !busy
  return (
    <div className={TILE} data-confirm={row.id}>
      <p className="text-[12.5px] font-semibold text-text-1">Record: {rec.status === 'loading' ? 'reading…'
        : rec.status === 'failed' ? 'could not be read' : rec.record || 'nothing is on file'}</p>
      {rec.why && <p className="mt-1 text-[12px] text-[var(--warning)]">{rec.why}</p>}
      {!read && (
        <p className="mt-1 text-[12px] text-text-3">No date was read from this file — type the date shown on the document.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-[12px] font-semibold text-text-2" htmlFor={`confirm-date-${version.id}`}>
          {issued ? 'Date of the document' : 'Expiry date'}
        </label>
        <input id={`confirm-date-${version.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary" />
        <button type="button" disabled={!can} onClick={() => void run()} data-confirm-button={row.id}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary px-4 text-[12.5px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />} Confirm this date
        </button>
      </div>
      {said && (
        <p role={said.tone === 'danger' ? 'alert' : 'status'}
          className={cn('mt-2 text-[12.5px]', said.tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>
          {said.text}
        </p>
      )}
    </div>
  )
}

/* ---------- the right panel ---------- */

/** The panel's small-caps word and accessible name. */
export const VERSION_PANEL_LABEL = { requirement: 'Requirement', doc: 'Document' } as const

export default function VersionCard({ ask, view, uploads, onClose, onConfirmed }: {
  ask: VersionAsk | null
  view: MyProfileView | null
  uploads: UploadsState
  onClose: () => void
  onConfirmed: () => void
}) {
  const docs = view ? docsFor(view, uploads) : null
  const head = ask && view && docs ? versionCardHead(ask, view, docs) : null
  const shown = !!head
  // what the card was opened for left the profile (another person, a failed re-read): the ask is let go
  useEffect(() => {
    if (ask && !shown) onClose()
  }, [ask, shown, onClose])
  return (
    <SidePanel open={shown} onClose={onClose} label={ask ? VERSION_PANEL_LABEL[ask.kind] : ''} title={head?.title ?? ''}>
      {ask && view && docs && head && (
        <>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2" data-card-subtitle="">{head.subtitle}</p>
          <div className="mt-4">
            <VersionCardBody ask={ask} view={view} docs={docs} onConfirmed={onConfirmed} />
          </div>
        </>
      )}
    </SidePanel>
  )
}
