// THE DECODER'S LABORATORY — a decoding app where every possible document is tested and the decode is pushed as far…
// It has to accept everything.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, CheckCircle2, ChevronLeft, Clock, Eye, FileText, Folder,
  FolderOpen, Loader2, RefreshCw, ScanText, Search, Sparkles,
} from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import FormFileUpload, { type StoredFormFile } from '@/components/FormFileUpload'
import { authHeaders } from '@/lib/snapshotClient'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { ProposalsPane, TeachControl } from './Proposals'

type Verdict = {
  doc_kind?: string; person?: string; person_id?: string
  issued_on?: string; expires_on?: string; confidence?: string | number
  digest_category?: string; person_seen?: string; person_agree?: string
  digest_dates?: string
  meta?: {
    kind_score?: number; kind_alt?: string; missing?: string[]
    expires_source?: string; date_how?: Record<string, string>
    born_on?: string; level?: string; program?: string
    check_agency?: string; check_result?: string; ssn_last4?: string[]
    lane?: string; v?: string
  }
}
type Reading = {
  chars: number; seconds: number; text: string
  verdict?: Verdict; verdict_seconds?: number
  pass?: string; psm?: string; score?: number
  tried?: { pass?: string; psm?: string; score?: number; chars?: number }[]
}
type TryResult = {
  status: number; message?: string
  file_id?: string; file_name?: string; kind?: string
  ordinary?: Reading; sharp?: Reading
}

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i

/** A shelf entry: the company's own Drive folders, as the corpus carries them. */
type Shelf = {
  status: number
  message?: string
  folders: { name: string; count: number }[]
  special: { name: string; count: number }[]
  files: ShelfFile[]
  total: number
}
type ShelfFile = {
  id: string; name: string; folder: string; ledger: string; file_id: string
  doc_kind?: string; person?: string; state?: string; confidence?: string
  missing?: string[]; decoder?: string
}

/** One fact, drawn the same way wherever it appears. */
function Fact({ label, value, tone }: { label: string; value?: string; tone?: 'ok' | 'gap' }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-text-2">{label}</span>
      <span className={cn('text-sm', !value && 'text-text-2',
        tone === 'ok' && 'font-medium text-emerald-700',
        tone === 'gap' && 'font-medium text-amber-700')}>
        {value || '—'}
      </span>
    </div>
  )
}

