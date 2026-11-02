// TECHNOLOGY — the Technology Command Center, STANDALONE.
// The tie to the old platform is cut: at 100% coverage the old platform dies.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, BookText, CheckCircle2, ChevronDown, ChevronRight,
  CircleDot, Cpu, Download, ExternalLink, FileText, Folder, FolderOpen, HelpCircle,
  Loader2, Minus, Plus, RefreshCw, Rocket, Search, ShieldCheck, Wrench, X,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import DragPerson from '@/components/shared/DragPerson'
import { parseMarkdown } from '@/engine/templates/documents/importDoc'
import { Block } from '@/engine/templates/documents/Block'
import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'
import TechnologyHero from './TechnologyHero'
import {
  TECH_STATUSES, fmtDate, fmtSize, projLabel, projTint, technologyFigures,
  type TechDoc, type TechDocBytes, type TechDocsListing, type TechEngRow, type TechProject, type TechRead,
} from './technologyModel'

const ALL = '__all__'
type Tab = 'projects' | 'engineering' | 'documents' | 'library'

/** The reason a read gave, in a sentence a figure can carry. */
function reasonOf(e: unknown, fallback: string): string {
  const said = e instanceof Error ? e.message.trim() : String(e ?? '').trim()
  return said || fallback
}

/* ── helpers ── */
function safeHref(url?: string): string | null {
  const u = (url || '').trim()
  if (!u) return null
  if (/^(https?:|mailto:)/i.test(u)) return u
  return null
}
function splitJoined(v?: string): string[] {
  return String(v ?? '').split(' · ').map((s) => s.trim()).filter(Boolean)
}
function docTitle(name?: string): string {
  return (name || '').trim().replace(/\.(pdf|docx?|xlsx?|csv|md|txt|png|jpe?g|gif|webp|mov|mp4|m4v|webm)$/i, '') || (name || 'Untitled')
}
function kindOf(f?: TechDoc): string { return (f?.ext || 'file').toLowerCase() }
// md/txt READ IN THE PLATFORM'S OWN TYPE: the raw bytes come through technologyDocText (parentage-guarded, text…
function TextDocReader({ file }: { file: TechDoc }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setText(null)
    setError('')
    // the relay's cache, filled by the sweep — never a Drive call here
    const token = useAuthStore.getState().token
    fetch(`/techdocs/text/${encodeURIComponent(file.id ?? '')}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'not swept yet' : `refused (${r.status})`)
        // NOT-THE-RELAY'S-ANSWER guard: a path nginx stops carrying falls into the SPA fallback and answers…
        if ((r.headers.get('content-type') || '').includes('text/html')) {
          throw new Error('not the relay\'s answer')
        }
        return r.text()
      })
      .then((t) => { if (alive) setText(t) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [file.id])
  if (error) {
    const frame = previewUrl(file)
    return frame ? (
      <>
        <p className="border-b border-border px-4 py-1.5 text-[11px] text-text-3">
          The in-platform reader could not fetch this file ({error}) — Drive&rsquo;s preview stands in.
        </p>
        <iframe src={frame} title={file.name || 'technology document'} className="h-[66vh] w-full rounded-b-lg border-0" />
      </>
    ) : (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[12px] text-text-3">{error}</p>
      </div>
    )
  }
  if (text === null) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 size={18} className="animate-spin text-text-3" />
      </div>
    )
  }
  const isMd = /\.(md|markdown)$/i.test(file.name || '')
  return (
    <div className="scroll-thin h-[70vh] overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-[760px] space-y-4">
        {isMd
          ? parseMarkdown(text).blocks.map((b, i) => <Block key={i} b={b} />)
          : <pre className="whitespace-pre-wrap font-mono text-[13px] leading-[22px] text-text-2">{text}</pre>}
      </div>
    </div>
  )
}

/** The reader's frame: Drive renders the real file (the hub holds no cache copy). */
function previewUrl(f?: TechDoc | null): string | null {
  if (!f?.id) return null
  const k = kindOf(f)
  if (k === 'pdf' || k === 'image' || k === 'video' || k === 'word' || k === 'text') {
    return `https://drive.google.com/file/d/${f.id}/preview`
  }
  return null
}

/** A document the server keeps, as a blob of its PDF (`view`) or of the document itself (`original`). */
async function keptBlob(f: TechDoc, as: 'view' | 'original'): Promise<{ url: string; name: string; mime: string }> {
  const got = await gasAction<TechDocBytes>('techDocFile', { file_id: f.id, as }, { timeoutMs: 120000 })
  const raw = atob(got?.b64 || '')
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const mime = got?.mime || 'application/octet-stream'
  return { url: URL.createObjectURL(new Blob([bytes], { type: mime })), name: got?.name || f.name || 'document', mime }
}

/** The server's own copy handed to the browser as a download. */
function downloadKept(f: TechDoc) {
  keptBlob(f, 'original')
    .then(({ url, name }) => {
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    })
    .catch((e) => toast({ type: 'danger', title: 'Not downloaded', body: reasonOf(e, 'The document could not be downloaded.') }))
}

