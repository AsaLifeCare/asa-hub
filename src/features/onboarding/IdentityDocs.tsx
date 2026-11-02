// Step 3 — the five identification documents.
// The point of this screen is what it does NOT ask for.
import { useRef, useState } from 'react'
import { Check, CloudUpload, ExternalLink, History, Trash2, TriangleAlert } from 'lucide-react'
import { openFile } from '@/stores/useFileViewerStore'
import { MAX_UPLOAD_BYTES, fileToBase64, gasAction, humanSize } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { ObDoc, ObDocStatus } from './useObFlow'

// A paper the portal filed opens from the server's copy; anything else (or a copy that cannot be read) from Drive.
function openDoc(d: ObDoc) {
  const fromDrive = () => {
    if (d.file_url) openFile({ title: d.label, subtitle: 'Identification document', url: d.file_url })
  }
  if (!d.kept_id) return fromDrive()
  gasAction<{ b64?: string; mime?: string; name?: string }>('obDocFile', { file_id: d.kept_id }, { timeoutMs: 120000 })
    .then((got) => {
      const raw = atob(got?.b64 || '')
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: got?.mime || 'application/pdf' }))
      openFile({ title: d.label, subtitle: 'Identification document', url })
    })
    .catch(fromDrive)
}

const STATUS_STYLE: Record<ObDocStatus, string> = {
  on_file: 'bg-tint-mint text-tint-fg-mint',
  uploaded: 'bg-tint-mint text-tint-fg-mint',
  claimed: 'bg-tint-amber text-tint-fg-amber',
  missing: 'bg-surface-2 text-text-3',
}

const STATUS_LABEL: Record<ObDocStatus, string> = {
  on_file: 'on file',
  uploaded: 'received',
  claimed: 'no copy',
  missing: 'needed',
}

// These expire, and the review folder's file names carry the date.
const EXPIRING = new Set(['drivers_license', 'car_insurance', 'cpr', 'dodd_8hr'])

export default function IdentityDocs({
  docs,
  priorCount,
  onUpload,
  onRemove,
}: {
  docs: ObDoc[]
  priorCount: number
  onUpload: (docId: string, base64: string, filename: string, mime: string, expires?: string) => Promise<unknown>
  /** only offered for what WE filed — an old-form submission is not ours to remove */
  onRemove: (docId: string) => Promise<unknown>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<Record<string, string>>({})
  const pickerFor = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onFile = async (file?: File) => {
    const docId = pickerFor.current
    if (!file || !docId) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ type: 'warning', title: 'That file is too large', body: `Maximum ${humanSize(MAX_UPLOAD_BYTES)}.` })
      return
    }
    setBusy(docId)
    try {
      await onUpload(docId, await fileToBase64(file), file.name, file.type, expiry[docId])
      toast({ type: 'success', title: 'Received', body: `${file.name} is on file.` })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not send it', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setBusy(null)
      pickerFor.current = null
    }
  }

  const done = docs.filter((d) => d.status === 'on_file' || d.status === 'uploaded').length

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-text-2">
          {done} of {docs.length} on file
        </span>
        {priorCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tint-mint px-2.5 py-1 text-[11px] font-semibold text-tint-fg-mint">
            <History size={11} /> We already had {priorCount} from you — no need to send those again
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {docs.map((d) => {
          const settled = d.status === 'on_file' || d.status === 'uploaded'
          return (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-[9px]',
                  settled ? 'bg-tint-mint text-tint-fg-mint' : d.status === 'claimed' ? 'bg-tint-amber text-tint-fg-amber' : 'bg-surface-2 text-text-3',
                )}
              >
                {settled ? <Check size={14} /> : d.status === 'claimed' ? <TriangleAlert size={14} /> : <CloudUpload size={14} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="clamp-1 block text-[13px] font-medium text-text-1">{d.label}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', STATUS_STYLE[d.status])}>
                    {STATUS_LABEL[d.status]}
                  </span>
                  {d.source && <span className="text-[11px] text-text-3">{d.source}</span>}
                  {d.expires && <span className="text-[11px] text-text-3">· expires {d.expires}</span>}
                </span>
              </span>

              {d.file_url && (
                <button
                  type="button"
                  title="Open the copy we have"
                  onClick={() => openDoc(d)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
                >
                  <ExternalLink size={14} />
                </button>
              )}

              {EXPIRING.has(d.id) && !settled && (
                <label className="hidden shrink-0 items-center gap-1 text-[11px] text-text-3 sm:flex">
                  expires
                  <input
                    type="date"
                    value={expiry[d.id] ?? ''}
                    onChange={(e) => setExpiry((x) => ({ ...x, [d.id]: e.target.value }))}
                    className="h-7 rounded-sm border border-border bg-surface px-1.5 text-[11.5px] text-text-1 outline-none focus:border-primary"
                  />
                </label>
              )}
              {d.status === 'uploaded' && (
                <button
                  type="button"
                  title="Remove what you sent"
                  disabled={busy === d.id}
                  onClick={() => {
                    setBusy(d.id)
                    void onRemove(d.id).finally(() => setBusy(null))
                  }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-tint-pink hover:text-danger disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                type="button"
                disabled={busy === d.id}
                onClick={() => {
                  pickerFor.current = d.id
                  inputRef.current?.click()
                }}
                className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-3 disabled:opacity-60"
              >
                {busy === d.id ? 'Sending…' : settled ? 'Replace' : 'Attach'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