// What one reading saw.
function ReadingPane({ title, icon, reading, accent }: {
  title: string; icon: React.ReactNode; reading?: Reading; accent: string
}) {
  const [raw, setRaw] = useState(false)
  const v = reading?.verdict
  const m = v?.meta || {}
  const missing = m.missing || []
  if (!reading) {
    return (
      <Card className="h-full">
        <CardHeader title={title} sub="not run for this document" />
        <p className="mt-3 text-sm text-text-2">
          The better eye only runs on an image or a PDF, and only when the kind
          says something is missing.
        </p>
      </Card>
    )
  }
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('grid h-8 w-8 place-items-center rounded-md', accent)}>{icon}</span>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-xs text-text-2">
              {reading.chars.toLocaleString()} chars · {reading.seconds}s
              {reading.pass && reading.pass !== 'floor' ? ` · ${reading.pass} psm ${reading.psm}` : ''}
              {typeof reading.score === 'number' ? ` · score ${reading.score}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          className="rounded-md border border-border px-2 py-1 text-xs text-text-2 hover:bg-surface-2"
        >
          <Eye className="mr-1 inline h-3 w-3" />{raw ? 'verdict' : 'text'}
        </button>
      </div>

      {raw ? (
        <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[11px] leading-relaxed">
          {reading.text || '(nothing was read)'}
        </pre>
      ) : (
        <div className="mt-3">
          <Fact label="kind" value={v?.doc_kind} tone={v?.doc_kind ? 'ok' : 'gap'} />
          <Fact label="category" value={v?.digest_category} />
          <Fact label="person" value={v?.person} />
          <Fact label="anchor" value={v?.person_id} tone={v?.person_id ? 'ok' : undefined} />
          <Fact label="issued" value={v?.issued_on} />
          <Fact label="expires" value={v?.expires_on}
                tone={v?.expires_on ? 'ok' : (missing.includes('expires_on') ? 'gap' : undefined)} />
          <Fact label="born" value={m.born_on} />
          <Fact label="confidence" value={v?.confidence !== undefined ? String(v.confidence) : ''} />
          {m.level ? <Fact label="category N" value={m.level} /> : null}
          {m.program ? <Fact label="programme" value={m.program} /> : null}
          {m.check_result ? <Fact label="check" value={`${m.check_agency || ''} ${m.check_result}`} /> : null}
          {m.ssn_last4?.length ? <Fact label="masked" value={`•••• ${m.ssn_last4.join(', ')}`} tone="ok" /> : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.expires_source ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">
                expiry: {m.expires_source}
              </span>
            ) : null}
            {Object.entries(m.date_how || {}).map(([k, how]) => (
              <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">
                {k}: {how}
              </span>
            ))}
            {m.kind_alt ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-2">
                runner-up: {m.kind_alt}
              </span>
            ) : null}
          </div>

          {missing.length ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                this kind of paper owes <strong>{missing.join(', ')}</strong> and this
                reading did not give it
              </p>
            </div>
          ) : v?.doc_kind ? (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-300/50 bg-emerald-50 px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <p className="text-xs text-emerald-800">everything this kind owes is here</p>
            </div>
          ) : null}

          {reading.tried?.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-text-2">
                every pass it tried ({reading.tried.length})
              </summary>
              <div className="mt-2 space-y-1">
                {reading.tried.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 text-[11px] text-text-2">
                    <span className="w-16">{t.pass}</span>
                    <span className="w-12">psm {t.psm || '—'}</span>
                    <span className="w-16">score {t.score}</span>
                    <span>{(t.chars || 0).toLocaleString()} chars</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </Card>
  )
}

// THE SHELF — what the building already has, as it was filed.
function ShelfPane({ onPick, picked }: {
  onPick: (f: ShelfFile) => void; picked?: string
}) {
  const [shelf, setShelf] = useState<Shelf | null>(null)
  const [folder, setFolder] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const [gone, setGone] = useState('')

  // A SHELF THAT CANNOT BE READ SAYS SO.
  const load = useCallback(async (f: string, query: string) => {
    setBusy(true); setGone('')
    try {
      const p = new URLSearchParams()
      if (f) p.set('folder', f)
      if (query) p.set('q', query)
      const r = await fetch(`/digest/shelf?${p.toString()}`, { headers: authHeaders() })
      const type = r.headers.get('content-type') || ''
      if (!r.ok) { setGone(r.status === 401 ? 'sign in again' : `the shelf refused (${r.status})`); return }
      if (!type.includes('json')) { setGone('the shelf answered with a page, not data'); return }
      const body = (await r.json()) as Shelf
      if (body.status && body.status !== 200) { setGone(body.message || `refused (${body.status})`); return }
      setShelf(body)
    } catch (e) {
      setGone(e instanceof Error ? e.message : 'the shelf did not answer')
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { void load(folder, q) }, [load, folder, q])

  const rows = shelf?.files || []
  return (
    <Card padded={false} className="flex h-[34rem] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        {folder ? (
          <button type="button" onClick={() => { setFolder(''); setQ('') }}
                  className="rounded-md p-1 text-text-2 hover:bg-surface-2" title="all folders">
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : <Folder className="h-4 w-4 text-text-2" />}
        <span className="truncate text-sm font-medium">{folder || 'What we already have'}</span>
        <span className="ml-auto text-xs text-text-2">
          {busy ? '…' : `${(shelf?.total || 0).toLocaleString()} filed`}
        </span>
      </div>

      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="a name, a person…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-text-2"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {gone ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">{gone}</p>
          </div>
        ) : null}
        {!folder && !q ? (
          <div className="p-2">
            {(shelf?.special || []).map((f) => (
              <button key={f.name} type="button" onClick={() => setFolder(f.name)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm">{f.name.replace('· ', '')}</span>
                <span className="ml-auto text-xs text-text-2">{f.count.toLocaleString()}</span>
              </button>
            ))}
            <div className="my-2 border-t border-border" />
            {(shelf?.folders || []).map((f) => (
              <button key={f.name} type="button" onClick={() => setFolder(f.name)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                <Folder className="h-4 w-4 shrink-0 text-text-2" />
                <span className="truncate text-sm">{f.name}</span>
                <span className="ml-auto text-xs text-text-2">{f.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-2">
            {rows.length === 0 && !busy ? (
              <p className="px-2 py-6 text-center text-sm text-text-2">nothing here</p>
            ) : null}
            {rows.map((f) => (
              <button key={f.id || f.file_id} type="button" onClick={() => onPick(f)}
                      className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2',
                                    picked === f.file_id && 'bg-primary-soft')}>
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-2" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.name}</span>
                  <span className="block truncate text-[11px] text-text-2">
                    {[f.doc_kind || '—', f.person, f.state].filter(Boolean).join(' · ')}
                    {f.missing?.length ? ` · owes ${f.missing.join(', ')}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

export default function DigestLabPage() {
  const [file, setFile] = useState<StoredFormFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<TryResult | null>(null)
  const [err, setErr] = useState('')
  /* the shelf row behind the paper on the bench — teaching files THAT row */
  const [pickedRow, setPickedRow] = useState<{ id: string; ledger: string } | null>(null)
  const [kinds, setKinds] = useState<string[]>([])
  const onKinds = useCallback((k: string[]) => setKinds(k), [])

  const run = useCallback(async (f: StoredFormFile) => {
    setBusy(true); setErr(''); setRes(null)
    try {
      const r = await fetch('/digest/try', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authHeaders() || {}) },
        body: JSON.stringify({ file_id: f.file_id, file_name: f.file_name }),
      })
      const body = (await r.json()) as TryResult
      if (body.status && body.status !== 200) setErr(body.message || `refused (${body.status})`)
      else setRes(body)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'the lab did not answer')
    } finally {
      setBusy(false)
    }
  }, [])

  // the funnel hands back one file per pick, and the bench works on the last one dropped — a room for arguing with…
  const onStored = useCallback((f: StoredFormFile) => {
    if (!f) return
    setPickedRow(null)
    setFile(f)
    void run(f)
  }, [run])

  // A DOCUMENT ALREADY ON THE SHELF goes to the same bench: it is already in Drive, so the test is the same two…
  const onPickFiled = useCallback((f: ShelfFile) => {
    if (!f.file_id) { setErr('that row carries no Drive id'); return }
    const as: StoredFormFile = {
      file_id: f.file_id, file_url: '', file_name: f.name,
      mime_type: '', size_bytes: 0,
    }
    setPickedRow(f.id && f.ledger ? { id: f.id, ledger: f.ledger } : null)
    setFile(as)
    void run(as)
  }, [run])

  const preview = useMemo(() => {
    if (!file) return null
    return IMAGE.test(file.file_name)
      ? { kind: 'image' as const, src: `https://drive.google.com/thumbnail?id=${file.file_id}&sz=w1600` }
      : { kind: 'frame' as const, src: `https://drive.google.com/file/d/${file.file_id}/preview` }
  }, [file])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-soft">
            <ScanText className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Decoder lab</h1>
            <p className="text-sm text-text-2">
              The paper on one side, the reading on the other. Anything the platform can
              hold — and what is dropped here is filed like any other document.
            </p>
          </div>
        </div>
        {file ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => file && run(file)}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            read it again
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ShelfPane picked={file?.file_id} onPick={onPickFiled} />
        <Card>
          <CardHeader title="Drop a document" sub="image, PDF, spreadsheet, text — whatever the input is" />
          <div className="mt-3">
            <FormFileUpload
              context="lab"
              hint="Everything this platform knows how to read is accepted here."
              onStored={onStored}
            />
          </div>
          <p className="mt-3 text-xs text-text-2">
            What is dropped here is filed like any other document — it becomes a
            ledger row and its digest lands in the sheets on the next pass.
          </p>
        </Card>
      </div>

      {err ? (
        <Card className="border-red-300/60 bg-red-50">
          <p className="text-sm text-red-800">{err}</p>
        </Card>
      ) : null}

      {!file ? (
        <EmptyState
          title="Nothing on the bench yet"
          body="Drop a document above and both readings appear beside it."
        />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
          className="grid gap-4 lg:grid-cols-2"
        >
          <Card padded={false} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <FileText className="h-4 w-4 text-text-2" />
              <span className="truncate text-sm font-medium">{file.file_name}</span>
              <span className="ml-auto text-xs text-text-2">{res?.kind || ''}</span>
            </div>
            {preview?.kind === 'image' ? (
              <img src={preview.src} alt={file.file_name}
                   className="max-h-[38rem] w-full bg-surface-2 object-contain" />
            ) : (
              <iframe title={file.file_name} src={preview?.src}
                      className="h-[38rem] w-full bg-surface-2" />
            )}
          </Card>

          <div className="space-y-4">
            {busy ? (
              <Card>
                <div className="flex items-center gap-2 text-sm text-text-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  reading it — the better eye takes a few seconds when it is needed
                </div>
              </Card>
            ) : null}
            {res ? (
              <>
                <ReadingPane
                  title="The ordinary reading"
                  icon={<Clock className="h-4 w-4 text-text-2" />}
                  accent="bg-surface-2"
                  reading={res.ordinary}
                />
                <ReadingPane
                  title="The better eye"
                  icon={<Sparkles className="h-4 w-4 text-primary" />}
                  accent="bg-primary-soft"
                  reading={res.sharp}
                />
                {pickedRow ? (
                  <TeachControl
                    ledger={pickedRow.ledger}
                    rowId={pickedRow.id}
                    kinds={kinds}
                    current={String((res.ordinary?.verdict as Record<string, unknown> | undefined)?.doc_kind || '')}
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </motion.div>
      )}

      <ProposalsPane onKinds={onKinds} />
    </div>
  )
}
