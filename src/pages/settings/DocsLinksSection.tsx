// Settings → Docs: the register behind the Docs app.
// Installing the app adds a configuration under Docs: links to documents — PDF, DOC — each with its category beside…
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, FolderInput, GripVertical, Loader2, Plus, Trash2 } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { invalidate } from '@/lib/apiCache'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

/** One registered document. `url` is what the reader opens. */
export type DocLink = {
  id: string
  title: string
  url: string
  category: string
}

// Starting vocabulary — it is typed over, and whatever is typed becomes a category the library groups by.
const SUGGESTED = ['Playbooks', 'Clinical guides', 'Operations', 'HR', 'Safety', 'Forms']

const str = (v: unknown) => String(v ?? '').trim()

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export default function DocsLinksSection() {
  const [rows, setRows] = useState<DocLink[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [folderUrl, setFolderUrl] = useState('')
  const [folderCategory, setFolderCategory] = useState('')
  const [deep, setDeep] = useState(false)
  const [draft, setDraft] = useState<{ title: string; url: string; category: string }>({
    title: '', url: '', category: '',
  })

  const load = useCallback(() => {
    let alive = true
    api
      .list<Record<string, unknown>>('documents' as never)
      .then((r) => {
        if (!alive) return
        setRows(
          (Array.isArray(r) ? r : [])
            .map((x, i) => ({
              id: str(x.id) || `doc-${i}`,
              title: str(x.title),
              url: str(x.url) || str(x.link) || str(x.fileUrl),
              category: str(x.category) || str(x.collection),
            }))
            .filter((x) => x.title || x.url),
        )
      })
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => load(), [load])

  const add = async () => {
    const title = draft.title.trim()
    const url = draft.url.trim()
    const category = draft.category.trim() || 'Uncategorised'
    if (!title || !url) {
      toast({ type: 'warning', title: 'A document needs a name and a link', body: 'Both fields are required.' })
      return
    }
    setBusy('new')
    try {
      const saved = await api.create<Record<string, unknown>>('documents' as never, {
        title, url, category, collection: category, addedAt: new Date().toISOString(),
      } as never)
      setRows((prev) => [...(prev ?? []), { id: str(saved?.id) || `doc-${Date.now()}`, title, url, category }])
      setDraft({ title: '', url: '', category })
      invalidate('documents')
      toast({ type: 'success', title: 'Document added', body: `${title} is in the library.` })
    } catch (e) {
      toast({
        type: 'danger',
        title: 'Could not add the document',
        body: e instanceof Error ? e.message : 'The backend did not answer.',
      })
    } finally {
      setBusy(null)
    }
  }

  const patch = async (row: DocLink, field: keyof DocLink, value: string) => {
    const before = rows ?? []
    setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, [field]: value } : r)))
    try {
      const body: Record<string, string> = { [field]: value }
      if (field === 'category') body.collection = value
      await api.update('documents' as never, row.id, body as never)
      invalidate('documents')
    } catch (e) {
      setRows(before)
      toast({
        type: 'danger',
        title: 'Could not save',
        body: e instanceof Error ? e.message : 'The backend did not answer.',
      })
    }
  }

  const remove = async (row: DocLink) => {
    const before = rows ?? []
    setBusy(row.id)
    setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id))
    try {
      await api.remove('documents' as never, row.id)
      invalidate('documents')
      toast({ type: 'success', title: 'Removed', body: `${row.title} is out of the library.` })
    } catch (e) {
      setRows(before)
      toast({
        type: 'danger',
        title: 'Could not remove',
        body: e instanceof Error ? e.message : 'The backend did not answer.',
      })
    } finally {
      setBusy(null)
    }
  }

  // Read a Drive folder and register what is inside it.
  const importFolder = async () => {
    const url = folderUrl.trim()
    if (!url) return toast({ type: 'warning', title: 'Paste the folder link first.' })
    setBusy('folder')
    try {
      const r = await gasAction<{
        folder: string; added: number; skipped: number; capped?: boolean; titles?: string[]
        already_listed?: number; refused_kind?: number; refused_kinds?: string
      }>('docsImportFolder', {
        url,
        category: folderCategory.trim(),
        include_subfolders: deep,
      })
      invalidate('documents')
      load()
      setFolderUrl('')
      toast({
        type: r.added > 0 ? 'success' : 'info',
        title: r.added > 0
          ? `${r.added} document${r.added === 1 ? '' : 's'} from “${r.folder}”`
          : `Nothing new in “${r.folder}”`,
        body: r.added > 0
          ? [(r.titles ?? []).slice(0, 3).join(' · '), r.capped ? 'Capped at 300 — press again for the rest.' : '']
              .filter(Boolean).join(' — ')
          // WHICH of two opposite things happened, said apart — three refused files answered with a shrug, leaving…
          : [
              r.already_listed ? `${r.already_listed} already on the platform` : '',
              r.refused_kind ? `${r.refused_kind} refused${r.refused_kinds ? ` (${r.refused_kinds})` : ''}` : '',
            ].filter(Boolean).join(' · ') || 'The folder is empty.',
      })
    } catch (e) {
      toast({
        type: 'danger',
        title: 'The folder was not imported',
        body: e instanceof Error ? e.message : 'The backend did not answer.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <motion.section
      id="docslinks"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Docs"
          sub="The documents the Docs app lists — a category, a name and a link. Everyone sees what you register here."
        />

        {rows === null ? (
          <p className="text-[13px] text-text-3">Loading…</p>
        ) : (
          <>
            {rows.length > 0 && (
              <div className="mb-3 overflow-hidden rounded-md border border-border">
                <div className="grid grid-cols-[150px_1fr_1fr_36px] items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  <span>Category</span>
                  <span>Document</span>
                  <span>Link</span>
                  <span />
                </div>
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[150px_1fr_1fr_36px] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <input
                      defaultValue={r.category}
                      onBlur={(e) => e.target.value.trim() !== r.category && patch(r, 'category', e.target.value.trim())}
                      list="asa-doc-categories"
                      placeholder="Category"
                      className={inputCls}
                    />
                    <input
                      defaultValue={r.title}
                      onBlur={(e) => e.target.value.trim() !== r.title && patch(r, 'title', e.target.value.trim())}
                      placeholder="Document name"
                      className={inputCls}
                    />
                    <span className="flex min-w-0 items-center gap-1.5">
                      <input
                        defaultValue={r.url}
                        onBlur={(e) => e.target.value.trim() !== r.url && patch(r, 'url', e.target.value.trim())}
                        placeholder="https://…"
                        className={cn(inputCls, 'font-mono text-[12px]')}
                      />
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open the link"
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-primary"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </span>
                    <button
                      onClick={() => remove(r)}
                      disabled={busy === r.id}
                      aria-label={`Remove ${r.title}`}
                      className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-tint-danger hover:text-tint-fg-danger disabled:opacity-40"
                    >
                      {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* the plus row — this is where a new document is added */}
            <div className="grid grid-cols-[150px_1fr_1fr_36px] items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
              <input
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                list="asa-doc-categories"
                placeholder="Category"
                className={inputCls}
              />
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Document name"
                className={inputCls}
              />
              <input
                value={draft.url}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void add()}
                placeholder="Paste the PDF or Doc link…"
                className={cn(inputCls, 'font-mono text-[12px]')}
              />
              <button
                onClick={() => void add()}
                disabled={busy === 'new'}
                aria-label="Add this document"
                title="Add this document"
                className="grid h-7 w-7 place-items-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                {busy === 'new' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>

            {/* A WHOLE FOLDER, AT ONCE — the Docs app takes a folder's link
                and imports every doc and PDF in it in one pass.
                Nothing is copied or moved — the
                folder is READ and its documents become rows, so Drive stays
                the authority on who may open each one. */}
            <div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
              <p className="mb-2 text-[12px] font-semibold text-text-1">…or import a whole folder</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void importFolder()}
                  placeholder="Paste the Drive FOLDER link…"
                  className={cn(inputCls, 'min-w-[220px] flex-1 font-mono text-[12px]')}
                />
                <input
                  value={folderCategory}
                  onChange={(e) => setFolderCategory(e.target.value)}
                  list="asa-doc-categories"
                  placeholder="Category (default: the folder's name)"
                  className={cn(inputCls, 'w-[220px]')}
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-2">
                  <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
                  Subfolders too
                </label>
                <button
                  onClick={() => void importFolder()}
                  disabled={busy === 'folder'}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
                >
                  {busy === 'folder' ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={14} />}
                  Import
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-4 text-text-3">
                Google Docs, PDFs and Word files are registered; anything else in the folder is left alone. Pressing it
                again adds only what is new — the documents already listed are recognised by their Drive link.
              </p>
            </div>

            <datalist id="asa-doc-categories">
              {[...new Set([...(rows ?? []).map((r) => r.category), ...SUGGESTED])]
                .filter(Boolean)
                .map((c) => (
                  <option key={c} value={c} />
                ))}
            </datalist>

            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-text-3">
              <GripVertical size={12} className="shrink-0" />
              Drive links and plain PDFs open inside the platform; anything else opens in a new tab.
            </p>
          </>
        )}
      </Card>
    </motion.section>
  )
}
