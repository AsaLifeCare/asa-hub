// Step 1 — the New Hire Packet: six signed forms, one row each.
// Deliberately the same shape as step 3's document list, because it is the same job: a row per requirement answers…
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CloudUpload, ExternalLink, TriangleAlert } from 'lucide-react'
import { openFile } from '@/stores/useFileViewerStore'
import { MAX_UPLOAD_BYTES, fileToBase64, gasAction, humanSize } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export type PacketItem = {
  id: string
  label: string
  status: 'missing' | 'claimed' | 'signed'
  file_url?: string
}

type PacketState = {
  found: boolean
  candidate_name?: string
  items: PacketItem[]
  done: number
  total: number
}

const ITEM_TINT: Record<string, string> = {
  job_app: 'bg-tint-lavender text-tint-fg-lavender',
  attestation: 'bg-tint-mint text-tint-fg-mint',
  i9: 'bg-tint-blue text-tint-fg-blue',
  w4: 'bg-tint-amber text-tint-fg-amber',
  hipaa: 'bg-tint-pink text-tint-fg-pink',
  pay_auth: 'bg-tint-peach text-tint-fg-peach',
}

const STATUS_STYLE: Record<PacketItem['status'], string> = {
  signed: 'bg-tint-mint text-tint-fg-mint',
  claimed: 'bg-tint-amber text-tint-fg-amber',
  missing: 'bg-surface-2 text-text-3',
}

const STATUS_LABEL: Record<PacketItem['status'], string> = {
  signed: 'signed',
  claimed: 'no file',
  missing: 'not signed',
}

export default function PacketChecklist() {
  const [state, setState] = useState<PacketState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const pickerFor = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await gasAction<PacketState>('packetState', {}))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your packet.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onFile = async (file?: File) => {
    const itemId = pickerFor.current
    if (!file || !itemId) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ type: 'warning', title: 'That file is too large', body: `Maximum ${humanSize(MAX_UPLOAD_BYTES)}.` })
      return
    }
    setBusy(itemId)
    try {
      const base64 = await fileToBase64(file)
      const next = await gasAction<PacketState>('packetUpload', {
        item_id: itemId,
        base64,
        filename: file.name,
        mime_type: file.type,
      })
      setState(next)
      toast({ type: 'success', title: 'Sent', body: `${file.name} is on file.` })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not send it', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setBusy(null)
      pickerFor.current = null
    }
  }

  if (error) {
    return <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
  }
  if (!state) return <p className="text-[13px] text-text-3">Loading your packet…</p>

  if (!state.found) {
    return (
      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-[12.5px] leading-5 text-text-2">
        You have not been added to the onboarding list yet. A recruiter does that when your start date is
        set — nothing here is missing on your side.
      </p>
    )
  }

  const complete = state.done === state.total

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

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-semibold text-text-2">
          {state.done} of {state.total} signed
        </span>
        {complete && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tint-mint px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-tint-fg-mint">
            <Check size={11} /> Packet complete
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {state.items.map((it) => (
          <li
            key={it.id}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[9px]', ITEM_TINT[it.id] ?? 'bg-surface-2 text-text-3')}>
              {it.status === 'signed' ? <Check size={14} /> : it.status === 'claimed' ? <TriangleAlert size={14} /> : <CloudUpload size={14} />}
            </span>

            <span className="min-w-0 flex-1">
              <span className="clamp-1 block text-[13px] font-medium text-text-1">{it.label}</span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', STATUS_STYLE[it.status])}>
                  {STATUS_LABEL[it.status]}
                </span>
                {it.status === 'claimed' && (
                  <span className="text-[11px] text-text-3">marked signed, but no copy was attached</span>
                )}
              </span>
            </span>

            {it.file_url && (
              <button
                type="button"
                title="Open the signed copy"
                onClick={() => openFile({ title: it.label, subtitle: 'New Hire Packet', url: it.file_url as string })}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
              >
                <ExternalLink size={14} />
              </button>
            )}

            <button
              type="button"
              disabled={busy === it.id}
              onClick={() => {
                pickerFor.current = it.id
                inputRef.current?.click()
              }}
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-3 disabled:opacity-60"
            >
              {busy === it.id ? 'Sending…' : it.status === 'missing' ? 'Attach' : 'Replace'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
