// DRIVE READING ROOM — one component, six the old platform screens (gap survey §6).
// the old platform had the same screen six times: a Drive folder's files in a rail, the picked file read IN PLACE…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, FolderOpen, Loader2, Search, Trash2, Upload, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { ohioDay } from '@/lib/ohio'
import { cn } from '@/lib/utils'

export type RoomFile = {
  id: string
  name: string
  mime: string
  size_bytes: number
  modified_time: string
  web_view_link: string
  category?: string
  case_path?: string
}

type RoomAnswer = {
  configured: boolean
  reason?: string
  folder_name?: string
  truncated?: boolean
  writable?: boolean
  files: RoomFile[]
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

function kindOf(f: RoomFile): string {
  const m = f.mime || ''
  if (m.includes('pdf')) return 'PDF'
  if (m.includes('word') || f.name.match(/\.docx?$/i)) return 'DOC'
  if (m.includes('spreadsheet') || f.name.match(/\.(xlsx?|csv)$/i)) return 'SHEET'
  if (m.startsWith('image/')) return 'IMG'
  if (m.startsWith('video/')) return 'VIDEO'
  return (f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5)
}

/** Sheets are excluded from the inline preview — Drive's iframe clips them. */
const previewable = (f: RoomFile) => kindOf(f) !== 'SHEET'

export default function DriveReadingRoom({ room, emptyLine, tree }: {
  room: 'interviews' | 'invoices' | 'audits' | 'training' | 'isp' | 'houses'
  /** the sentence the empty room shows under its title */
  emptyLine?: string
  // TREE LAYOUT (the Audit Library's shape): a category select with counts and collapsible case folders instead of…
  tree?: boolean
}) {
  const role = useAuthStore((s) => s.user?.role ?? '')
  const [answer, setAnswer] = useState<RoomAnswer | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [openFile, setOpenFile] = useState<RoomFile | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    setFailed('')
    gasAction<RoomAnswer>('docRoomList', { room })
      .then((r) => setAnswer(r))
      .catch((err) => setFailed(err instanceof Error && err.message.startsWith('Unknown action')
        ? 'The reading rooms are not published yet — Implantar → Nova versão carries them.'
        : err instanceof Error ? err.message : 'The folder could not be read.'))
      .finally(() => setLoading(false))
  }, [room])
  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const f of answer?.files ?? []) if (f.category) set.add(f.category)
    return [...set].sort()
  }, [answer])

  /** tree only: categories with counts, biggest cabinet first. */
  const catCounts = useMemo(() => {
    const by = new Map<string, number>()
    for (const f of answer?.files ?? []) {
      const c = f.category || 'Uncategorised'
      by.set(c, (by.get(c) ?? 0) + 1)
    }
    return [...by.entries()].sort((a, b) => b[1] - a[1])
  }, [answer])

  /** tree only: which case folders are collapsed (default: all open). */
  const [closedCases, setClosedCases] = useState<Set<string>>(new Set())
  const toggleCase = (k: string) => setClosedCases((prev) => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (answer?.files ?? []).filter((f) =>
      (!category || f.category === category) &&
      (!q || f.name.toLowerCase().includes(q) ||
        (f.case_path ?? '').toLowerCase().includes(q)))
  }, [answer, query, category])

  // tree only: visible files grouped by `category › case`.
  const grouped = useMemo(() => {
    if (!tree) return []
    const by = new Map<string, RoomFile[]>()
    for (const f of visible) {
      const key = [category ? '' : (f.category || 'Uncategorised'), f.case_path || ''].filter(Boolean).join(' › ')
        || (f.category || 'Uncategorised')
      const list = by.get(key) ?? []
      list.push(f)
      by.set(key, list)
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tree, visible, category])

  const upload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast({ type: 'warning', title: 'Too large', body: 'Files past 20 MB go in through Drive itself.' })
      return
    }
    setUploading(true)
    try {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())))
      const created = await gasAction<RoomFile>('docRoomUpload',
        { room, filename: file.name, base64: b64, mime: file.type || 'application/octet-stream' })
      setAnswer((a) => a ? { ...a, files: [created, ...a.files] } : a)
      toast({ type: 'success', title: 'Filed', body: `${file.name} is in the folder.` })
    } catch (err) {
      toast({ type: 'danger', title: 'Not uploaded',
        body: err instanceof Error ? err.message : 'Drive refused it.' })
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const trash = async (f: RoomFile) => {
    const ok = await askConfirm({
      title: 'Move this file to the Drive trash?',
      body: `"${f.name}" leaves the folder for everyone. It stays recoverable in Drive's own trash.`,
      confirmLabel: 'Trash it', tone: 'danger',
    })
    if (!ok) return
    try {
      await gasAction('docRoomTrash', { room, id: f.id })
      setAnswer((a) => a ? { ...a, files: a.files.filter((x) => x.id !== f.id) } : a)
      if (openFile?.id === f.id) setOpenFile(null)
      toast({ type: 'success', title: 'Trashed', body: 'Recoverable from Drive’s trash.' })
    } catch (err) {
      toast({ type: 'danger', title: 'Not trashed', body: err instanceof Error ? err.message : 'Drive refused.' })
    }
  }

  const canWrite = (answer?.writable ?? false) && (role === 'admin' || role === 'manager')

  /** One file row — the flat rooms and the tree's folders share it. */
  const fileRow = (f: RoomFile) => (
    <div key={f.id}
      className={cn('group flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors',
        openFile?.id === f.id ? 'bg-tint-primary' : 'hover:bg-surface-2',
        tree && 'pl-6')}>
      <button onClick={() => previewable(f) ? setOpenFile(f) : window.open(f.web_view_link, '_blank', 'noopener')}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 font-mono text-[9px] font-bold text-text-2">
          {kindOf(f)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="clamp-1 block text-[13px] font-medium text-text-1">{f.name}</span>
          <span className="clamp-1 block text-[11px] text-text-3">
            {[tree ? '' : f.case_path, fmtBytes(f.size_bytes), ohioDay(f.modified_time)].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      {role === 'admin' && (answer?.writable ?? false) && (
        <button onClick={() => void trash(f)} aria-label={`Trash ${f.name}`}
          className="hidden h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:text-danger group-hover:grid">
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-[calc(100dvh-220px-var(--hub-strip-h,0px))] min-h-[420px] gap-3">
      {/* rail */}
      <aside className={cn('flex w-full flex-col rounded-lg border border-border bg-surface shadow-1 md:w-[340px] md:shrink-0',
        openFile && 'hidden md:flex')}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files…"
              className="h-9 w-full rounded-full border border-border bg-surface-2 pl-8 pr-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
          </div>
          {canWrite && (
            <>
              <input ref={fileInput} type="file" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
              <button onClick={() => fileInput.current?.click()} disabled={uploading}
                title="Upload into the folder" aria-label="Upload"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-50">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              </button>
            </>
          )}
        </div>
        {tree && catCounts.length > 0 && (
          <div className="shrink-0 border-b border-border px-3 py-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[12.5px] font-semibold text-text-1 outline-none focus:border-primary"
              aria-label="Filter by category"
            >
              <option value="">All categories ({(answer?.files ?? []).length})</option>
              {catCounts.map(([c, n]) => (
                <option key={c} value={c === 'Uncategorised' ? '' : c}>{c} ({n})</option>
              ))}
            </select>
          </div>
        )}
        {!tree && categories.length > 0 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
            {['', ...categories].map((c) => (
              <button key={c || 'all'} onClick={() => setCategory(c)}
                className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                  category === c ? 'bg-primary-soft text-primary-strong' : 'bg-surface-2 text-text-2 hover:text-text-1')}>
                {c || 'All'}
              </button>
            ))}
          </div>
        )}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <p className="flex items-center gap-2 p-4 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the folder…
            </p>
          )}
          {!loading && (failed || answer?.configured === false) && (
            <p className="p-4 text-[12.5px] leading-5 text-text-3">{failed || answer?.reason}</p>
          )}
          {!loading && !failed && answer?.configured && visible.length === 0 && (
            <p className="p-4 text-[12.5px] text-text-3">
              {query || category ? 'Nothing matches.' : (emptyLine || 'The folder is empty.')}
            </p>
          )}
          {(tree ? [] : visible).map((f) => fileRow(f))}
          {tree && grouped.map(([caseKey, files]) => {
            const open = query.trim() !== '' || !closedCases.has(caseKey)
            return (
              <div key={caseKey}>
                <button
                  onClick={() => toggleCase(caseKey)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  {open ? <ChevronDown size={13} className="shrink-0 text-text-3" /> : <ChevronRight size={13} className="shrink-0 text-text-3" />}
                  <FolderOpen size={13} className="shrink-0 text-text-3" />
                  <span className="clamp-1 min-w-0 flex-1 text-[12px] font-semibold text-text-2">{caseKey}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-3">{files.length}</span>
                </button>
                {open && files.map((f) => fileRow(f))}
              </div>
            )
          })}
          {answer?.truncated && (
            <p className="p-3 text-[11px] text-text-3">Showing the newest {answer.files.length} — narrow with search.</p>
          )}
        </div>
      </aside>

      {/* reader */}
      <section className={cn('min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface shadow-1',
        openFile ? 'flex' : 'hidden md:flex')}>
        {!openFile ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-tint-blue">
              <FileText size={20} className="text-tint-fg-blue" />
            </span>
            <p className="text-[14px] font-semibold text-text-1">Pick a file to read it here</p>
            <p className="max-w-[300px] text-[12.5px] leading-5 text-text-3">
              PDFs, documents, images and video open in place. Spreadsheets open in Drive.
            </p>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
              <FolderOpen size={14} className="shrink-0 text-text-3" />
              <p className="clamp-1 min-w-0 flex-1 text-[13px] font-semibold text-text-1">
                {[openFile.category, openFile.case_path].filter(Boolean).join(' › ')}
                {(openFile.category || openFile.case_path) ? ' · ' : ''}{openFile.name}
              </p>
              <a href={openFile.web_view_link} target="_blank" rel="noopener noreferrer"
                className="shrink-0 text-[12px] font-semibold text-primary hover:underline">
                Open in Drive
              </a>
              <button onClick={() => setOpenFile(null)} aria-label="Close reader"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1">
                <X size={14} />
              </button>
            </div>
            {/* Google's own viewer; sandboxed against navigation of THIS tab.
                allow-scripts is required (the viewer is an app), allow-popups
                lets "pop out" work; the frame stays another origin, so it
                cannot see this page. */}
            <iframe
              key={openFile.id}
              title={openFile.name}
              src={`https://drive.google.com/file/d/${openFile.id}/preview`}
              sandbox="allow-scripts allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
              className="min-h-0 w-full flex-1 rounded-b-lg bg-white"
            />
          </>
        )}
      </section>
    </div>
  )
}
