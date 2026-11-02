// THE ANSWERS — one screen for every form.
// The data lands on a second page of the app that holds the several forms, and the page adapts to each one.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, RefreshCw, RotateCcw } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import Card from '@/components/shared/Card'
import ContextBanner from '@/components/shared/ContextBanner'
import EmptyState from '@/components/shared/EmptyState'
import { useContextStore } from '@/stores/useContextStore'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { EASE_OUT_EXPO } from '@/engine/motion'

type FormField = { key: string; label: string; kind?: string }
type FormRow = { slug: string; title: string; submissions: number; unhandled: number }
type Submission = Record<string, string>

// THE DECODER'S OWN WORDS, as chips.
type Merged = {
  key?: string; label?: string; fact?: string
  said?: string; found?: string; agree?: string; note?: string
}
/** What a paper settled — the obligation, and where the receipt went. */
type Settle = {
  kind?: string; doc_id?: string; credential?: string; requirement?: string
  name?: string; candidate_id?: string; name_key?: string
  candidate?: string; staff?: string; did?: string[]; why?: string
}
type DigestMeta = {
  dates_agree?: string; expired?: string; person_source?: string
  answers?: Merged[]; answers_filled?: string[]; kind_alt?: string
  settle?: Settle
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(String(raw || '')) } catch { return null }
}

// The cross-check, question by question — only the ones that actually met a reading of the page.
function answerRows(f: Record<string, string>): Merged[] {
  const meta = parseJson(f.digest_json) as DigestMeta | null
  return Array.isArray(meta?.answers) ? (meta?.answers as Merged[]) : []
}

function decodeChips(f: Record<string, string>): { text: string; cls: string }[] {
  const chips: { text: string; cls: string }[] = []
  const meta = parseJson(f.digest_json) as DigestMeta | null
  // WHAT IT IS, first — the typed columns were only ever visible in the sheet, so the one screen built to test a…
  if (f.doc_kind) {
    chips.push({ text: String(f.doc_kind).replace(/_/g, ' '), cls: 'bg-primary/10 text-primary' })
  }
  if (f.person) {
    chips.push({
      text: `${f.person}${meta?.person_source ? ` (${meta.person_source})` : ''}`,
      cls: 'bg-surface-3 text-text-2',
    })
  }
  if (f.expires_on) {
    chips.push({
      text: `expires ${f.expires_on}`,
      cls: meta?.expired === 'yes'
        ? 'bg-rose-500/10 text-rose-600'
        : 'bg-surface-3 text-text-2',
    })
  }
  const dates = parseJson(f.digest_dates)
  if (Array.isArray(dates) && dates.length) {
    chips.push({
      text: `dates ${dates.slice(0, 3).join(' · ')}${dates.length > 3 ? ' …' : ''}`,
      cls: 'bg-surface-3 text-text-2',
    })
  }
  // THE MERGE.
  const agree = String(f.answers_agree || '')
  if (agree === 'yes') {
    chips.push({ text: 'the form and the paper agree', cls: 'bg-emerald-500/10 text-emerald-600' })
  } else if (agree === 'no') {
    const off = answerRows(f).filter((a) => a.agree === 'no')
    chips.push({
      text: off.length === 1 && off[0].label
        ? `${off[0].label}: the paper disagrees`
        : `${off.length || ''} answer${off.length === 1 ? '' : 's'} the paper disagrees with`.trim(),
      cls: 'bg-amber-500/10 text-amber-600',
    })
  } else if (!agree && meta?.dates_agree === 'yes') {
    chips.push({ text: 'matches what they typed', cls: 'bg-emerald-500/10 text-emerald-600' })
  } else if (!agree && meta?.dates_agree === 'no') {
    chips.push({ text: 'differs from what they typed', cls: 'bg-amber-500/10 text-amber-600' })
  }
  // A FILL IS NOT A READING, and the screen must never let the two look alike: this column came from the person…
  const filled = Array.isArray(meta?.answers_filled) ? (meta?.answers_filled as string[]) : []
  if (filled.length) {
    chips.push({
      text: `${filled.map((x) => x.replace(/_/g, ' ')).join(', ')} — from the form, not the file`,
      cls: 'bg-sky-500/10 text-sky-600',
    })
  }
  if (f.confidence) {
    const n = Number(f.confidence)
    chips.push({
      text: `${n}% sure`,
      cls: n >= 85 ? 'bg-surface-3 text-text-3' : 'bg-amber-500/10 text-amber-600',
    })
  }
  // WHAT THIS PAPER SETTLED.
  const settle = meta?.settle
  if (settle?.doc_id) {
    const did = settle.did ?? []
    if (did.length) {
      chips.push({
        text: `settled ${settle.doc_id} → ${did.join(' + ')}`,
        cls: 'bg-emerald-500/10 text-emerald-600',
      })
    } else if (settle.candidate === 'owed' || settle.staff === 'owed') {
      chips.push({
        text: `${settle.doc_id} is owed — ${settle.why || 'not handed in'}`,
        cls: 'bg-sky-500/10 text-sky-600',
      })
    } else {
      chips.push({
        text: `${settle.doc_id} · ${settle.why || 'nothing owed'}`,
        cls: 'bg-surface-3 text-text-3',
      })
    }
  }
  const ids = parseJson(f.digest_names)
  if (Array.isArray(ids) && ids.length) {
    chips.push({ text: ids.slice(0, 2).join(' · '), cls: 'bg-surface-3 text-text-3' })
  }
  return chips
}

