// ADMINISTRATION — the AdministrationWorkspace of the old platform's app src/components/AdministrationWorkspace.tsx)…
// The layout mirrors the old platform screen element-for-element, on hub tokens: header (PageHeader…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BookOpen, Briefcase, ChevronDown, ChevronRight, Clock,
  Cpu, Download, ExternalLink, FileBarChart2, FileText, FolderOpen,
  HeartPulse, Loader2, PenLine, RefreshCw, ShieldCheck, Sparkles, Trash2, Upload,
} from 'lucide-react'
import { Link } from 'react-router'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import DragPerson from '@/components/shared/DragPerson'
import ProfileGrid from '@/components/shared/ProfileGrid'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { gasAction } from '@/features/hiring/shared'
import { fileToBase64 } from '@/engine/templates/documents/importDoc'
import { mintCortexSession } from '@/components/shell/CortexChat'
import { authHeaders } from '@/lib/snapshotClient'
import { openFile } from '@/stores/useFileViewerStore'
import { askConfirm } from '@/stores/useDialogStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'

/* ── AdminDocs.gs shapes (the Drive half) ── */
interface AdminDocFile {
  id?: string
  name?: string
  mime?: string
  size_bytes?: number
  modified_time?: string
  web_view_link?: string
  /** the server holds the document (Python's listing): it opens and downloads from there, never from Drive */
  kept?: boolean
  /** the server holds a PDF of it (or it is one, or a picture) for the viewer */
  viewable?: boolean
}
interface AdminDocBytes {
  name?: string
  mime?: string
  b64?: string
}
interface AdminDocsListing {
  configured?: boolean
  reason?: string
  folder_id?: string
  folder_name?: string
  folder_url?: string
  updated_at?: string
  files?: AdminDocFile[]
}

// ── hub library / ledger rows (fields as the sheets hold them, with the seeded names as fallback) ──
interface LibraryRow {
  id?: string
  title?: string
  name?: string
  collection?: string
  category?: string
  url?: string
  addedAt?: string
  updatedAt?: string
}
interface AckRow {
  id?: string
  policy?: string
  version?: string
  staff?: string
  status?: string
  signedAt?: string | null
  effectiveDate?: string
}

const REPORT_BUILDS: { label: string; question: string }[] = [
  { label: 'Department overview', question: 'Write an executive overview of the Administration department — its policies, certification requirements, compliance standards and key procedures, based on the administration documents.' },
  { label: 'Certification & ethics', question: 'Summarize the certification requirements and ethics covered in the administration material (e.g. the G-J tube / feeding curriculum).' },
  { label: 'Compliance & regulations', question: 'Produce a compliance report: the key regulations and standards (e.g. Ohio Administrative Code) the administration documents reference, and what each requires.' },
  { label: 'Policies & SOPs', question: 'Summarize the operational policies and standard operating procedures documented for administration.' },
  { label: 'Key documents digest', question: 'Give a digest of the most important administration documents and what each one covers.' },
]

// A document is often NAMED for its person — a client book, a staff record.
function personName(s: string): string {
  return s.replace(/\.[A-Za-z0-9]{1,6}$/, '').trim()
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}

function safeHref(url?: string): string | null {
  const u = (url || '').trim()
  if (!u) return null
  if (/^https?:/i.test(u)) return u
  if (u.startsWith('/')) return u
  return `https://${u}`
}

function docKind(mime?: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf')) return 'PDF'
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return 'Sheet'
  if (m.includes('presentation') || m.includes('powerpoint')) return 'Slides'
  if (m.includes('document') || m.includes('msword')) return 'Doc'
  if (m.includes('image')) return 'Image'
  return 'File'
}

function isGoogleNative(mime?: string): boolean {
  const m = (mime || '').toLowerCase()
  return m.includes('application/vnd.google-apps.document')
    || m.includes('application/vnd.google-apps.spreadsheet')
    || m.includes('application/vnd.google-apps.presentation')
}

function drivePreview(f: AdminDocFile): string | null {
  if (f.kept) return null
  if (f.id) return `https://drive.google.com/file/d/${f.id}/preview`
  return safeHref(f.web_view_link)
}

/** A document the server keeps, as a blob of its PDF (`view`) or of the document itself (`original`). */
async function keptBlob(f: AdminDocFile, as: 'view' | 'original'): Promise<{ url: string; name: string }> {
  const got = await gasAction<AdminDocBytes>('adminDocFile', { file_id: f.id, as }, { timeoutMs: 120000 })
  const raw = atob(got?.b64 || '')
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const blob = new Blob([bytes], { type: got?.mime || 'application/octet-stream' })
  return { url: URL.createObjectURL(blob), name: got?.name || f.name || 'document' }
}