/** A kept document shown off the server's copy; Drive's preview stands in only when the copy cannot be read. */
function KeptDocView({ file }: { file: TechDoc }) {
  const [shown, setShown] = useState<{ url: string; mime: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    let made = ''
    setShown(null)
    setError('')
    keptBlob(file, 'view')
      .then((b) => { made = b.url; if (alive) setShown({ url: b.url, mime: b.mime }); else URL.revokeObjectURL(b.url) })
      .catch((e) => { if (alive) setError(reasonOf(e, 'the server could not hand it over')) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [file.id])
  if (error) {
    const frame = previewUrl(file)
    return frame ? (
      <>
        <p className="border-b border-border px-4 py-1.5 text-[11px] text-text-3">
          The server&rsquo;s copy could not be opened ({error}) — Drive&rsquo;s preview stands in.
        </p>
        <iframe src={frame} title={file.name || 'technology document'} className="h-[66vh] w-full rounded-b-lg border-0" />
      </>
    ) : (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[12px] text-text-3">{error}</p>
      </div>
    )
  }
  if (!shown) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 size={18} className="animate-spin text-text-3" />
      </div>
    )
  }
  if (shown.mime.startsWith('image/')) {
    return (
      <div className="flex h-[70vh] items-center justify-center overflow-auto p-4">
        <img src={shown.url} alt={file.name || 'technology document'} className="max-h-full max-w-full object-contain" />
      </div>
    )
  }
  if (shown.mime.startsWith('video/')) {
    return (
      <div className="flex h-[70vh] items-center justify-center bg-black/90 p-2">
        <video src={shown.url} controls className="max-h-full max-w-full" />
      </div>
    )
  }
  return <iframe key={shown.url} src={shown.url} title={file.name || 'technology document'} className="h-[70vh] w-full rounded-b-lg border-0" />
}

async function erpLane(path: string, body: Record<string, unknown>): Promise<void> {
  const token = useAuthStore.getState().token
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const env = await res.json().catch(() => ({}))
  if (Number(env.status) !== 200) throw new Error(String(env.message || `write failed (${res.status})`))
}

const SEV_TINT: Record<string, ExtendedTintName> = { P0: 'pink', P1: 'amber', P2: 'info' }
const ISSUE_STATUS: Record<string, { label: string; tint: ExtendedTintName; Icon: typeof CheckCircle2 }> = {
  fixed: { label: 'Fixed', tint: 'mint', Icon: CheckCircle2 },
  partial: { label: 'Partial', tint: 'amber', Icon: Wrench },
  ambiguous: { label: 'Needs owner', tint: 'violet', Icon: HelpCircle },
  open: { label: 'Open', tint: 'pink', Icon: CircleDot },
}

const KIND_BADGE: Record<string, { label: string; tint: ExtendedTintName }> = {
  pdf: { label: 'PDF', tint: 'pink' },
  word: { label: 'DOC', tint: 'blue' },
  image: { label: 'IMG', tint: 'info' },
  sheet: { label: 'XLS', tint: 'mint' },
  text: { label: 'TXT', tint: 'slate' },
  video: { label: 'VID', tint: 'amber' },
  file: { label: 'FILE', tint: 'slate' },
}

