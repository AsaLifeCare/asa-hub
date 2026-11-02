// FORMS — the detachable pages, and where their links live.
// A detachable page — house repairs, say — whose link can be sent on its own the way a Google Form is: the person…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Archive, Check, Copy, Eye, EyeOff, ExternalLink, FlaskConical, Import, Link2, Pencil, RefreshCw, Users, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import DragPerson from '@/components/shared/DragPerson'
import { askConfirm } from '@/stores/useDialogStore'
import { useContextStore } from '@/stores/useContextStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import EmbeddedForm from '@/components/shared/EmbeddedForm'
import ImportFormModal from './ImportFormModal'

type FormField = {
  key: string; label: string; kind?: string; required?: string; options?: string[]
  // the `file` kind: which upload context receives the files, how many, and which extensions — validated…
  context?: string; max_files?: number; accept?: string[]
}
type FormRow = {
  id: string; slug: string; title: string; intro: string; status: string
  url: string; fields: FormField[]; field_count: number
  submissions: number; unhandled: number; notify_to: string
  // the Google original this form was imported from — remembered so Reimport is one press (blank on hand-built…
  source_url?: string
}

const STATUS_TINT: Record<string, string> = {
  open: 'text-emerald-600 bg-emerald-500/10',
  /** a debug run walks the real lane; only the badge tells it apart */
  testing: 'text-sky-600 bg-sky-500/10',
  draft: 'text-amber-600 bg-amber-500/10',
  closed: 'text-text-3 bg-surface-2',
}

