// PersonComplianceDrawer — one person's certification dossier, beside the list — the Compliance + Certifications…
// The candidate panel's grammar: uppercase mini-section labels, fact tiles in rounded cards, and a checklist card…
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, FileText, Loader2, Upload, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import {
  fetchIstConfig, expiringDays, IST_CONFIG_FALLBACK, IST_CONFIG_SHIPPED, type IstConfig,
} from '@/lib/istConfig'
import { TASK_ATTACH_ACCEPT } from '@/lib/taskAttachments'
import {
  nameFold, trackerCountable, uploadsCountable, uploadsRefusalOf, uploadsViewOf,
  type TrackerAnswer, type UploadRow, type UploadsAnswer, type UploadsView, type Viewer,
} from '@/lib/certUploads'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { fileToBase64, gasAction, humanSize, inferMime, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'
import { openFile } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type CertRow = {
  certName: string
  status: string
  expiresAt: string
  /** false = a canonical row the tracker holds nothing for */
  onFile: boolean
}

/** The rows the red letter chases — offered even without a tracker record. */
const CANONICAL: { label: string; match: RegExp }[] = [
  { label: 'DODD Certification', match: /dodd/i },
  { label: 'CPR / First Aid', match: /cpr|first aid/i },
  { label: 'Medication Delegation', match: /med\s*del|medication delegation/i },
]

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const DAY_MS = 24 * 60 * 60 * 1000

// The chip a row wears.
function chipFor(row: CertRow, windowDays: number): { label: string; cls: string } {
  const ms = Date.parse(row.expiresAt)
  const dated = Number.isFinite(ms)
  if (row.status === 'expired' || (dated && ms < Date.now())) {
    return { label: 'EXPIRED', cls: 'bg-danger/10 text-danger' }
  }
  if (row.status === 'expiring' || (dated && ms - Date.now() <= windowDays * DAY_MS)) {
    return { label: 'Expiring', cls: 'bg-tint-amber text-tint-fg-amber' }
  }
  if (row.status === 'valid') {
    return { label: 'Valid', cls: 'bg-tint-mint text-tint-fg-mint' }
  }
  // a canonical placeholder, or a status word this screen has never met
  return { label: row.onFile ? row.status || 'unknown' : 'not on file', cls: 'bg-surface-2 text-text-3' }
}

export default function PersonComplianceDrawer({ person, onClose }: { person: string; onClose: () => void }) {
  const [trackerRows, setTrackerRows] = useState<Record<string, unknown>[]>([])
  const [trackerView, setTrackerView] = useState<UploadsView>({ state: 'loading' })
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [upView, setUpView] = useState<UploadsView>({ state: 'loading' })
  const viewer = useEffectiveUser()
  const [busy, setBusy] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingCert = useRef<string | null>(null)
  // The expiring window, from the tab.
  const [istCfg, setIstCfg] = useState<IstConfig>({
    ...IST_CONFIG_FALLBACK, values: IST_CONFIG_SHIPPED, blind: false, reason: '',
  })
  const soonDays = expiringDays(istCfg)

  useEffect(() => {
    void fetchIstConfig().then(setIstCfg).catch(() => { /* the floor stands */ })
  }, [])

  useEffect(() => {
    let alive = true
    setBusy(true)
    setTrackerView({ state: 'loading' })
    setUpView({ state: 'loading' })
    // Two independent reads: the tracker's picture and the submissions ledger.
    void Promise.allSettled([
      gasAction<TrackerAnswer>('certTrackerList', { view: 'certs' }),
      gasAction<UploadsAnswer>('certUploadsList', {}),
    ]).then(([certRes, upRes]) => {
      if (!alive) return
      if (certRes.status === 'fulfilled' && Array.isArray(certRes.value?.rows)) {
        setTrackerRows(certRes.value.rows)
        setTrackerView(uploadsViewOf(certRes.value))
      } else {
        setTrackerRows([])
        setTrackerView(certRes.status === 'rejected' ? uploadsRefusalOf(certRes.reason) : { state: 'unreadable', why: '' })
      }
      if (upRes.status === 'fulfilled') {
        setUploads(upRes.value.uploads ?? [])
        setUpView(uploadsViewOf(upRes.value))
      } else {
        setUploads([])
        setUpView(uploadsRefusalOf(upRes.reason))
      }
      setBusy(false)
    })
    return () => { alive = false }
  }, [person])

  // another person's records are the master's view alone; an 'own' answer cannot count them, and a refusal about…
  const me: Viewer = {
    name: viewer?.name ?? '',
    filesForOthers: !!viewer && (viewer.isMaster || viewer.role === 'admin' || viewer.role === 'manager'),
  }
  const trackerCount = trackerCountable(trackerView, person, me)
  const upCount = uploadsCountable(upView, person, me)

  // the tracker's rows for this person, matched by the server's fold: an own answer by the roster name it keyed
  const certs = useMemo<CertRow[]>(() => (trackerCount.countable
    ? trackerRows
      .filter((r) => nameFold(String(r.personName ?? '')) === trackerCount.key)
      .map((r) => ({
        certName: String(r.certName ?? 'Certification'),
        status: String(r.status ?? ''),
        expiresAt: String(r.expiresAt ?? ''),
        onFile: true,
      }))
    : []), [trackerRows, trackerCount.countable, trackerCount.key])

  /** The person's real rows (worst first) + the canonical rows not on file. */
  const rows = useMemo(() => {
    const sev = (r: CertRow) =>
      (chipFor(r, soonDays).label === 'EXPIRED' ? 0 : chipFor(r, soonDays).label === 'Expiring' ? 1 : 2)
    const real = [...certs].sort((a, b) => sev(a) - sev(b) || a.certName.localeCompare(b.certName))
    const missing = CANONICAL
      .filter((c) => !certs.some((r) => c.match.test(r.certName)))
      .map((c) => ({ certName: c.label, status: '', expiresAt: '', onFile: false }))
    return [...real, ...missing]
  }, [certs, soonDays])

  // the ledger matches a person by the server's fold, not by this screen's spacing; an own answer by the roster name
  const submittedFor = (cert: string) =>
    uploads
      .filter((u) => nameFold(u.person) === upCount.key && norm(u.cert) === norm(cert))
      .sort((a, b) => b.at.localeCompare(a.at))[0]

  const attention = rows.filter((r) => { const c = chipFor(r, soonDays).label; return c === 'EXPIRED' || c === 'Expiring' }).length
  const submittedCount = new Set(rows.filter((r) => submittedFor(r.certName)).map((r) => r.certName)).size

  const pickFor = (cert: string) => {
    pendingCert.current = cert
    fileInput.current?.click()
  }

  const onFilePicked = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    const cert = pendingCert.current
    pendingCert.current = null
    if (!f || !cert) return
    const mime = inferMime(f)
    if (!(mime.startsWith('image/') || mime === 'application/pdf')) {
      toast({ type: 'warning', title: 'Images and PDFs only' })
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast({ type: 'warning', title: 'Too large', body: `${humanSize(f.size)} — up to 15MB.` })
      return
    }
    setUploading(cert)
    try {
      const base64 = await fileToBase64(f)
      const row = await gasAction<UploadRow & { shared?: boolean }>('certDocUpload', {
        person, cert, base64, filename: f.name, mime,
      })
      setUploads((prev) => [...prev, row])
      toast({
        type: 'success',
        title: `${cert} — submitted`,
        body: `${f.name} landed in the compliance folder${row.shared ? ' and the shared Drive copy' : ''}.`,
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Upload failed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="scroll-thin h-full w-full overflow-y-auto border-l border-border bg-surface shadow-2 sm:w-[384px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── header — the candidate panel's shape ── */}
        <div className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">Compliance record</p>
          <div className="flex items-center gap-2.5">
            {/* the matrix row that opens this drawer already drags — the
                header the drawer is about has to drag the same way */}
            <DragPerson name={person} subtitle="Compliance record" className="min-w-0 flex-1 items-center gap-2.5">
              <Avatar name={person} size="sm" />
              <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold text-text-1">{person}</h2>
            </DragPerson>
            <button onClick={onClose} aria-label="Close" className="text-text-3 hover:text-text-1"><X size={16} /></button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* ── DETAILS — the fact tiles ── */}
          <div>
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">Details</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border bg-surface-2/40 px-3.5 py-3">
                <p className="text-[16px] font-bold leading-6 text-text-1">{trackerCount.countable ? certs.length : '—'}</p>
                <p className="text-[11px] text-text-3">On the tracker</p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/40 px-3.5 py-3">
                <p className={cn('text-[16px] font-bold leading-6', trackerCount.countable && attention > 0 ? 'text-danger' : 'text-text-1')}>
                  {trackerCount.countable ? attention : '—'}
                </p>
                <p className="text-[11px] text-text-3">Need attention</p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/40 px-3.5 py-3">
                <p className="text-[16px] font-bold leading-6 text-text-1">{upCount.countable ? submittedCount : '—'}</p>
                <p className="text-[11px] text-text-3">Docs submitted</p>
              </div>
            </div>
          </div>

          {trackerCount.note && (
            <p className="flex items-start gap-1.5 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
              <CircleAlert size={13} className="mt-0.5 shrink-0" /> {trackerCount.note}
            </p>
          )}
          {upCount.note && (
            <p className="flex items-start gap-1.5 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[12px] leading-4 text-text-2">
              <CircleAlert size={13} className="mt-0.5 shrink-0" /> {upCount.note}
            </p>
          )}

          {/* ── CERTIFICATIONS — the checklist card ── */}
          <div>
            <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-3">
              Certifications{rows.length > 0 ? ` · ${rows.length}` : ''}
            </p>
            <div className="rounded-xl border border-border">
              {busy && (
                <p className="flex items-center gap-2 px-3 py-4 text-[12.5px] text-text-3">
                  <Loader2 size={13} className="animate-spin" /> Reading the tracker…
                </p>
              )}
              {!busy && rows.map((row) => {
                // a tracker that was not shown says nothing about a canonical row — never "not on file"
                const chip = row.onFile || trackerCount.countable
                  ? chipFor(row, soonDays) : { label: '—', cls: 'bg-surface-2 text-text-3' }
                const sub = submittedFor(row.certName)
                return (
                  <div key={row.certName} className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-text-1">{row.certName}</p>
                      <p className="text-[11px] text-text-3">
                        {row.expiresAt
                          ? `Expires ${row.expiresAt}`
                          : row.onFile ? 'No expiry on record'
                            : trackerCount.countable ? 'The tracker has no row' : 'The tracker is not shown here'}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold', chip.cls)}>
                      {chip.label}
                    </span>
                    {sub && (
                      <button
                        onClick={() => openFile({ url: sub.url, title: sub.name, subtitle: person, icon: 'file-text' })}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-tint-blue px-2 py-0.5 text-[10.5px] font-bold text-tint-fg-blue hover:opacity-80"
                        title={`${sub.name} — open the submitted document`}
                      >
                        <FileText size={10} /> Submitted {sub.at.slice(0, 10)}
                      </button>
                    )}
                    <button
                      onClick={() => pickFor(row.certName)}
                      disabled={uploading !== null}
                      className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      {uploading === row.certName
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Upload size={11} />}
                      Upload
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] italic text-text-3">
              A photo or PDF of the card — it is filed in the compliance Drive folder for review.
            </p>
          </div>
        </div>

        <input ref={fileInput} type="file" accept={TASK_ATTACH_ACCEPT} className="hidden" onChange={(ev) => void onFilePicked(ev)} />
      </div>
    </div>
  )
}