/* ═══════════════════════════ page ═══════════════════════════ */
export default function TechnologyPage() {
  const [tab, setTab] = useState<Tab>('projects')

  const [projects, setProjects] = useState<TechProject[] | null>(null)
  const [eng, setEng] = useState<TechEngRow[] | null>(null)
  const [docs, setDocs] = useState<TechDocsListing | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // EACH READ SAYS WHAT IT DID.
  const [projectsRead, setProjectsRead] = useState<TechRead>({ state: 'loading' })
  const [engRead, setEngRead] = useState<TechRead>({ state: 'loading' })
  const [docsRead, setDocsRead] = useState<TechRead>({ state: 'loading' })

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const p = await api.list<TechProject>('techProjects')
      setProjects(Array.isArray(p) ? p : [])
      setProjectsRead({ state: 'ready' })
    } catch (e) {
      setProjects((prev) => prev ?? [])
      setProjectsRead({ state: 'failed', why: reasonOf(e, 'the portfolio slice gave no answer') })
    }
    // the engineering state is a second slice; a failure must never blank the portfolio
    try {
      const e = await api.list<TechEngRow>('techEngineering')
      setEng(Array.isArray(e) ? e : [])
      setEngRead({ state: 'ready' })
    } catch (e) {
      setEng((prev) => prev ?? [])
      setEngRead({ state: 'failed', why: reasonOf(e, 'the assessment slice gave no answer') })
    }
    // the Drive half — the techDocs SLICE: the relay lists the folder itself on its sweep, so this read costs…
    try {
      const rows = await api.list<TechDoc & { kind?: string; configured?: boolean; reason?: string; folder_id?: string; folder_name?: string; folder_url?: string; updated_at?: string; truncated?: boolean; partial?: boolean; partial_reason?: string }>('techDocs')
      const meta = (rows ?? []).find((r) => r.kind === 'meta')
      const files = (rows ?? []).filter((r) => r.kind === 'file')
      const listing: TechDocsListing = {
        configured: meta?.configured !== false,
        reason: meta?.reason,
        folder_id: meta?.folder_id,
        folder_name: meta?.folder_name,
        folder_url: meta?.folder_url,
        updated_at: meta?.updated_at,
        truncated: meta?.truncated,
        // some folders did not answer: the rows are real, the count is a floor
        partial: meta?.partial === true,
        partial_reason: meta?.partial_reason,
        files,
      }
      // AN ANSWER IS NOT A LISTING.
      const why = !meta
        ? 'the listing carried no folder record'
        : meta.configured !== false && String(meta.reason ?? '').trim()
          ? String(meta.reason).trim()
          : ''
      // a failed answer keeps the last rows that were read, marked as such below
      setDocs((prev) => (why && (prev?.files?.length ?? 0) > 0 ? prev : listing))
      setDocsError(why || null)
      setDocsRead(why ? { state: 'failed', why } : { state: 'ready' })
    } catch (e) {
      const why = reasonOf(e, 'failed to list the technology folder')
      setDocsError(why)
      setDocs((prev) => prev ?? null)
      setDocsRead({ state: 'failed', why })
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const projRows = useMemo(() => projects ?? [], [projects])
  const files = useMemo(
    () => (Array.isArray(docs?.files) ? docs!.files!.filter((f) => f && f.name) : []),
    [docs],
  )
  const meta = useMemo(() => (eng ?? []).find((r) => r.kind === 'meta') ?? null, [eng])
  const openGaps = Number(meta?.open_gaps) || 0

  const figures = useMemo(
    () => technologyFigures({ projects, projectsRead, eng, engRead, listing: docs, docsRead }),
    [projects, projectsRead, eng, engRead, docs, docsRead],
  )
  const anyFailed = projectsRead.state === 'failed' || engRead.state === 'failed' || docsRead.state === 'failed'

  const loading = projects === null

  const TABS: { key: Tab; label: string; Icon: typeof Cpu; tint: ExtendedTintName; badge?: number }[] = [
    { key: 'projects', label: 'Projects', Icon: Rocket, tint: 'blue', badge: projRows.length || undefined },
    { key: 'engineering', label: 'Engineering State', Icon: Activity, tint: 'mint', badge: openGaps || undefined },
    { key: 'documents', label: 'Documents', Icon: FolderOpen, tint: 'lavender', badge: files.length || undefined },
    { key: 'library', label: 'Library', Icon: BookText, tint: 'peach' },
  ]

  return (
    <div className="w-full px-5 py-6">
      {/* ── header: eyebrow + title + description left, actions right (the old platform positions) ── */}
      <PageHeader
        title="Technology Command Center"
        subtitle="The company's automation-project portfolio and the platform's own engineering state — plus every source document, read straight off the Drive folder. Standalone: nothing here depends on the old platform."
        actions={
          <>
            {docs?.folder_url && (
              <a
                href={docs.folder_url}
                target="_blank"
                rel="noreferrer"
                title="Open the technology folder in Drive"
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <FolderOpen size={14} /> Drive folder <ExternalLink size={12} className="text-text-3" />
              </a>
            )}
            <button
              onClick={() => void load()}
              disabled={refreshing}
              title="Reload the portfolio, the assessment and the document list"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {/* ── the black header: this screen's own figures, one per read ── */}
      <TechnologyHero
        figures={figures}
        folderName={docs?.folder_name}
        failed={anyFailed}
        refreshing={refreshing}
        onRetry={() => void load()}
      />

      {/* ── tab bar (underline, the old platform's RH-style row) ── */}
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-border">
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-[12.5px] font-semibold transition-colors',
                active ? 'border-current' : 'border-transparent text-text-3 hover:text-text-1',
                active && TINT_FG[t.tint],
              )}
            >
              <t.Icon size={14} /> {t.label}
              {t.badge ? <span className={cn('ml-0.5 text-[11px] tabular-nums', active ? '' : 'text-text-3')}>{t.badge}</span> : null}
            </button>
          )
        })}
      </div>

      {/* ── content ── */}
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : tab === 'projects' ? (
        <ProjectsPanel projects={projRows} read={projectsRead} onRetry={() => void load()} />
      ) : tab === 'engineering' ? (
        <EngineeringPanel rows={eng ?? []} loading={eng === null} read={engRead} onRetry={() => void load()} />
      ) : tab === 'documents' ? (
        <DocumentsPanel files={files} listing={docs} error={docsError} onRetry={() => void load()} />
      ) : (
        <LibraryPanel files={files} listing={docs} error={docsError} />
      )}
    </div>
  )
}

/* ── small shared chrome ── */
function ErrorBox({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <Card padded={false}>
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-[12.5px] text-text-3">
        <div className="flex items-center gap-2 text-tint-fg-pink"><AlertTriangle size={14} /> {msg}</div>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-2 hover:bg-surface-2"
        >
          <RefreshCw size={12} /> retry
        </button>
      </div>
    </Card>
  )
}