export default function FormsPage() {
  // KEPT COPY — everything vanished on screen while the rows sat intact in house the whole time; a congested…
  const [forms, setForms] = useState<FormRow[]>(() => {
    try { return JSON.parse(localStorage.getItem('asa:forms:list') || '[]') as FormRow[] }
    catch { return [] }
  })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  /** slug of the card whose name is being edited, and the draft text */
  const [renaming, setRenaming] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  // slug of the card showing its form in miniature — one at a time, so the list stays a list and does not become a…
  const [preview, setPreview] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await gasAction<{ forms?: FormRow[] }>('formsList', {}, { timeoutMs: 120_000 })
      setForms(res.forms ?? [])
      try { localStorage.setItem('asa:forms:list', JSON.stringify(res.forms ?? [])) } catch { /* kept copy only */ }
      setErr('')
    } catch (e) {
      // the kept copy STAYS on screen — a timed-out list is not an empty one
      setErr(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // COPY WITHOUT A BROWSER DIALOG.
  const copy = async (f: FormRow) => {
    try {
      await navigator.clipboard.writeText(f.url)
      setCopied(f.slug)
      window.setTimeout(() => setCopied((c) => (c === f.slug ? '' : c)), 1800)
    } catch {
      const node = document.getElementById(`url-${f.slug}`)
      if (node) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }

  // Archive-style delete — a delete button on every form, under the house rule: nothing is deleted; the link dies…
  const archive = async (f: FormRow) => {
    const ok = await askConfirm({
      title: `Archive ${f.title}?`,
      body: 'The link stops answering and the form leaves this list. Nothing is deleted — the answers stay, and an admin can put it back.',
      tone: 'danger',
      confirmLabel: 'Archive',
    })
    if (!ok) return
    setBusy(f.slug)
    try {
      await gasAction('formArchive', { slug: f.slug, archived: true }, { timeoutMs: 120_000 })
      toast({ type: 'success', title: `${f.title} archived`, body: 'The link answers 404; the answers stay filed.' })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setBusy('')
  }

  // Reimport: the SAME original, always — re-copy the questions ONTO this form.
  const reimport = async (f: FormRow) => {
    const ok = await askConfirm({
      title: `Reimport ${f.title}?`,
      body: 'The questions are re-copied from the same Google original this form came from. The link, the status, the settings and every answer stay exactly where they are.',
      confirmLabel: 'Reimport',
    })
    if (!ok) return
    setBusy(f.slug)
    try {
      const r = await gasAction<{ questions?: number; skipped?: string[]; breakdown?: string }>(
        'formImportGoogle', { reimport_slug: f.slug }, { timeoutMs: 60_000 })
      toast({
        type: 'success',
        title: `${f.title} refreshed`,
        body: `${r.questions ?? 0} question${r.questions === 1 ? '' : 's'}`
          + (r.breakdown ? ` (kept: ${r.breakdown})` : '')
          + (r.skipped?.length ? ` · ${r.skipped.length} skipped (${r.skipped.join('; ')})` : '')
          + ' — the link and the answers stayed.',
      })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setBusy('')
  }

  // Rename — a form's name is editable, from a button ahead of the upload.
  const rename = async (f: FormRow) => {
    const title = renameDraft.trim()
    if (!title || title === f.title) { setRenaming(''); return }
    setBusy(f.slug)
    try {
      await gasAction('formRename', { slug: f.slug, title }, { timeoutMs: 60_000 })
      setForms((fs) => fs.map((r) => (r.slug === f.slug ? { ...r, title } : r)))
      toast({ type: 'success', title: 'Renamed', body: `${f.title} → ${title}. The link stayed the same.` })
      setRenaming('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setBusy('')
  }

  /** A focused form floats first and wears the ring — the tracker's read. */
  const focus = useContextStore((s) => s.focus)
  const ordered = useMemo(() => {
    if (focus?.type !== 'form') return forms
    return [...forms].sort((a, b) =>
      Number(b.slug === focus.id || b.title === focus.name) - Number(a.slug === focus.id || a.title === focus.name))
  }, [forms, focus])

  const setStatus = async (f: FormRow, status: string) => {
    setBusy(f.slug)
    try {
      await gasAction('formSave', {
        slug: f.slug, title: f.title, intro: f.intro,
        fields: JSON.stringify(f.fields), status,
        notify_to: f.notify_to,
      }, { timeoutMs: 60_000 })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setBusy('')
  }

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-bold text-text-1">Forms</h1>
          <p className="text-[12px] text-text-3">
            A page you send as a link. The person fills it in and it lands here — no account, no Google Form.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportOpen(true)}
            title="Bring a Google Form in by its link — the questions are copied here"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:bg-primary-hover">
            <Import size={13} /> Import
          </button>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </motion.div>

      <ImportFormModal open={importOpen} onOpenChange={setImportOpen}
        onImported={() => void load()} />

      {err && (
        <Card><p className="text-[12px] text-rose-500">{err}</p></Card>
      )}

      {!loading && !forms.length && !err && (
        <EmptyState title="No forms yet"
          body="A form is a row: its questions live in a cell, so adding one is a save." />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {ordered.map((f) => (
          <Card key={f.slug} className={cn(focus?.type === 'form' && (f.slug === focus.id || f.title === focus.name) && 'ring-2 ring-primary')}>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {renaming === f.slug ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename(f)
                        if (e.key === 'Escape') setRenaming('')
                      }}
                      autoFocus
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[13px] font-bold text-text-1"
                    />
                    <button onClick={() => void rename(f)} disabled={busy === f.slug}
                      title="Save the new name"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-emerald-600 hover:bg-surface-2 disabled:opacity-40">
                      <Check size={14} />
                    </button>
                    <button onClick={() => setRenaming('')}
                      title="Keep the old name"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 hover:bg-surface-2">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    {/* the form's NAME is a tracker handle, like every person's */}
                    <DragPerson
                      name={f.title}
                      id={f.slug}
                      type="form"
                      subtitle={`/${f.slug} · ${f.status}`}
                      className="block min-w-0"
                    >
                      <h2 className="clamp-1 text-[14px] font-bold text-text-1" title={`Drag ${f.title} to the tracker to focus on this form`}>{f.title}</h2>
                    </DragPerson>
                    <p className="text-[11px] text-text-3">
                      {f.field_count} question{f.field_count === 1 ? '' : 's'} · /{f.slug}
                    </p>
                  </>
                )}
              </div>
              <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                STATUS_TINT[f.status] ?? STATUS_TINT.closed)}>
                {f.status}
              </span>
            </div>

            {f.intro && <p className="mb-3 line-clamp-2 text-[12px] text-text-2">{f.intro}</p>}

            <div className="mb-3 flex items-center gap-4 text-[12px] text-text-2">
              <span className="inline-flex items-center gap-1.5">
                <Users size={13} className="text-text-3" />
                <span className="font-semibold">{f.submissions}</span> answer{f.submissions === 1 ? '' : 's'}
              </span>
              {f.unhandled > 0 && (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600">
                  {f.unhandled} waiting
                </span>
              )}
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
              <Link2 size={13} className="shrink-0 text-text-3" />
              <code id={`url-${f.slug}`} className="min-w-0 flex-1 truncate text-[11px] text-text-2">{f.url}</code>
              <button onClick={() => void copy(f)} title="Copy the link"
                className="shrink-0 rounded p-1 text-text-3 hover:bg-surface hover:text-text-1">
                {copied === f.slug ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              </button>
              <a href={f.url} target="_blank" rel="noreferrer" title="Open it as they will see it"
                className="shrink-0 rounded p-1 text-text-3 hover:bg-surface hover:text-text-1">
                <ExternalLink size={13} />
              </a>
              {(f.status === 'open' || f.status === 'testing') && (
                <button
                  onClick={() => setPreview((s) => (s === f.slug ? null : f.slug))}
                  title={preview === f.slug
                    ? 'Close the miniature'
                    : 'See it here, in miniature — the same questions, as a piece of this page'}
                  aria-label={`Preview ${f.title}`}
                  className={cn('shrink-0 rounded p-1 transition-colors hover:bg-surface',
                    preview === f.slug ? 'text-primary' : 'text-text-3 hover:text-text-1')}>
                  {preview === f.slug ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
            </div>

            {/*
              THE MINIATURE, ON THE PAGE THAT OWNS THE FORMS — a form
              embedded small, as a piece of the software rather than a whole
              page.

              It reads through the SAME public door the link uses, so what
              shows here is exactly what a stranger gets — which is why the
              button only appears once the link actually answers. A closed
              form has nothing to preview, and pretending otherwise would
              make this a mock-up rather than the form.
            */}
            {preview === f.slug && (
              <div className="mb-3 rounded-[12px] border border-border bg-surface-2 p-3">
                <EmbeddedForm
                  url={f.url}
                  showTitle={false}
                  density="compact"
                  maxHeight={360}
                  onFiled={() => { setPreview(null); void load() }}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              {f.status !== 'open' && f.status !== 'testing' ? (
                <button onClick={() => void setStatus(f, 'open')} disabled={busy === f.slug}
                  className="h-8 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
                  {busy === f.slug ? 'Opening…' : 'Open the link'}
                </button>
              ) : (
                <button onClick={() => void setStatus(f, 'closed')} disabled={busy === f.slug}
                  className="h-8 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">
                  {busy === f.slug ? 'Closing…' : 'Close it'}
                </button>
              )}
              <span className="text-[11px] text-text-3">
                {f.status === 'open'
                  ? 'Anybody holding the link can fill it in.'
                  : f.status === 'testing'
                    ? 'Test mode — the link walks the real lane; the badge says so.'
                    : 'The link answers nothing until it is open.'}
              </span>
              <button
                onClick={() => { setRenaming(f.slug); setRenameDraft(f.title) }}
                disabled={busy === f.slug}
                title="Rename this form — the link, the questions and the answers stay"
                aria-label={`Rename ${f.title}`}
                className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-primary disabled:opacity-40"
              >
                <Pencil size={14} />
              </button>
              {(f.status === 'open' || f.status === 'testing') && (
                <button
                  onClick={() => void setStatus(f, f.status === 'testing' ? 'open' : 'testing')}
                  disabled={busy === f.slug}
                  title={f.status === 'testing'
                    ? 'This form is in TEST mode — press to go live'
                    : 'Mark as a test — the link keeps working, the badge turns blue'}
                  aria-label={`Toggle test mode for ${f.title}`}
                  className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-40',
                    f.status === 'testing'
                      ? 'bg-sky-500/15 text-sky-600 hover:bg-sky-500/25'
                      : 'text-text-3 hover:bg-surface-2 hover:text-sky-600')}
                >
                  <FlaskConical size={14} />
                </button>
              )}
              <button
                onClick={() => void reimport(f)}
                disabled={busy === f.slug}
                title="Reimport — re-copy the questions from the same Google original; link and answers stay"
                aria-label={`Reimport ${f.title}`}
                className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-primary disabled:opacity-40"
              >
                <RefreshCw size={14} className={busy === f.slug ? 'animate-spin' : undefined} />
              </button>
              <button
                onClick={() => void archive(f)}
                disabled={busy === f.slug}
                title="Archive this form — the link dies, the answers stay"
                aria-label={`Archive ${f.title}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-40"
              >
                <Archive size={14} />
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
