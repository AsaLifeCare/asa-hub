// The new hire's own document list — the trainee side of the same rows an admin sees in OnboardingDocsModal…
// Deliberately NOT a drop zone.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CloudUpload, ExternalLink } from 'lucide-react'
import { openFile } from '@/stores/useFileViewerStore'
import { MAX_UPLOAD_BYTES, fileToBase64, gasAction, humanSize } from '@/features/hiring/shared'
import type { DocItem } from '@/features/hiring/OnboardingDocsModal'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type DocState = {
  items: DocItem[]
  uploaded: number
  total: number
  required_missing: string[]
  folder_url?: string
}

const DOC_TINT: Record<string, string> = {
  dropbox_packet: 'bg-tint-lavender text-tint-fg-lavender',
  dodd_8hr: 'bg-tint-amber text-tint-fg-amber',
  cpr_first_aid: 'bg-tint-pink text-tint-fg-pink',
  med_del: 'bg-tint-blue text-tint-fg-blue',
  drivers_id: 'bg-tint-mint text-tint-fg-mint',
  hs_diploma: 'bg-tint-peach text-tint-fg-peach',
  ss_birth: 'bg-tint-lavender text-tint-fg-lavender',
  background_check: 'bg-tint-mint text-tint-fg-mint',
  car_insurance: 'bg-tint-blue text-tint-fg-blue',
}

const STATUS_NOTE: Record<string, string> = {
  verified: 'Verified — nothing else needed',
  uploaded: 'Received — waiting on review',
  returned: 'Sent back — please upload it again',
}

export default function DocumentChecklist({
  candidateId,
  /** Optional: only show these doc ids (the training step shows two). */
  only,
  onProgress,
}: {
  candidateId: string
  only?: string[]
  onProgress?: (done: number, total: number) => void
}) {
  const [state, setState] = useState<DocState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pickerFor = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const apply = useCallback(
    (res: DocState) => {
      setState(res)
      const items = only ? res.items.filter((i) => only.includes(i.doc_id)) : res.items
      onProgress?.(
        items.filter((i) => i.status === 'uploaded' || i.status === 'verified').length,
        items.length,
      )
    },
    // onProgress is a fresh closure each render; re-running on it would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [only],
  )

  const load = useCallback(async () => {
    try {
      apply(await gasAction<DocState>('docList', { candidate_id: candidateId }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your document list.')
    }
  }, [candidateId, apply])

  useEffect(() => {
    void load()
  }, [load])

  const onFile = async (file: File | undefined) => {
    const docId = pickerFor.current
    pickerFor.current = null
    if (!file || !docId) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`${file.name} is too large (${humanSize(file.size)}) — the limit is 15MB.`)
      return
    }
    setBusy(docId)
    setError(null)
    try {
      const res = await gasAction<{ state: DocItem[] }>('docUpload', {
        candidate_id: candidateId,
        doc_id: docId,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        base64: await fileToBase64(file),
      })
      if (res?.state) {
        const items = res.state
        apply({
          items,
          uploaded: items.filter((i) => i.status === 'uploaded' || i.status === 'verified').length,
          total: items.length,
          required_missing: items
            .filter((i) => i.required && i.status !== 'uploaded' && i.status !== 'verified')
            .map((i) => i.label),
          folder_url: state?.folder_url,
        })
      } else {
        await load()
      }
      toast({ type: 'success', title: 'Document received', body: `${file.name} is on file.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — please try again.')
    } finally {
      setBusy(null)
    }
  }

  const items = state ? (only ? state.items.filter((i) => only.includes(i.doc_id)) : state.items) : []
  const done = items.filter((i) => i.status === 'uploaded' || i.status === 'verified').length

  return (
    <div className="space-y-2.5">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {!only && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: items.length ? `${(done / items.length) * 100}%` : '0%' }}
            />
          </div>
          <span className="shrink-0 text-[12.5px] font-semibold text-primary-strong">
            {state ? `${done} of ${items.length} uploaded` : 'Loading…'}
          </span>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
      )}

      <ul className="grid gap-2">
        {items.map((it) => {
          const working = busy === it.doc_id
          const filed = it.status === 'uploaded' || it.status === 'verified'
          return (
            <li
              key={it.doc_id}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3.5 py-2.5 transition-colors',
                filed ? 'border-border bg-surface-2' : 'border-dashed border-border-strong bg-surface',
              )}
            >
              <span
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-sm',
                  filed ? 'bg-primary text-on-primary' : (DOC_TINT[it.doc_id] ?? 'bg-surface-2 text-text-3'),
                )}
              >
                {filed ? <Check size={15} /> : <CloudUpload size={15} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="clamp-1 block text-[13px] font-semibold text-text-1">
                  {it.label}
                  {!it.required && <span className="ml-1.5 text-[11px] font-medium text-text-3">optional</span>}
                </span>
                <span className="clamp-1 block text-[12px] text-text-3">
                  {STATUS_NOTE[it.status] ?? 'Tap to upload'}
                  {it.expires_on ? ` · expires ${it.expires_on}` : ''}
                </span>
              </span>

              {it.file_url && (
                <button
                  type="button"
                  onClick={() => openFile({ title: it.label, subtitle: 'Your uploaded document', url: it.file_url as string })}
                  title="Open the file you sent"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
                >
                  <ExternalLink size={14} />
                </button>
              )}

              <button
                type="button"
                disabled={working}
                onClick={() => {
                  pickerFor.current = it.doc_id
                  inputRef.current?.click()
                }}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-colors disabled:opacity-50',
                  filed
                    ? 'border border-border bg-surface text-text-1 hover:bg-surface-3'
                    : 'bg-primary text-on-primary hover:bg-primary-hover',
                )}
              >
                {working ? 'Sending…' : filed ? 'Replace' : 'Upload'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
