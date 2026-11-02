// FormFileUpload — the platform's ONE in-app file funnel (Phase 3): the same form can be used in different…
// Wraps the house FileDropZone, sends each picked file through the session door (`formFileStore`) into the named…
import { useState } from 'react'
import { Check, Loader2, RotateCw, X } from 'lucide-react'
import { FileDropZone, fileToBase64, gasAction, humanSize, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'
import { attachmentId } from '@/lib/taskAttachments'
import { cn } from '@/lib/utils'

export type StoredFormFile = {
  file_id: string; file_url: string; file_name: string
  mime_type: string; size_bytes: number
}

type Entry = {
  name: string; size: number; status: 'up' | 'ok' | 'err'
  error?: string; stored?: StoredFormFile; raw: File; key: string
}

export default function FormFileUpload({ context, refKey, accept, hint, onStored }: {
  /** FORM_UPLOAD_CONTEXTS key, e.g. 'finance' */
  context: string
  /** the caller's anchor (a transaction id, a person key) — lands in field_key */
  refKey?: string
  /** input accept attr, e.g. ".pdf,.png,.jpg" — cosmetic; the server decides */
  accept?: string
  hint?: string
  onStored?: (file: StoredFormFile) => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])

  const upload = async (idx: number, raw: File, key: string) => {
    setEntries((es) => es.map((e, i) => (i === idx ? { ...e, status: 'up', error: '' } : e)))
    try {
      if (raw.size > MAX_UPLOAD_BYTES) throw new Error(`Over ${humanSize(MAX_UPLOAD_BYTES)} — too big for the envelope.`)
      const base64 = await fileToBase64(raw)
      // one key per pick, kept for its retries: the door names the stored file by it, so a retry finds this file and
      // another pick of the same name never answers with it
      const got = await gasAction<StoredFormFile>('formFileStore',
        { context, filename: raw.name, base64, ref: refKey ?? '', upload_id: key },
        { timeoutMs: 120_000 })
      setEntries((es) => es.map((e, i) => (i === idx ? { ...e, status: 'ok', stored: got } : e)))
      onStored?.(got)
    } catch (err) {
      setEntries((es) => es.map((e, i) => (i === idx
        ? { ...e, status: 'err', error: err instanceof Error ? err.message : 'That did not upload.' }
        : e)))
    }
  }

  const take = (raw: File) => {
    setEntries((es) => {
      const key = attachmentId()
      const next = [...es, { name: raw.name, size: raw.size, status: 'up' as const, raw, key }]
      void upload(next.length - 1, raw, key)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <FileDropZone
        accept={accept ?? ''}
        hint={hint ?? 'Any accepted document — it is digested automatically'}
        onFile={take}
      />
      {entries.map((e, i) => (
        <div key={i}
          className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]',
            e.status === 'err' ? 'border-danger/50' : 'border-border')}>
          {e.status === 'up' ? <Loader2 size={13} className="shrink-0 animate-spin text-text-3" />
            : e.status === 'ok' ? <Check size={13} className="shrink-0 text-[var(--status-green)]" />
            : <X size={13} className="shrink-0 text-danger" />}
          <span className="min-w-0 flex-1 truncate text-text-1">{e.name}</span>
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-text-2">
            {humanSize(e.size)}
          </span>
          {e.status === 'err' && (
            <>
              <span className="max-w-[220px] truncate text-[11px] text-danger">{e.error}</span>
              <button onClick={() => void upload(i, e.raw, e.key)} title="Try again"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
                <RotateCw size={12} />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