// ROWS FROM A READ THAT DID NOT LAND AGAIN.
function StaleNotice({ what, why }: { what: string; why: string }) {
  return (
    <p className="mb-3 flex items-start gap-2 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12px] leading-[1.5] text-text-1">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-tint-fg-amber" />
      <span>{what} — these are the rows from the last read ({why}).</span>
    </p>
  )
}

/** Some folders of the listing did not answer: every row is real, and the list is a floor. */
function PartialNotice({ why }: { why?: string }) {
  return (
    <p className="mb-3 flex items-start gap-2 rounded-md border border-tint-amber bg-tint-amber px-3 py-2 text-[12px] leading-[1.5] text-text-1">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-tint-fg-amber" />
      <span>
        Part of the technology folder could not be listed ({why || 'some folder listings failed'})
        — every file here is real, and the folder holds more than this list.
      </span>
    </p>
  )
}

/* ═══════════════════════════ projects portfolio ═══════════════════════════ */
function ProjectsPanel({ projects, read, onRetry }: {
  projects: TechProject[]; read: TechRead; onRetry: () => void
}) {
  // a read that refused is not an empty portfolio — say which one it is
  if (read.state === 'failed' && projects.length === 0) {
    return <ErrorBox msg={`the portfolio could not be read — ${read.why}`} onRetry={onRetry} />
  }
  const stale = read.state === 'failed'
    ? <StaleNotice what="the portfolio could not be read again" why={read.why} />
    : null
  if (projects.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState
          title="No projects on the portfolio"
          body="The techProjects slice reads the relay's own Drive listing and its project tables. Once the sweep has walked the technology folder, every project shows up here with its live file stats."
        />
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {stale}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-text-3">
          Statuses save straight into the shared tables (admins and managers). The list re-reads them every few minutes.
        </p>
        <AddProjectButton />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {projects.map((p) => <ProjectCard key={p.id || p.name} p={p} />)}
      </div>
    </div>
  )
}