export default function FormResponsesPage() {
  const [forms, setForms] = useState<FormRow[]>([])
  const [slug, setSlug] = useState('')
  const [fields, setFields] = useState<FormField[]>([])
  const [rows, setRows] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState('')
  /** the one file whose decoded text is showing */
  const [openFile, setOpenFile] = useState('')
  const [busy, setBusy] = useState('')

  /** A form loaded into the tracker opens Answers ON that form. */
  const focus = useContextStore((s) => s.focus)
  useEffect(() => {
    if (focus?.type === 'form' && focus.id) setSlug(focus.id)
  }, [focus])

  useEffect(() => {
    void (async () => {
      try {
        const res = await gasAction<{ forms?: FormRow[] }>('formsList', {})
        const list = res.forms ?? []
        setForms(list)
        setSlug((s) => s || list[0]?.slug || '')
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
      setLoading(false)
    })()
  }, [])

  const load = useCallback(async (which: string) => {
    if (!which) { setRows([]); setFields([]); return }
    setLoading(true)
    try {
      const res = await gasAction<{ fields?: FormField[]; submissions?: Submission[] }>(
        'formSubmissions', { slug: which })
      setFields(res.fields ?? [])
      setRows(res.submissions ?? [])
      setErr('')
    } catch (e) {
      setRows([]); setFields([])
      setErr(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(slug) }, [slug, load])

  // THE FILES A SUBMISSION CARRIED, with their digest verdicts.
  type LedgerFile = Record<string, string>
  const [files, setFiles] = useState<Record<string, LedgerFile[]>>({})
  useEffect(() => {
    if (!slug) { setFiles({}); return }
    void (async () => {
      try {
        const res = await gasAction<{ files?: LedgerFile[] }>('formFilesList', { form_slug: slug })
        const by: Record<string, LedgerFile[]> = {}
        for (const f of res.files ?? []) {
          const k = String(f.submission_id || '')
          if (!k) continue
          ;(by[k] = by[k] ?? []).push(f)
        }
        setFiles(by)
      } catch { setFiles({}) }
    })()
  }, [slug, rows.length])

  const DIGEST_TINT: Record<string, string> = {
    done: 'bg-emerald-500/10 text-emerald-600',
    pending: 'bg-surface-3 text-text-3',
    empty: 'bg-surface-3 text-text-3',
    unsupported: 'bg-amber-500/10 text-amber-600',
    error: 'bg-rose-500/10 text-rose-500',
  }

  const handle = async (id: string, state: string) => {
    setBusy(id)
    try {
      await gasAction('formSubmissionHandle', { id, state })
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, state } : r)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setBusy('')
  }

  // The three columns every form has, then whatever this one asks.
  const columns = useMemo(
    () => [{ key: 'submitted_at', label: 'When' }, { key: 'name', label: 'From' },
           ...fields.filter((f) => f.kind !== 'heading').map((f) => ({ key: f.key, label: f.label, kind: f.kind }))],
    [fields],
  )

  const waiting = rows.filter((r) => r.state !== 'handled').length

  return (
    <div className="w-full pb-16">
      {focus?.type === 'form' && <ContextBanner filtered />}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-text-1">Answers</h1>
          <p className="text-[12px] text-text-3">
            {waiting > 0 ? `${waiting} waiting for somebody` : 'Nothing waiting'}
            {rows.length ? ` · ${rows.length} in total` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={slug} onChange={(e) => setSlug(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-[12px] font-semibold text-text-1">
            {forms.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.title}{f.unhandled ? ` (${f.unhandled})` : ''}
              </option>
            ))}
          </select>
          <button onClick={() => void load(slug)} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </motion.div>

      {err && <Card><p className="text-[12px] text-rose-500">{err}</p></Card>}

      {!loading && !rows.length && !err && (
        <EmptyState title="No answers yet"
          body="When somebody fills the link in, it lands here." />
      )}

      {rows.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-text-3">
                  {columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap pb-2 pr-4 font-semibold">{c.label}</th>
                  ))}
                  <th className="pb-2 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <>
                    <tr key={r.id}
                      onClick={() => setOpen((o) => (o === r.id ? '' : r.id))}
                      className={cn('cursor-pointer border-b border-border/50 hover:bg-surface-2',
                        r.state !== 'handled' && 'font-medium')}>
                      {columns.map((c) => (
                        <td key={c.key} className="max-w-[280px] truncate py-2 pr-4 text-text-1">
                          {c.key === 'submitted_at'
                            ? String(r[c.key] ?? '').slice(0, 16).replace('T', ' ')
                            : 'kind' in c && c.kind === 'phone' ? formatPhoneDisplay(r[c.key]) : String(r[c.key] ?? '')}
                        </td>
                      ))}
                      <td className="py-2">
                        {r.state === 'handled'
                          ? <span className="text-emerald-600">handled</span>
                          : <span className="text-amber-600">new</span>}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr key={`${r.id}-open`} className="border-b border-border/50 bg-surface-2">
                        <td colSpan={columns.length + 1} className="p-3">
                          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {fields.filter((f) => f.kind !== 'heading').map((f) => (
                              <div key={f.key}>
                                <dt className="text-[11px] font-semibold text-text-3">{f.label}</dt>
                                <dd className="whitespace-pre-wrap text-[12px] text-text-1">
                                  {f.kind === 'phone' ? formatPhoneDisplay(r[f.key]) || '—' : String(r[f.key] ?? '—')}
                                </dd>
                              </div>
                            ))}
                            {(r.email || r.phone) && (
                              <div>
                                <dt className="text-[11px] font-semibold text-text-3">Reach them</dt>
                                <dd className="text-[12px] text-text-1">
                                  {[r.email, formatPhoneDisplay(r.phone)].filter(Boolean).join(' · ')}
                                </dd>
                              </div>
                            )}
                          </dl>
                          {(files[r.id] ?? []).length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              <p className="text-[11px] font-semibold text-text-3">
                                Files · digested by the platform
                              </p>
                              {(files[r.id] ?? []).map((f) => (
                                <div key={f.file_id} className="flex flex-wrap items-center gap-2 text-[12px]">
                                  <a href={f.file_url} target="_blank" rel="noreferrer"
                                    className="font-medium text-primary hover:underline">
                                    {f.file_name}
                                  </a>
                                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold',
                                    DIGEST_TINT[String(f.digest_state)] ?? 'bg-surface-3 text-text-3')}>
                                    {String(f.digest_state || 'pending')}
                                  </span>
                                  {f.digest_category && (
                                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold text-text-2">
                                      {String(f.digest_category)}
                                    </span>
                                  )}
                                  {f.digest_text_chars && Number(f.digest_text_chars) > 0 && (
                                    <span className="text-[10.5px] text-text-3">
                                      {f.digest_text_chars} chars read
                                    </span>
                                  )}
                                  {f.digest_error && (
                                    <span className="max-w-[300px] truncate text-[10.5px] text-rose-500">
                                      {String(f.digest_error)}
                                    </span>
                                  )}
                                  {/* WHAT THE DECODER ACTUALLY FOUND — the dates
                                      it read, whether they agree with what the
                                      person typed, the anchors, and the first
                                      lines of the text. Without this the only
                                      way to test a decode is to open the sheet. */}
                                  {decodeChips(f).map((chip) => (
                                    <span key={chip.text}
                                      className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', chip.cls)}>
                                      {chip.text}
                                    </span>
                                  ))}
                                  {(String(f.digest_text || '').trim() || answerRows(f).length > 0) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setOpenFile((o) => (o === f.file_id ? '' : String(f.file_id)))
                                      }}
                                      className="text-[10.5px] font-semibold text-primary hover:underline">
                                      {openFile === f.file_id ? 'hide what it read' : 'what it read'}
                                    </button>
                                  )}
                                  {openFile === f.file_id && (
                                    <div className="mt-1 w-full space-y-2">
                                      {answerRows(f).length > 0 && (
                                        <div className="rounded-md border border-border bg-surface p-2">
                                          <p className="mb-1 text-[10.5px] font-semibold text-text-3">
                                            What they typed, against what the paper says
                                          </p>
                                          <div className="space-y-1">
                                            {answerRows(f).map((a) => (
                                              <div key={String(a.key)}
                                                className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                                                <span className="font-semibold text-text-2">{a.label}</span>
                                                <span className="text-text-1">{a.said}</span>
                                                {a.found && (
                                                  <span className="text-text-3">· the paper: {a.found}</span>
                                                )}
                                                <span className={cn('rounded-full px-1.5 py-0.5 text-[9.5px] font-bold',
                                                  a.agree === 'yes' ? 'bg-emerald-500/10 text-emerald-600'
                                                    : a.agree === 'no' ? 'bg-amber-500/10 text-amber-600'
                                                      : 'bg-surface-3 text-text-3')}>
                                                  {a.agree === 'yes' ? 'agree'
                                                    : a.agree === 'no' ? 'disagree' : (a.note || 'nothing to compare')}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      <pre className="max-h-48 w-full overflow-auto whitespace-pre-wrap
                                                      rounded-md border border-border bg-surface p-2
                                                      text-[11px] leading-snug text-text-2">
                                        {String(f.digest_text || '')}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-3">
                            {r.state === 'handled' ? (
                              <button onClick={(e) => { e.stopPropagation(); void handle(r.id, 'new') }}
                                disabled={busy === r.id}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
                                <RotateCcw size={13} /> Put it back
                              </button>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); void handle(r.id, 'handled') }}
                                disabled={busy === r.id}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
                                <CheckCircle2 size={13} /> Mark handled
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
