// Settings → Hub containers → Server Paths: where the server keeps the platform's own files — the relay's pictures (every
// photo uploaded on a page) and asa-hub-app's copy of Locations' documents out of Drive (location_docs.py).
// Each answers the master's own session alone (person_photos.where, locationDocsWhere).
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { lane } from '@/pages/features/shifts/laneFetch'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'

export type ImagesFolderApp = { app: string; label: string; folder: string; records: number; photos: number; bytes: number }
export type ImagesFolder = { root: string; inside: string; mounted: boolean; why: string; apps: ImagesFolderApp[] }

export const IMAGES_FOLDER_PATH = '/hub-lanes/photos/where'

export function sizeWords(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CopyPath({ path }: { path: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(path).then(() => {
      setDone(true)
      window.setTimeout(() => setDone(false), 1500)
    }, () => {})
  }
  return (
    <button type="button" onClick={copy} aria-label="Copy the path" title="Copy the path"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1">
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

export function ImagesFolderBody({ data }: { data: ImagesFolder }) {
  return (
    <div className="grid gap-4" data-images-folder="">
      <div className="flex items-center gap-2 rounded-[12px] border border-border bg-surface-2/50 px-3 py-2.5">
        <FolderOpen size={16} className="shrink-0 text-text-3" />
        <code className="min-w-0 flex-1 break-all text-[13px] font-semibold text-text-1" data-images-root="">{data.root}</code>
        <CopyPath path={data.root} />
      </div>
      {!data.mounted && (
        <p className="rounded-md bg-tint-amber px-3 py-2 text-[12.5px] text-tint-fg-amber" data-images-unmounted="">
          The relay cannot write there just now ({data.why}). Nothing can be uploaded until it can.
        </p>
      )}
      <ul className="divide-y divide-border" data-images-apps="">
        {data.apps.map((a) => (
          <li key={a.app} className="grid gap-1 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center sm:gap-3" data-images-app={a.app}>
            <span className="text-[13px] font-semibold text-text-1">{a.label}</span>
            <span className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-[12px] text-text-2">{a.folder}</code>
              <CopyPath path={a.folder} />
            </span>
            <span className="text-[12px] tabular-nums text-text-3">
              {a.photos ? `${a.photos} photo${a.photos === 1 ? '' : 's'} · ${a.records} record${a.records === 1 ? '' : 's'} · ${sizeWords(a.bytes)}` : 'None yet'}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] leading-5 text-text-3">
        Each upload is a new file named by the time it arrived; a replaced photo stays on file and nothing is ever deleted.
        The relay sees this folder as <code>{data.inside}</code>.
      </p>
    </div>
  )
}

export type DocumentsFolder = {
  root: string; inside: string; mounted: boolean; why: string; files: number; bytes: number
  folders: { folder: string; path: string; files: number; bytes: number }[]
  /** seconds since the epoch of the newest copy; 0 before the first */
  last_saved: number
}

export const DOCUMENTS_FOLDER_ACTION = 'locationDocsWhere'

/** Locations' documents copied out of Drive onto the server, so the viewer opens them from disk. */
export function DocumentsFolderBody({ data }: { data: DocumentsFolder }) {
  return (
    <div className="grid gap-4" data-documents-folder="">
      <div className="flex items-center gap-2 rounded-[12px] border border-border bg-surface-2/50 px-3 py-2.5">
        <FolderOpen size={16} className="shrink-0 text-text-3" />
        <code className="min-w-0 flex-1 break-all text-[13px] font-semibold text-text-1" data-documents-root="">{data.root}</code>
        <CopyPath path={data.root} />
      </div>
      {!data.mounted && (
        <p className="rounded-md bg-tint-amber px-3 py-2 text-[12.5px] text-tint-fg-amber" data-documents-unmounted="">
          The app cannot write there just now ({data.why}). The documents open from Drive until it can.
        </p>
      )}
      {data.folders.length === 0 ? (
        <p className="text-[12.5px] text-text-3">Nothing is copied yet: the first pass runs two minutes after the app starts.</p>
      ) : (
        <ul className="divide-y divide-border" data-documents-folders="">
          {data.folders.map((f) => (
            <li key={f.folder} className="grid gap-1 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
              data-documents-house={f.folder}>
              <span className="text-[13px] font-semibold text-text-1">{f.folder === 'policies' ? 'Company policies' : f.folder}</span>
              <span className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-[12px] text-text-2">{f.path}</code>
                <CopyPath path={f.path} />
              </span>
              <span className="text-[12px] tabular-nums text-text-3">
                {`${f.files} file${f.files === 1 ? '' : 's'} · ${sizeWords(f.bytes)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] leading-5 text-text-3">
        Each client’s ISP and the house guidebook go under the house’s code, the company policies once for every house.
        A document changed in Drive is copied again within half an hour; nothing is ever deleted.
        {data.last_saved ? ` Last copy ${new Date(data.last_saved * 1000).toLocaleString()}.` : ''} The app sees this folder
        as <code>{data.inside}</code>.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">{title}</h3>
      {children}
    </section>
  )
}

export default function ImagesFolderCard() {
  const [data, setData] = useState<ImagesFolder | null>(null)
  const [docs, setDocs] = useState<DocumentsFolder | null>(null)
  const [failed, setFailed] = useState('')
  const [docsFailed, setDocsFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true)
    const [pictures, documents] = await Promise.allSettled([
      lane<ImagesFolder>(IMAGES_FOLDER_PATH), gasAction<DocumentsFolder>(DOCUMENTS_FOLDER_ACTION, {}),
    ])
    if (pictures.status === 'fulfilled') {
      setData(pictures.value)
      setFailed('')
    } else {
      setFailed(pictures.reason instanceof Error && pictures.reason.message ? pictures.reason.message : 'The server did not answer.')
    }
    if (documents.status === 'fulfilled') {
      setDocs(documents.value)
      setDocsFailed('')
    } else {
      setDocsFailed(documents.reason instanceof Error && documents.reason.message ? documents.reason.message : 'The app did not answer.')
    }
    setBusy(false)
  }, [])
  useEffect(() => { void load() }, [load])
  const reading = <p className="flex items-center gap-2 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the folder…</p>
  return (
    <Card>
      <CardHeader
        title="Server Paths"
        sub="Where the server keeps the platform's own files: every photo uploaded on a page, and Locations' documents copied out of Drive so they open at once. Shown to the master alone."
        extra={
          <button type="button" onClick={() => void load()} disabled={busy} data-images-refresh=""
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50">
            <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> Refresh
          </button>
        }
      />
      <div className="grid gap-6">
        <Section title="Pictures">
          {data ? <ImagesFolderBody data={data} />
            : failed ? <p role="alert" className="text-[13px] text-[var(--danger)]">The folder could not be read: {failed}</p>
              : reading}
        </Section>
        <Section title="Locations documents">
          {docs ? <DocumentsFolderBody data={docs} />
            : docsFailed ? <p role="alert" className="text-[13px] text-[var(--danger)]">The folder could not be read: {docsFailed}</p>
              : reading}
        </Section>
      </div>
    </Card>
  )
}