/** the old platform downloadFile(): native Docs open in Drive, binaries download direct; a kept one from the server. */
function downloadFile(f: AdminDocFile) {
  if (f.kept && f.id) {
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
      .catch((e) => toast({ type: 'danger', title: 'Not downloaded',
        body: `The document could not be downloaded: ${e instanceof Error ? e.message : String(e)}` }))
    return
  }
  if (!f.id) { const v = safeHref(f.web_view_link); if (v) window.open(v, '_blank'); return }
  if (isGoogleNative(f.mime)) { const v = safeHref(f.web_view_link); if (v) window.open(v, '_blank'); return }
  window.open(`https://drive.google.com/uc?export=download&id=${f.id}`, '_blank')
}

type CenterMode = 'overview' | 'report' | 'doc'

// ── the cortex connection's private helpers (Guardian keeps its own copies; finalized screens are not…
type CortexRow = Record<string, any>

const cortexNum = (...vals: any[]): number | null => {
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}
const cortexAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`
  return `${(ms / 86_400_000).toFixed(1)}d ago`
}
/** fleet rows stamp created_at in EPOCH SECONDS — fmtDate on it prints garbage */
const cortexEpochAgo = (v: any): string => {
  const n = cortexNum(v)
  return n === null ? 'never' : cortexAgo(new Date(n * 1000).toISOString())
}
const cortexSweepLine = (row: CortexRow): string => {
  let d: any = row?.detail
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = null } }
  if (d && typeof d === 'object') {
    const down = cortexNum(d.services_down, d.servicesDown, d.down, d.down_count)
    if (down !== null) return `${down} service(s) down`
  }
  return String(row?.title ?? 'fleet sweep')
}

export default function AdministrationPage() {
  const token = useAuthStore((s) => s.token)
  // The two cortex doors are admin-only on the relay — a manager reaching them gets a guaranteed 403, so neither…
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')

  /* the Drive folder browser */
  const [listing, setListing] = useState<AdminDocsListing | null>(null)
  const [filesLoading, setFilesLoading] = useState(true)
  const [filesError, setFilesError] = useState<string | null>(null)

  /* the hub's library + the signature ledger */
  const [library, setLibrary] = useState<LibraryRow[] | null>(null)
  const [acks, setAcks] = useState<AckRow[] | null>(null)

  /* the work area */
  const [mode, setMode] = useState<CenterMode>('overview')
  const [activeDoc, setActiveDoc] = useState<AdminDocFile | null>(null)
  const [activeBuild, setActiveBuild] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyMsg, setBusyMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<string>(mintCortexSession())

  const loadFiles = useCallback(async (background: boolean) => {
    if (!background) setFilesLoading(true)
    try {
      const r = await gasAction<AdminDocsListing>('adminDocsList')
      setListing(r && typeof r === 'object' ? r : { configured: false, files: [] })
      setFilesError(null)
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'failed to load the folder')
    } finally {
      if (!background) setFilesLoading(false)
    }
  }, [])

  const loadLibrary = useCallback(async () => {
    try {
      const r = await api.list<LibraryRow>('documents')
      setLibrary(Array.isArray(r) ? r : [])
    } catch {
      setLibrary((prev) => prev ?? [])
    }
  }, [])

  const loadAcks = useCallback(async () => {
    try {
      const r = await api.list<AckRow>('policyAcks')
      setAcks(Array.isArray(r) ? r : [])
    } catch {
      setAcks((prev) => prev ?? [])
    }
  }, [])

  // ── the cortex connection — the same two admin-gated relay doors the Guardian reads, with the Guardian's own…
  const [cortexHealth, setCortexHealth] = useState<CortexRow | null>(null)
  const [cortexHealthErr, setCortexHealthErr] = useState('')
  const [cortexFleet, setCortexFleet] = useState<CortexRow[] | null>(null)
  const [cortexFleetErr, setCortexFleetErr] = useState('')
  const loadCortex = useCallback(async () => {
    if (!isAdmin) return
    try {
      const r = await fetch('/cortex/health', { cache: 'no-store', headers: authHeaders() })
      const body = (await r.json().catch(() => null)) as CortexRow | null
      if (!r.ok) {
        const msg = String(body?.message ?? `HTTP ${r.status}`)
        setCortexHealth(null)
        setCortexHealthErr(/did not answer/i.test(msg) ? `unreachable — ${msg}` : msg)
      } else {
        setCortexHealth(body)
        setCortexHealthErr('')
      }
    } catch (e) {
      setCortexHealth(null)
      setCortexHealthErr(`unreachable — ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const r = await fetch('/cortex/fleet', { cache: 'no-store', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = (await r.json()) as CortexRow
      setCortexFleet(Array.isArray(body?.rows) ? (body.rows as CortexRow[]) : [])
      setCortexFleetErr('')
    } catch (e) {
      setCortexFleet(null)
      setCortexFleetErr(e instanceof Error ? e.message : String(e))
    }
  }, [isAdmin])

  useEffect(() => {
    void loadFiles(false); void loadLibrary(); void loadAcks(); void loadCortex()
  }, [loadFiles, loadLibrary, loadAcks, loadCortex])

  const files = useMemo(
    () => (Array.isArray(listing?.files) ? listing!.files!.filter((f) => f && f.name) : []),
    [listing],
  )
  const totalBytes = useMemo(() => files.reduce((s, f) => s + (f.size_bytes || 0), 0), [files])
  const updated = listing?.updated_at ? fmtDate(listing.updated_at) : ''

  /* ── the cortex ask box — the same call the Cortex app makes ── */
  const generate = useCallback(async (question: string, label?: string) => {
    const q = question.trim()
    if (!q || asking) return
    if (!token) { setAskError('Sign in first.'); return }
    setMode('report'); setActiveBuild(label || null)
    setAsking(true); setAskError(null); setAnswer('')
    try {
      const res = await fetch('/cortex/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: q, session_id: sessionRef.current }),
      })
      if (!res.ok || !res.body) {
        let note = `The cortex did not answer (${res.status}).`
        try {
          const j = await res.json()
          if (j?.message) note = String(j.message)
        } catch { /* the status alone is the answer */ }
        throw new Error(note)
      }
      // the Cortex app's SSE reader, verbatim: token/delta frames accumulate, a whole-answer frame fills a turn…
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          let event = ''
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          let payload: Record<string, unknown> = {}
          try { payload = JSON.parse(data) } catch { /* a frame we cannot read is a frame we skip */ }
          if (event === 'token' || event === 'delta') {
            const piece = String(payload.delta ?? payload.text ?? payload.content ?? '')
            if (piece) { text += piece; setAnswer(text) }
          } else if (event === 'complete' || event === 'response') {
            const whole = String(payload.response ?? '')
            if (whole && !text) { text = whole; setAnswer(whole) }
          } else if (event === 'error') {
            throw new Error(String(payload.message ?? 'The cortex reported an error.'))
          }
        }
      }
      if (!text) setAnswer('The cortex answered with silence — try rephrasing.')
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'failed to generate')
    } finally {
      setAsking(false)
    }
  }, [asking, token])

  /* ── selection / import / export / delete ── */
  const toggleSelect = useCallback((id?: string) => {
    if (!id) return
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const selectedFiles = useMemo(() => files.filter((f) => f.id && selected.has(f.id)), [files, selected])

  const doImport = useCallback(() => fileInputRef.current?.click(), [])
  const onFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      setBusyMsg('The file is over 25MB.'); window.setTimeout(() => setBusyMsg(null), 4000); return
    }
    setBusyMsg(`Uploading "${file.name}" to Drive…`)
    try {
      await gasAction('adminDocUpload', {
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      })
      setBusyMsg('Uploaded.')
      toast({ type: 'success', title: 'Uploaded', body: `${file.name} is in the Administration folder.` })
      void loadFiles(true)
      window.setTimeout(() => setBusyMsg(null), 3000)
    } catch (err) {
      setBusyMsg(err instanceof Error ? `Upload failed — ${err.message}` : 'Upload failed.')
      window.setTimeout(() => setBusyMsg(null), 5000)
    }
  }, [loadFiles])

  const doExport = useCallback(() => {
    if (selected.size === 0) {
      if (mode === 'doc' && activeDoc) { downloadFile(activeDoc); return }
      setBusyMsg('Select items to export, or open a document first.')
      window.setTimeout(() => setBusyMsg(null), 3500)
      return
    }
    selectedFiles.forEach((f, i) => window.setTimeout(() => downloadFile(f), i * 350))
    setBusyMsg(`Downloading ${selectedFiles.length} item${selectedFiles.length === 1 ? '' : 's'}…`)
    window.setTimeout(() => setBusyMsg(null), 3000)
  }, [selected, mode, activeDoc, selectedFiles])

  // confirm-forced on the client; the server gates the role and the folder.
  const doDelete = useCallback(async (f: AdminDocFile) => {
    if (!f.id) return
    const name = f.name || 'this file'
    const ok = await askConfirm({
      title: `Move "${name}" to the trash?`,
      body: "It stays recoverable from Drive's trash for 30 days.",
      tone: 'danger',
      confirmLabel: 'Move to trash',
    })
    if (!ok) return
    setBusyMsg(`Trashing "${name}"…`)
    try {
      await gasAction('adminDocDelete', { file_id: f.id })
      setSelected((prev) => { const n = new Set(prev); n.delete(f.id!); return n })
      if (activeDoc?.id === f.id) { setActiveDoc(null); setMode('overview') }
      setBusyMsg('Moved to trash.')
      void loadFiles(true)
      window.setTimeout(() => setBusyMsg(null), 3000)
    } catch (err) {
      setBusyMsg(err instanceof Error ? `Delete failed — ${err.message}` : 'Delete failed.')
      window.setTimeout(() => setBusyMsg(null), 5000)
    }
  }, [activeDoc, loadFiles])

  const showOverview = useCallback(() => { setMode('overview'); setActiveBuild(null); setActiveDoc(null) }, [])
  const openDoc = useCallback((f: AdminDocFile) => { setActiveDoc(f); setMode('doc') }, [])

  return (
    <div className="w-full px-5 py-6">
      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void onFilePicked(e)} />

      {/* ── header (the old platform: eyebrow + title + description, actions right) ── */}
      <PageHeader
        title="Administration"
        subtitle="The Administration document corpus — the Drive folder, the hub library, the policy signatures and the cortex, one desk. New files dropped into the folder are picked up on the next refresh."
        actions={
          <>
            <button
              onClick={doImport}
              title="Upload a file into the Administration Drive folder"
              className={cn('flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold transition-colors', TINT_BG.mint, TINT_FG.mint)}
            >
              <Upload size={14} /> Import
            </button>
            <button
              onClick={doExport}
              title="Download the selected items (or the open document)"
              className={cn('flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold transition-colors', TINT_BG.amber, TINT_FG.amber)}
            >
              <Download size={14} /> Export{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <button
              onClick={() => { void loadFiles(false); void loadLibrary(); void loadAcks(); void loadCortex() }}
              disabled={filesLoading}
              title="Reload the folder, the library, the ledger and the cortex"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {filesLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {filesLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {/* analysis | work area | Drive folder; below 2xl the folder stacks under analysis */}
      <ProfileGrid
        className="gap-x-5 lg:grid-cols-[minmax(0,min(260px,38%))_minmax(0,1fr)] 2xl:grid-cols-[minmax(180px,220px)_minmax(0,1fr)_minmax(240px,300px)]"
        slotClassName="flex flex-col gap-3"
        head={
          <>
            <div className="flex items-center gap-2">
              <FileBarChart2 size={13} className={TINT_FG.lavender} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-1">Analysis</span>
            </div>
            <Card padded={false}>
              <button
                onClick={showOverview}
                className={cn(
                  'flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2',
                  mode === 'overview' && 'border-l-2 border-l-current bg-surface-2',
                )}
              >
                <Sparkles size={13} className={cn('shrink-0', mode === 'overview' ? TINT_FG.lavender : 'text-text-3')} />
                <span className={cn('text-[13px]', mode === 'overview' ? 'text-text-1' : 'text-text-2')}>Folder overview</span>
              </button>
              <div className="border-t border-border px-3.5 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-3">Report builds</span>
              </div>
              {REPORT_BUILDS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => { setPrompt(t.question); void generate(t.question, t.label) }}
                  disabled={asking}
                  className={cn(
                    'flex w-full items-center gap-2 border-t border-border px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60',
                    activeBuild === t.label && mode === 'report' && 'border-l-2 border-l-current bg-surface-2',
                  )}
                >
                  <FileBarChart2 size={12} className={cn('shrink-0', activeBuild === t.label && mode === 'report' ? TINT_FG.lavender : 'text-text-3')} />
                  <span className={cn('text-[13px] leading-snug', activeBuild === t.label && mode === 'report' ? 'text-text-1' : 'text-text-2')}>{t.label}</span>
                </button>
              ))}
            </Card>
            <Card>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="Ask the cortex about the administration data…"
                className="w-full resize-none bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3"
              />
              <button
                onClick={() => void generate(prompt)}
                disabled={asking || !prompt.trim()}
                className={cn('mt-2 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] disabled:opacity-50', TINT_FG.lavender)}
              >
                {asking ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Generate
              </button>
            </Card>
          </>
        }
        rail={
          <>
            <FolderPanel
              items={files}
              listing={listing}
              loading={filesLoading}
              error={filesError}
              onRetry={() => void loadFiles(false)}
              onOpenDoc={openDoc}
              onDelete={(f) => void doDelete(f)}
              selected={selected}
              onSelect={toggleSelect}
            />
            {listing?.folder_url && (
              <a
                href={listing.folder_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3 no-underline hover:text-text-1"
              >
                <ExternalLink size={10} /> Open the folder in Drive
              </a>
            )}
            {updated && (
              <div className="px-1 text-[11px] uppercase tracking-[0.1em] text-text-3">
                <Clock size={10} className="mr-1.5 inline" /> Updated {updated}
              </div>
            )}
          </>
        }
        story={
          <>
            <div className="flex flex-wrap items-center gap-2">
              {busyMsg && <span className="text-[11px] uppercase tracking-[0.1em] text-text-3">{busyMsg}</span>}
              {mode !== 'overview' && (
                <button
                  onClick={showOverview}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-2 transition-colors hover:bg-surface-2"
                >
                  ← Overview
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {mode === 'overview' && <FolderOpen size={14} className={TINT_FG.lavender} />}
              {mode === 'report' && <FileBarChart2 size={14} className={TINT_FG.lavender} />}
              {mode === 'doc' && (isGoogleNative(activeDoc?.mime)
                ? <PenLine size={14} className={TINT_FG.amber} />
                : <FileText size={14} className={TINT_FG.amber} />)}
              <span className="truncate text-[12px] font-semibold uppercase tracking-[0.18em] text-text-1">
                {mode === 'overview' ? 'Folder overview' : mode === 'report' ? (activeBuild || 'Cortex answer') : (activeDoc?.name || 'Document')}
              </span>
            </div>

            {mode === 'doc' && activeDoc ? (
              <DocCenter file={activeDoc} />
            ) : mode === 'report' ? (
              <ReportCenter answer={answer} loading={asking} error={askError} />
            ) : (
              <OverviewCenter
                listing={listing}
                files={files}
                totalBytes={totalBytes}
                loading={filesLoading}
                error={filesError}
                onRetry={() => void loadFiles(false)}
              />
            )}
          </>
        }
      />

      {/* ── CORTEX CONNECTION — the desk's own line to the neural cortex,
          through the two admin-gated relay doors the Guardian reads. A 200
          is not a pulse: only the cortex's own status:'healthy' reads ok,
          and no answer yet is unknown, never green. ── */}
      {isAdmin && (() => {
        const state: 'ok' | 'warn' | 'fail' | 'unknown' = cortexHealthErr
          ? (/^unreachable/i.test(cortexHealthErr) ? 'fail' : 'warn')
          : !cortexHealth ? 'unknown'
          : String(cortexHealth.status ?? '') === 'healthy' ? 'ok'
          : String(cortexHealth.status ?? '') === 'degraded' ? 'warn'
          : 'unknown'
        const stateWord = state === 'ok' ? 'connected' : state === 'warn' ? 'degraded' : state === 'fail' ? 'unreachable' : 'checking…'
        const stateCls = state === 'ok' ? TINT_FG.mint : state === 'warn' ? TINT_FG.amber : state === 'fail' ? TINT_FG.danger : 'text-text-3'
        const providers = cortexNum(cortexHealth?.providers, cortexHealth?.providers?.configured, cortexHealth?.providers?.count, cortexHealth?.providers?.total)
        const keys = cortexNum(cortexHealth?.total_keys)
        const sheetsLive = cortexNum(cortexHealth?.sheets?.live, cortexHealth?.sheets_live)
        const sheetsDisabled = cortexNum(cortexHealth?.sheets?.disabled, cortexHealth?.sheets_disabled)
        const dash = (n: number | null, suffix = '') => (n === null ? '—' : `${n}${suffix}`)
        return (
          <section className="mt-8">
            <div className="mb-3 flex items-center gap-2">
              <HeartPulse size={14} className={TINT_FG.lavender} />
              <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-1">Cortex connection</span>
              <span className={cn('text-[11px] font-semibold uppercase tracking-[0.1em]', stateCls)}>{stateWord}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">Live health</p>
                {cortexHealthErr ? (
                  <p className={cn('text-[12.5px] leading-5', state === 'fail' ? TINT_FG.danger : TINT_FG.amber)}>
                    {cortexHealthErr}
                  </p>
                ) : !cortexHealth ? (
                  <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Asking the cortex…</p>
                ) : (
                  <dl className="space-y-1.5 text-[12.5px]">
                    <div className="flex justify-between"><dt className="text-text-2">Status</dt>
                      <dd className="font-semibold text-text-1">{String(cortexHealth.status ?? '—')}{cortexHealth.version ? ` · v${cortexHealth.version}` : ''}</dd></div>
                    <div className="flex justify-between"><dt className="text-text-2">Providers / keys</dt>
                      <dd className="font-semibold text-text-1">{dash(providers)} / {dash(keys)}</dd></div>
                    <div className="flex justify-between"><dt className="text-text-2">Sheets</dt>
                      <dd className={cn('font-semibold', (sheetsDisabled ?? 0) > 0 ? TINT_FG.amber : 'text-text-1')}>
                        {dash(sheetsLive, ' live')}{sheetsDisabled !== null ? ` · ${sheetsDisabled} disabled` : ''}
                      </dd></div>
                    <div className="flex justify-between"><dt className="text-text-2">AI enrich</dt>
                      <dd className="font-semibold text-text-1">{cortexHealth.ai_enrich === undefined ? '—' : cortexHealth.ai_enrich ? 'on' : 'off'}</dd></div>
                  </dl>
                )}
              </Card>
              <Card>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">The watchdog&rsquo;s last sweeps</p>
                {cortexFleetErr ? (
                  <p className={cn('text-[12.5px]', TINT_FG.amber)}>{cortexFleetErr}</p>
                ) : cortexFleet === null ? (
                  <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading the sweeps…</p>
                ) : cortexFleet.length === 0 ? (
                  <p className="text-[12.5px] text-text-3">No sweep has reported yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {cortexFleet.slice(0, 5).map((row, i) => (
                      <li key={i} className="flex items-center gap-2 text-[12.5px]">
                        <Cpu size={12} className="shrink-0 text-text-3" />
                        <span className="min-w-0 flex-1 truncate text-text-1">{cortexSweepLine(row)}</span>
                        <span className="shrink-0 text-[11px] text-text-3">{cortexEpochAgo(row.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Link
              to="/app/guardian/health"
              className="mt-2 inline-flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3 no-underline hover:text-text-1"
            >
              <ShieldCheck size={10} /> Open Guardian — the full platform health screen
            </Link>
          </section>
        )
      })()}

      {/* ── THE LIBRARY — the hub's `documents` resource, the rows the Docs
          app draws (Docs / policy-acks / Image Bank stay registered; this
          workspace supersedes their screens) ── */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen size={14} className={TINT_FG.lavender} />
          <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-1">The Library</span>
          <span className="text-[11px] text-text-3">{library ? `${library.length} document${library.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {library === null ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : library.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title="The library is empty"
              body="The documents resource answers no rows — import a Drive folder from the Docs app and every document shows up here."
            />
          </Card>
        ) : (
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-2">
                  {['Title', 'Collection', 'Category', 'Added', ''].map((c, i) => (
                    <th key={i} className={cn('whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3', i > 0 && 'border-l border-border')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {library.map((d, i) => {
                  const href = safeHref(d.url)
                  return (
                    <tr key={d.id || `${d.title}-${i}`} className="border-t border-border odd:bg-surface even:bg-surface-2/40 transition-colors hover:bg-surface-2">
                      <td className="max-w-[360px] px-3 py-1.5">
                        {/* THE DOCUMENT OPENS INSIDE FIRST: the title is
                            the door to the
                            platform's own viewer; the small ExternalLink at
                            the row's end stays the explicit way OUT. */}
                        {href ? (
                          <button
                            onClick={() => openFile({
                              title: d.title || d.name || `Document ${i + 1}`,
                              subtitle: [d.collection, d.category].filter(Boolean).join(' · ') || 'Administration library',
                              url: href,
                              icon: 'file-text',
                            })}
                            className="flex min-w-0 items-center gap-2 text-left"
                            title={`${d.title || d.name || ''} — opens in the platform viewer`}
                          >
                            <FileText size={13} className="shrink-0 text-text-3" />
                            {/* many library docs are NAMED for their person
                                (a client book, a staff record) — the title
                                drags to the tracker like any name */}
                            <DragPerson name={personName(d.title || d.name || '')} className="min-w-0">
                              <span className="truncate font-medium text-primary hover:text-primary-hover">{d.title || d.name || `Document ${i + 1}`}</span>
                            </DragPerson>
                          </button>
                        ) : (
                          <span className="flex min-w-0 items-center gap-2" title={d.title || d.name || ''}>
                            <FileText size={13} className="shrink-0 text-text-3" />
                            <DragPerson name={personName(d.title || d.name || '')} className="min-w-0">
                              <span className="truncate font-medium text-text-1">{d.title || d.name || `Document ${i + 1}`}</span>
                            </DragPerson>
                          </span>
                        )}
                      </td>
                      <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-2">{d.collection || '—'}</td>
                      <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-2">{d.category || '—'}</td>
                      <td className="border-l border-border px-3 py-1.5 text-[12px] tabular-nums text-text-2">{fmtDate(d.addedAt || d.updatedAt)}</td>
                      <td className="border-l border-border px-3 py-1.5 text-right">
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center p-1 text-text-2 transition-colors hover:text-text-1"
                            title="Open outside, in Drive/the source"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* ── POLICY SIGNATURES — the policy-acks ledger ── */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={14} className={TINT_FG.lavender} />
          <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-text-1">Policy signatures</span>
          <span className="text-[11px] text-text-3">{acks ? `${acks.length} row${acks.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        {acks === null ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>
        ) : acks.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title="No signatures on file"
              body="The policy acknowledgments ledger answers no rows — signatures recorded in the Policies app appear here."
            />
          </Card>
        ) : (
          <Card padded={false} className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-2">
                  {['Policy', 'Version', 'Staff', 'Status', 'Signed', 'Effective'].map((c, i) => (
                    <th key={i} className={cn('whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-3', i > 0 && 'border-l border-border')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {acks.map((a, i) => {
                  const st = (a.status || 'pending').toLowerCase()
                  const tint = st === 'signed' ? 'mint' : st === 'overdue' ? 'danger' : 'amber'
                  return (
                    <tr key={a.id || `${a.policy}-${i}`} className="border-t border-border odd:bg-surface even:bg-surface-2/40 transition-colors hover:bg-surface-2">
                      <td className="max-w-[320px] px-3 py-1.5">
                        <span className="block truncate font-medium text-text-1" title={a.policy || ''}>{a.policy || '(unnamed policy)'}</span>
                      </td>
                      <td className="border-l border-border px-3 py-1.5 text-[12px] tabular-nums text-text-2">{a.version || '—'}</td>
                      {/* a person's name is a tracker handle — drag it up top
                          (no id on purpose: AckRow carries only the name, and
                          the tracker matches names; the ack id is NOT a person) */}
                      <td className="border-l border-border px-3 py-1.5 text-[12px] text-text-2">{a.staff ? <DragPerson name={a.staff} type="staff">{a.staff}</DragPerson> : '—'}</td>
                      <td className="border-l border-border px-3 py-1.5">
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', TINT_BG[tint], TINT_FG[tint])}>{st}</span>
                      </td>
                      <td className="border-l border-border px-3 py-1.5 text-[12px] tabular-nums text-text-2">{a.signedAt ? fmtDate(a.signedAt) : '—'}</td>
                      <td className="border-l border-border px-3 py-1.5 text-[12px] tabular-nums text-text-2">{fmtDate(a.effectiveDate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  )
}

// ═══════════ center: the folder overview (the old platform's synthesis position) ═══════════ the old platform fills…
function OverviewCenter({
  listing, files, totalBytes, loading, error, onRetry,
}: {
  listing: AdminDocsListing | null
  files: AdminDocFile[]
  totalBytes: number
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-[12px] text-text-3">
        <Loader2 size={14} className={cn('animate-spin', TINT_FG.lavender)} /> reading the folder…
      </div>
    )
  }
  if (error) {
    return (
      <Card padded={false}>
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-[12px] text-text-3">
          <div className={cn('flex items-center gap-2', TINT_FG.danger)}><AlertTriangle size={14} /> could not read the folder — {error}</div>
          <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] uppercase tracking-wider text-text-2">
            <RefreshCw size={12} /> retry
          </button>
        </div>
      </Card>
    )
  }
  if (listing && listing.configured === false) {
    return (
      <Card padded={false}>
        <EmptyState
          title="Administration folder not configured"
          body={listing.reason || 'Set the ADMIN_DOCS_FOLDER_ID property to the Administration Drive folder id and this workspace comes alive.'}
        />
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2.5">
        <StatChip label="Documents" value={String(files.length)} />
        <StatChip label="Total size" value={fmtSize(totalBytes) || '—'} />
        {listing?.folder_name && <StatChip label="Folder" value={listing.folder_name} />}
      </div>
      <Card>
        <div className="flex items-start gap-3">
          <Briefcase size={16} className={cn('mt-0.5 shrink-0', TINT_FG.lavender)} />
          <p className="text-[14px] leading-relaxed text-text-2">
            This is the Administration workspace: the folder's files are on the right — click to select,
            double-click to preview here; Import drops a file into the folder, Export downloads the
            selection. Ask the cortex from the Analysis column and the answer renders in this pane.
          </p>
        </div>
      </Card>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-3">
      {label} <span className="text-[12px] normal-case tracking-normal text-text-1">{value}</span>
    </span>
  )
}

/* ═══════════ center: a cortex answer (the old platform's report position) ═══════════ */
function ReportCenter({ answer, loading, error }: { answer: string; loading: boolean; error: string | null }) {
  if (loading && !answer) {
    return (
      <Card padded={false}>
        <div className="flex items-center justify-center gap-2 py-24 text-[12px] text-text-3">
          <Loader2 size={14} className={cn('animate-spin', TINT_FG.lavender)} /> the cortex is building the answer…
        </div>
      </Card>
    )
  }
  if (error) {
    return (
      <Card padded={false}>
        <div className={cn('flex items-center justify-center gap-2 py-16 text-[12px]', TINT_FG.danger)}>
          <AlertTriangle size={14} /> {error}
        </div>
      </Card>
    )
  }
  if (!answer) return null
  return (
    <Card>
      <p className="whitespace-pre-line text-[14px] leading-relaxed text-text-1">{answer}</p>
      {loading && <Loader2 size={12} className={cn('mt-3 animate-spin', TINT_FG.lavender)} />}
    </Card>
  )
}

/* ═══════════ center: a document (the old platform's inline preview position) ═══════════ */
function DocCenter({ file }: { file: AdminDocFile }) {
  const [kept, setKept] = useState<{ id?: string; url: string | null; why: string }>({ url: null, why: '' })
  useEffect(() => {
    if (!file.kept || !file.viewable || !file.id) return
    let alive = true
    let made: string | null = null
    setKept({ id: file.id, url: null, why: '' })
    keptBlob(file, 'view')
      .then(({ url }) => {
        made = url
        if (alive) setKept({ id: file.id, url, why: '' })
        else URL.revokeObjectURL(url)
      })
      .catch((e) => { if (alive) setKept({ id: file.id, url: null, why: e instanceof Error ? e.message : String(e) }) })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [file])
  const frame = file.kept ? (kept.id === file.id ? kept.url : null) : drivePreview(file)
  const view = safeHref(file.web_view_link)
  const editable = isGoogleNative(file.mime)
  return (
    <Card padded={false} className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]', editable ? TINT_FG.amber : 'text-text-3')}>
          {editable ? <PenLine size={11} /> : <FileText size={11} />} {docKind(file.mime)} · {editable ? 'editing' : 'preview'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadFile(file)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-2 transition-colors hover:bg-surface-2"
            title="Download this document"
          >
            <Download size={11} /> Download
          </button>
          {view && (
            <a
              href={view}
              target="_blank"
              rel="noreferrer"
              className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] no-underline transition-colors', TINT_BG.amber, TINT_FG.amber)}
              title="Open it full-screen in Drive"
            >
              Open in Drive <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
      <div className="h-[70vh] bg-surface-2">
        {frame ? (
          <iframe src={frame} title={file.name || 'document'} className="h-full w-full border-0" allow="autoplay; clipboard-read; clipboard-write" />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-6 text-center text-[12px] text-text-3">
            {file.kept && file.viewable
              ? (kept.why ? `The preview could not be read: ${kept.why}` : <Loader2 size={14} className={cn('animate-spin', TINT_FG.amber)} />)
              : file.kept ? 'No preview for this kind of file — download it.' : 'No preview available.'}
          </div>
        )}
      </div>
    </Card>
  )
}

/* ═══════════ right: the folder panel (the old platform's Documents folder position) ═══════════ */
function FolderPanel({
  items, listing, loading, error, onRetry, onOpenDoc, onDelete, selected, onSelect,
}: {
  items: AdminDocFile[]
  listing: AdminDocsListing | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenDoc: (f: AdminDocFile) => void
  onDelete: (f: AdminDocFile) => void
  selected: Set<string>
  onSelect: (id?: string) => void
}) {
  const [open, setOpen] = useState(true)
  const notConfigured = !loading && !error && listing?.configured === false
  return (
    <Card padded={false}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        {open ? <ChevronDown size={13} className="text-text-3" /> : <ChevronRight size={13} className="text-text-3" />}
        <FileText size={14} className={TINT_FG.amber} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-1">Documents</span>
        <span className="ml-auto text-[11px] tabular-nums text-text-3">{loading ? '…' : items.length}</span>
      </button>
      {open && (
        <div className="border-t border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-text-3">
              <Loader2 size={12} className={cn('animate-spin', TINT_FG.amber)} /> loading…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-6 text-center text-[11px] text-text-3">
              <span className={TINT_FG.danger}><AlertTriangle size={12} className="mr-1 inline" /> {error}</span>
              <button onClick={onRetry} className="rounded-md border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-2">
                <RefreshCw size={10} className="mr-1 inline" /> retry
              </button>
            </div>
          ) : notConfigured ? (
            <div className="px-3 py-6 text-center text-[12px] leading-relaxed text-text-2">
              {listing?.reason || 'The Administration Drive folder is not configured.'}
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-text-2">No documents.</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto">
              {items.map((f, i) => {
                const fmt = docKind(f.mime)
                const isSel = !!(f.id && selected.has(f.id))
                return (
                  <div
                    key={f.id || `${f.name}-${i}`}
                    onClick={() => onSelect(f.id)}
                    onDoubleClick={() => onOpenDoc(f)}
                    className={cn(
                      'group flex cursor-pointer select-none items-center gap-2 px-2.5 py-2 transition-colors hover:bg-surface-2',
                      i > 0 && 'border-t border-border',
                      isSel && 'border-l-2 border-l-current bg-surface-2',
                    )}
                    title={`${f.name || ''} · ${fmt} — click to select, double-click to open`}
                  >
                    <FileText size={14} className="shrink-0 text-text-3" />
                    <div className="min-w-0 flex-1">
                      {/* the folder holds client books and staff records —
                          a file's name is often a PERSON'S; it drags to the
                          tracker (extension stripped) */}
                      <DragPerson name={personName(f.name || '')} className="block min-w-0 max-w-full">
                        <span className="block truncate text-[12px] text-text-1">{f.name || `File ${i + 1}`}</span>
                      </DragPerson>
                      <span className="block truncate text-[10px] text-text-3">{fmt}{fmtSize(f.size_bytes) ? ` · ${fmtSize(f.size_bytes)}` : ''}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadFile(f) }}
                      className="hidden shrink-0 p-1 text-text-3 transition-colors hover:text-text-1 group-hover:block"
                      title="Download"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(f) }}
                      className={cn('hidden shrink-0 p-1 transition-colors group-hover:block', TINT_FG.danger)}
                      title="Move to trash (asks first)"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