// Hand-add a tracked project — the old platform's add-manual lane, same table.
function AddProjectButton() {
  const role = useAuthStore((s) => s.user?.role ?? '')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [categoryText, setCategoryText] = useState('')
  const [blurb, setBlurb] = useState('')
  const [busy, setBusy] = useState(false)
  if (role !== 'admin' && role !== 'manager') return null
  const save = async () => {
    if (name.trim().length < 3) {
      toast({ type: 'warning', title: 'Name it first', body: 'Three characters or more.' })
      return
    }
    setBusy(true)
    try {
      await erpLane('/hub-lanes/tech-manual',
        { op: 'add', name: name.trim(), category: categoryText.trim(), blurb: blurb.trim() })
      setOpen(false); setName(''); setCategoryText(''); setBlurb('')
      toast({ type: 'success', title: 'Project tracked',
        body: 'It appears in the list on the next data refresh (a few minutes).' })
    } catch (err) {
      toast({ type: 'danger', title: 'Not added', body: err instanceof Error ? err.message : 'Try again.' })
    } finally { setBusy(false) }
  }
  return (
    <div className="shrink-0">
      {!open ? (
        <button onClick={() => setOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
          <Plus size={13} /> Add project
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name"
            className="h-8 w-40 rounded-md border border-border bg-surface-2 px-2.5 text-[12.5px] text-text-1 outline-none focus:border-primary" />
          <input value={categoryText} onChange={(e) => setCategoryText(e.target.value)} placeholder="Category"
            className="h-8 w-28 rounded-md border border-border bg-surface-2 px-2.5 text-[12.5px] text-text-1 outline-none focus:border-primary" />
          <input value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="One line on what it is"
            className="h-8 w-52 rounded-md border border-border bg-surface-2 px-2.5 text-[12.5px] text-text-1 outline-none focus:border-primary" />
          <button onClick={() => void save()} disabled={busy}
            className="h-8 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-on-primary disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setOpen(false)} className="h-8 rounded-md px-2 text-[12.5px] text-text-3 hover:text-text-1">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// The pill for readers; a SELECT for admins and managers — the old platform's own dropdown, writing the same…
function StatusControl({ p, tint }: { p: TechProject; tint: ExtendedTintName }) {
  const role = useAuthStore((s) => s.user?.role ?? '')
  const [value, setValue] = useState(projLabel(p.status))
  const [busy, setBusy] = useState(false)
  if (role !== 'admin' && role !== 'manager') {
    return (
      <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em]', TINT_BG[tint], TINT_FG[tint])}>
        {projLabel(p.status)}
      </span>
    )
  }
  const set = async (next: string) => {
    const before = value
    setValue(next)
    setBusy(true)
    try {
      await erpLane('/hub-lanes/tech-status', { name: p.name, status: next })
    } catch (err) {
      setValue(before)
      toast({ type: 'danger', title: 'Status not saved', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <select
      value={TECH_STATUSES.includes(value as typeof TECH_STATUSES[number]) ? value : 'Not started'}
      onChange={(e) => void set(e.target.value)}
      disabled={busy}
      aria-label={`Status of ${p.name}`}
      className={cn('h-7 shrink-0 rounded-md border border-border bg-surface-2 px-2 text-[11px] font-semibold text-text-1 outline-none focus:border-primary disabled:opacity-60')}
    >
      {TECH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

/** Remove a HAND-ADDED project (assessed ones are the survey's, not ours). */
function ManualDelete({ name }: { name: string }) {
  const role = useAuthStore((s) => s.user?.role ?? '')
  const [busy, setBusy] = useState(false)
  if (role !== 'admin' && role !== 'manager') return null
  const remove = async () => {
    const ok = await askConfirm({
      title: 'Stop tracking this project?',
      body: `"${name}" leaves the hand-tracked list for everyone. Assessed projects are unaffected.`,
      confirmLabel: 'Remove', tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      await erpLane('/hub-lanes/tech-manual', { op: 'delete', name })
      toast({ type: 'success', title: 'Removed', body: 'Gone from the list on the next data refresh.' })
    } catch (err) {
      toast({ type: 'danger', title: 'Not removed', body: err instanceof Error ? err.message : 'Try again.' })
    } finally { setBusy(false) }
  }
  return (
    <button onClick={() => void remove()} disabled={busy} aria-label={`Remove ${name}`}
      className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:text-danger disabled:opacity-50">
      <Minus size={13} />
    </button>
  )
}

function ProjectCard({ p }: { p: TechProject }) {
  const tint = projTint(p.status)
  const strengths = splitJoined(p.strengths)
  const gaps = splitJoined(p.gaps)
  const archived = (p.status || '').toLowerCase() === 'archived'
  const platform = p.platform === 'yes'
  const manual = p.manual === 'yes'
  const live = p.live === 'yes'
  const assessed = p.assessed === 'yes'
  return (
    <Card
      padded={false}
      className={cn('flex flex-col gap-3 border-l-2 p-5', archived && 'opacity-65')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <Rocket size={16} className={cn('mt-0.5 shrink-0', TINT_FG[tint])} />
          <div className="min-w-0">
            {/* the project's NAME is a tracker handle, like every person's */}
            <DragPerson
              name={p.name || ''}
              id={p.id}
              type="project"
              subtitle={p.category || 'Automation project'}
              className="block min-w-0"
            >
              <div className="clamp-1 text-[15px] font-bold text-text-1" title={`Drag ${p.name} to the tracker to focus on this project`}>{p.name}</div>
            </DragPerson>
            {p.category && <div className="text-[11px] text-text-3">{p.category}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {manual && <ManualDelete name={p.name || ''} />}
          <StatusControl p={p} tint={tint} />
        </div>
      </div>
      {p.blurb && <p className="text-[13px] leading-relaxed text-text-2">{p.blurb}</p>}
      {(strengths.length > 0 || gaps.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div>
              <div className={cn('mb-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em]', TINT_FG.mint)}>
                <Plus size={11} /> Strengths
              </div>
              {strengths.map((s, i) => (
                <div key={i} className="mb-1 flex items-start gap-2">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', TINT_BG.mint)} />
                  <span className="text-[12px] leading-snug text-text-2">{s}</span>
                </div>
              ))}
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <div className={cn('mb-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em]', TINT_FG.amber)}>
                <Minus size={11} /> Gaps
              </div>
              {gaps.map((g, i) => (
                <div key={i} className="mb-1 flex items-start gap-2">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', TINT_BG.amber)} />
                  <span className="text-[12px] leading-snug text-text-2">{g}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-border pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
        {platform
          ? <span className="inline-flex items-center gap-1"><Activity size={11} /> see Engineering State</span>
          : <span className="inline-flex items-center gap-1"><FolderOpen size={11} /> {p.file_count ?? 0} files</span>}
        {manual && <span className={TINT_FG.blue}>· manual</span>}
        {!assessed && !manual && <span className={TINT_FG.amber}>· unassessed</span>}
        {!platform && !manual && !live && <span>· baked</span>}
        {p.status_source === 'user' && <span className={TINT_FG[tint]}>· status set</span>}
      </div>
    </Card>
  )
}

/* ═══════════════════════════ engineering state ═══════════════════════════ */
function EngineeringPanel({ rows, loading, read, onRetry }: {
  rows: TechEngRow[]; loading: boolean; read: TechRead; onRetry: () => void
}) {
  if (loading) {
    return <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
  }
  if (read.state === 'failed' && rows.length === 0) {
    return <ErrorBox msg={`the engineering assessment could not be read — ${read.why}`} onRetry={onRetry} />
  }
  const meta = rows.find((r) => r.kind === 'meta')
  if (!meta) {
    return (
      <Card padded={false}>
        <EmptyState title="No assessment available" body="The techEngineering slice carries the platform's dated self-assessment." />
      </Card>
    )
  }
  const figures = rows.filter((r) => r.kind === 'figure')
  const strengths = rows.filter((r) => r.kind === 'strength')
  const issues = rows.filter((r) => r.kind === 'issue')
  return (
    <div className="flex flex-col gap-5">
      {read.state === 'failed' && (
        <StaleNotice what="the engineering assessment could not be read again" why={read.why} />
      )}
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
        <span className={cn('inline-flex items-center gap-1.5', TINT_FG.blue)}>
          <ShieldCheck size={12} /> deep audit {meta.audit_date || '—'}
        </span>
        {meta.verified_date && (
          <span className={cn('inline-flex items-center gap-1.5', TINT_FG.mint)}>
            <CheckCircle2 size={12} /> verified {meta.verified_date}
          </span>
        )}
        {meta.version && <span>assessment {meta.version}</span>}
      </div>

      {meta.state && (
        <Card padded={false} className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <Activity size={14} className={TINT_FG.mint} />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-3">State of the platform</span>
          </div>
          <p className="text-[15px] leading-relaxed text-text-1">{meta.state}</p>
        </Card>
      )}

      {figures.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {figures.map((f) => (
            <Card key={f.id} padded={false} className="p-4">
              <div className={cn('text-xl font-bold tabular-nums', TINT_FG.mint)}>{f.value || '—'}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2">{f.label}</div>
              {f.hint && <div className="mt-0.5 text-[10px] text-text-3">{f.hint}</div>}
            </Card>
          ))}
        </div>
      )}

      {strengths.length > 0 && (
        <section>
          <h2 className={cn('mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em]', TINT_FG.mint)}>
            <ShieldCheck size={14} /> Strengths
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {strengths.map((s) => (
              <Card key={s.id} padded={false} className="border-l-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-text-1">{s.title}</span>
                  {s.section && <span className="shrink-0 text-[10px] text-text-3">{s.section}</span>}
                </div>
                {s.detail && <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">{s.detail}</p>}
              </Card>
            ))}
          </div>
        </section>
      )}

      {issues.length > 0 && (
        <section>
          <h2 className={cn('mb-3 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em]', TINT_FG.amber)}>
            <AlertTriangle size={14} /> Issues &amp; Development Gaps
          </h2>
          <Card padded={false}>
            {issues.map((it, i) => <IssueRow key={it.id} it={it} first={i === 0} />)}
          </Card>
        </section>
      )}

      {meta.recently_fixed && (
        <Card padded={false} className="border-l-2 p-4">
          <div className={cn('mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]', TINT_FG.mint)}>
            <CheckCircle2 size={13} /> Recently fixed (live)
          </div>
          <p className="text-[12px] leading-relaxed text-text-2">{meta.recently_fixed}</p>
        </Card>
      )}
    </div>
  )
}

function IssueRow({ it, first }: { it: TechEngRow; first: boolean }) {
  const sev = (it.severity || '—').toUpperCase()
  const sTint = SEV_TINT[sev] ?? 'info'
  const sm = ISSUE_STATUS[(it.status || 'open').toLowerCase()] ?? ISSUE_STATUS.open
  return (
    <div className={cn('flex items-start gap-4 px-4 py-3.5', !first && 'border-t border-border')}>
      <span className={cn('mt-0.5 shrink-0 rounded px-2 py-1 text-[10px] font-bold tracking-wider', TINT_BG[sTint], TINT_FG[sTint])}>{sev}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text-1">{it.title}</span>
          {it.area && <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{it.area}</span>}
        </div>
        {it.detail && <p className="mt-1 text-[13px] leading-relaxed text-text-2">{it.detail}</p>}
        {it.evidence && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-text-3">
            <FileText size={11} /> {it.evidence}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em]', TINT_BG[sm.tint], TINT_FG[sm.tint])}>
          <sm.Icon size={11} /> {sm.label}
        </span>
        <span className={cn('text-[9px] font-semibold uppercase tracking-[0.08em]', it.verified === 'yes' ? TINT_FG.mint : 'text-text-3')}>
          {it.verified === 'yes' ? 'verified today' : 'from audit'}
        </span>
      </div>
    </div>
  )
}

/* ═══════════════════════════ documents (flat folder list) ═══════════════════════════ */
function DocumentsPanel({ files, listing, error, onRetry }: {
  files: TechDoc[]; listing: TechDocsListing | null; error: string | null; onRetry: () => void
}) {
  // a failed listing is never "no documents yet" — say which read refused
  if (error && !files.length) return <ErrorBox msg={`could not list the technology folder — ${error}`} onRetry={onRetry} />
  if (listing && listing.configured === false) {
    return (
      <Card padded={false}>
        <EmptyState
          title="Technology folder not configured"
          body={listing.reason || 'Set the TECH_DOCS_FOLDER_ID property to the technology Drive folder id.'}
        />
      </Card>
    )
  }
  if (!listing) {
    return <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>
  }
  if (!files.length) {
    return (
      <Card padded={false}>
        <EmptyState
          title="No documents yet"
          body="The technology Drive folder is empty from where the platform stands — share it with the platform account and every file appears here."
        />
      </Card>
    )
  }
  const totalSize = files.reduce((s, f) => s + (Number(f.size_bytes) || 0), 0)
  const sorted = [...files].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return (
    <div>
      {error && <StaleNotice what="the technology folder could not be listed again" why={error} />}
      {!error && listing.partial && <PartialNotice why={listing.partial_reason} />}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
        <span className={cn('inline-flex items-center gap-1.5', TINT_FG.lavender)}>
          <FolderOpen size={12} /> {listing.partial ? 'at least ' : ''}{files.length} file{files.length === 1 ? '' : 's'}
        </span>
        {totalSize > 0 && <span>· {fmtSize(totalSize)}</span>}
        {listing.updated_at && <span>· listed {fmtDate(listing.updated_at)}</span>}
        {listing.truncated && <span className={TINT_FG.amber}>· truncated — the folder holds more than this list</span>}
      </div>
      <Card padded={false}>
        {sorted.map((f, i) => {
          const view = safeHref(f.web_view_link)
          const size = fmtSize(f.size_bytes)
          const badge = KIND_BADGE[kindOf(f)] ?? KIND_BADGE.file
          return (
            <div key={f.id || `${f.name}-${i}`} className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2', i > 0 && 'border-t border-border')}>
              <span className={cn('flex h-[30px] w-[26px] shrink-0 items-center justify-center rounded text-[9px] font-bold text-white', TINT_BG[badge.tint], TINT_FG[badge.tint])}>
                {badge.label}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-1" title={f.rel || f.name || ''}>{f.name || `File ${i + 1}`}</span>
                <span className="block truncate text-[11px] text-text-3">
                  {[f.category, f.case].filter(Boolean).join(' › ')}{size ? `${f.category || f.case ? ' · ' : ''}${size}` : ''}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {f.kept && (
                  <button
                    type="button"
                    onClick={() => downloadKept(f)}
                    className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-2 transition-colors hover:bg-surface-2"
                    title="Download the server's copy"
                    aria-label={`Download ${f.name || 'document'}`}
                  >
                    <Download size={11} />
                  </button>
                )}
                {view ? (
                  <a
                    href={view}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-2 no-underline transition-colors hover:bg-surface-2"
                    title="Open in Drive"
                  >
                    Drive <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="text-[10px] uppercase tracking-[0.06em] text-text-3">no link</span>
                )}
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

/* ═══════════════════════════ library (the old platform's reading room) ═══════════════════════════ */
function LibraryPanel({ files, listing, error }: {
  files: TechDoc[]; listing: TechDocsListing | null; error: string | null
}) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openCases, setOpenCases] = useState<Set<string>>(new Set())

  /* categories derived from the data, sorted by document count (desc) — the old platform's rule */
  const categories = useMemo(() => {
    const by = new Map<string, number>()
    for (const f of files) {
      const k = f.category || '(root)'
      by.set(k, (by.get(k) || 0) + 1)
    }
    return [...by.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [files])

  /* default to ALL projects once data lands (the old platform's own fix) */
  useEffect(() => {
    if (cat || categories.length === 0) return
    setCat(ALL)
  }, [categories, cat])

  const searching = query.trim().length > 0
  const crossCat = searching || cat === ALL || cat === null

  const railFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (q) return (`${f.category || ''} ${f.case || ''} ${f.trail || ''} ${f.name || ''}`).toLowerCase().includes(q)
      if (cat === ALL || cat === null) return true
      return f.category === cat
    })
  }, [files, cat, query])

  const cases = useMemo(() => {
    const by = new Map<string, TechDoc[]>()
    for (const f of railFiles) {
      const k = crossCat ? `${f.category || '(root)'} › ${f.case || '—'}` : (f.case || '(root)')
      if (!by.has(k)) by.set(k, [])
      by.get(k)!.push(f)
    }
    const arr = [...by.entries()].map(([name, fs]) => ({
      name,
      files: [...fs].sort((a, b) => (a.trail || '').localeCompare(b.trail || '') || docTitle(a.name).localeCompare(docTitle(b.name))),
    }))
    arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [railFiles, crossCat])

  useEffect(() => {
    if (searching) { setOpenCases(new Set(cases.map((c) => c.name))); return }
    setOpenCases(cases.length ? new Set([cases[0].name]) : new Set())
  }, [cases, searching])

  const selected = useMemo(() => files.find((f) => f.id === selectedId) || null, [files, selectedId])
  const frame = previewUrl(selected)
  const open = safeHref(selected?.web_view_link)

  const toggleCase = (name: string) => {
    setOpenCases((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  if (error && !files.length) {
    return (
      <Card padded={false}>
        <EmptyState title="The library could not be listed" body={error} />
      </Card>
    )
  }
  if (listing && listing.configured === false) {
    return (
      <Card padded={false}>
        <EmptyState
          title="Technology folder not configured"
          body={listing.reason || 'Set the TECH_DOCS_FOLDER_ID property to the technology Drive folder id.'}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <StaleNotice what="the technology folder could not be listed again" why={error} />}
      {!error && listing?.partial && <PartialNotice why={listing.partial_reason} />}
      {/* search strip (the old platform header's search box, on the library it serves) */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <Search size={13} className="shrink-0 text-text-3" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all technology docs…"
          className="w-full bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear" className="text-text-3 hover:text-text-1">
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        {/* left rail: category picker + case tree */}
        <aside className="flex flex-col rounded-lg border border-border bg-surface lg:w-[340px] lg:shrink-0">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            {searching ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3">
                {railFiles.length} match{railFiles.length === 1 ? '' : 'es'} across all areas
              </span>
            ) : (
              <>
                <Folder size={13} className="shrink-0 text-text-3" />
                <select
                  value={cat || ALL}
                  onChange={(e) => { setCat(e.target.value); setSelectedId(null) }}
                  className="min-w-0 flex-1 cursor-pointer bg-transparent text-[12px] text-text-1 outline-none"
                >
                  <option value={ALL}>All projects ({files.length})</option>
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.n})</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="max-h-[42vh] min-h-0 flex-1 overflow-y-auto scroll-thin lg:max-h-[70vh]">
            {!listing ? (
              <div className="flex items-center justify-center py-12 text-text-3">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : cases.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-text-3">
                <FileText size={18} />
                <p className="text-[11px]">{searching ? 'No matches.' : 'No documents in this area.'}</p>
              </div>
            ) : (
              cases.map((cs) => {
                const isOpen = openCases.has(cs.name)
                return (
                  <div key={cs.name}>
                    <button
                      type="button"
                      onClick={() => toggleCase(cs.name)}
                      className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                    >
                      {isOpen ? <ChevronDown size={14} className="text-text-3" /> : <ChevronRight size={14} className="text-text-3" />}
                      <Folder size={14} className="text-text-2" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">{cs.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-3">{cs.files.length}</span>
                    </button>
                    {isOpen && cs.files.map((f, i) => {
                      const active = !!selected && selected.id === f.id
                      const badge = KIND_BADGE[kindOf(f)] ?? KIND_BADGE.file
                      const metaLine = [kindOf(f).toUpperCase(), fmtDate(f.modified_time), fmtSize(f.size_bytes), f.trail || ''].filter(Boolean).join(' · ')
                      return (
                        <button
                          key={f.id || `f-${i}`}
                          type="button"
                          onClick={() => f.id && setSelectedId(f.id)}
                          title={f.rel || f.name || ''}
                          className={cn(
                            'flex w-full items-start gap-2.5 border-l-2 py-2 pl-6 pr-3 text-left transition-colors',
                            active ? 'border-l-text-3 bg-surface-2' : 'border-l-transparent hover:bg-surface-2/60',
                          )}
                        >
                          <span className={cn('flex h-[30px] w-[26px] shrink-0 items-center justify-center rounded text-[9px] font-bold', TINT_BG[badge.tint], TINT_FG[badge.tint])}>
                            {badge.label}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('clamp-2 block text-[12px] leading-snug', active ? 'text-text-1' : 'text-text-2')}>{docTitle(f.name)}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-text-3">{metaLine}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* embedded reader — Drive renders the real file */}
        <main className="flex min-h-[420px] min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface">
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <span className={cn('flex h-[34px] w-[30px] shrink-0 items-center justify-center rounded text-[10px] font-bold', TINT_BG[(KIND_BADGE[kindOf(selected)] ?? KIND_BADGE.file).tint], TINT_FG[(KIND_BADGE[kindOf(selected)] ?? KIND_BADGE.file).tint])}>
                  {(KIND_BADGE[kindOf(selected)] ?? KIND_BADGE.file).label}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-text-1">{docTitle(selected.name)}</span>
                  <span className="block truncate text-[10px] text-text-3">
                    {[selected.category, selected.case, selected.trail].filter(Boolean).join(' › ')}
                  </span>
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {selected.kept && (
                    <button
                      type="button"
                      onClick={() => downloadKept(selected)}
                      className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                      title="Download the server's copy"
                    >
                      <Download size={12} /> Download
                    </button>
                  )}
                  {open && (
                    <a
                      href={open}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                    >
                      <ExternalLink size={12} /> Open
                    </a>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1">
                {kindOf(selected) !== 'text' && selected.kept && selected.viewable ? (
                  <KeptDocView file={selected} />
                ) : kindOf(selected) === 'sheet' ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <FileText size={22} className="text-text-3" />
                    <p className="text-[12px] text-text-3">
                      Spreadsheets don't preview in-platform — use Open above to read it in Drive.
                    </p>
                  </div>
                ) : kindOf(selected) === 'text' ? (
                  <TextDocReader file={selected} />
                ) : frame ? (
                  <iframe key={frame} src={frame} title={selected.name || 'technology document'} className="h-[70vh] w-full rounded-b-lg border-0" />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center">
                    <p className="text-[12px] text-text-3">No preview available for this file — Open shows it in Drive.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-text-3">
              <BookText size={26} />
              <p className="text-[12px]">{!listing ? 'Loading technology documents…' : 'Select a document to read it here.'}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
