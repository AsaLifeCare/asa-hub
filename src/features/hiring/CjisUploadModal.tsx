// CJIS / background report upload for a live pipeline candidate.
// PDF-only drop/pick (15MB cap) + a "Background result" select whose options are the work-engine vocabulary EXACTLY…
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import SafeImg from '@/components/shared/SafeImg'
import DragPerson from '@/components/shared/DragPerson'
import { toast } from '@/stores/useToastStore'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  FileDropZone,
  MAX_UPLOAD_BYTES,
  SelectedFileCard,
  extOf,
  fileToBase64,
  gasAction,
  humanSize,
  inputCls,
} from './shared'

/** Work-engine vocabulary — exact values, never relabeled. */
const CJIS_STATUSES = ['Pending', 'Clear', 'Verified', 'Disqualified'] as const
type CjisStatus = (typeof CJIS_STATUSES)[number]

export default function CjisUploadModal({
  open,
  onOpenChange,
  candidate,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: any | null
  onUploaded: (status: string, url: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<CjisStatus>('Clear')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const close = (o: boolean) => {
    if (!o) {
      setFile(null)
      setStatus('Clear')
      setError(null)
    }
    onOpenChange(o)
  }

  const pickFile = (f: File) => {
    if (extOf(f.name) !== 'pdf') {
      setError('PDF only — export the background report as a PDF first.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`File is too large (${humanSize(f.size)}) — the limit is 15MB.`)
      return
    }
    setError(null)
    setFile(f)
  }

  const submit = async () => {
    if (!file || !candidate || uploading) return
    setUploading(true)
    setError(null)
    try {
      const base64 = await fileToBase64(file)
      const data = await gasAction<{ cjis_status: string; cjis_report_url: string }>('cjisUpload', {
        candidate_id: candidate.id,
        filename: file.name,
        base64,
        status,
      })
      toast({
        type: 'success',
        title: 'Background result recorded',
        body: `${candidate.name} · ${data.cjis_status}`,
      })
      onUploaded(data.cjis_status, data.cjis_report_url)
      close(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DragPerson
              name={candidate?.name ?? ''}
              id={candidate?.id}
              avatar={candidate?.avatar}
              subtitle={candidate?.role}
              className="shrink-0"
            >
              <SafeImg src={candidate?.avatar} name={candidate?.name} size={40} shape="round" />
            </DragPerson>
            <div className="min-w-0 text-left">
              <DialogTitle className="font-display text-[18px] font-bold text-text-1">
                CJIS / Background result
              </DialogTitle>
              <DragPerson
                name={candidate?.name ?? ''}
                id={candidate?.id}
                avatar={candidate?.avatar}
                subtitle={candidate?.role}
                className="block"
              >
                <p className="clamp-1 text-[12px] font-medium text-text-3">
                  {candidate?.name ?? 'Candidate'}
                  {candidate?.role ? ` · ${candidate.role}` : ''}
                </p>
              </DragPerson>
            </div>
          </div>
          <DialogDescription className="text-[13px] text-text-2">
            Attach the background report PDF and record the result.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {file ? (
            <SelectedFileCard file={file} disabled={uploading} onRemove={() => setFile(null)} />
          ) : (
            <FileDropZone accept=".pdf,application/pdf" hint="PDF only · up to 15MB" disabled={uploading} onFile={pickFile} />
          )}

          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Background result</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CjisStatus)}
              disabled={uploading}
              className={cn(inputCls, 'disabled:opacity-50')}
            >
              {CJIS_STATUSES.map((s) => (
                <option key={s} value={s} className="text-text-1">
                  {s}
                </option>
              ))}
            </select>
            <span className="text-[11px] leading-4 text-text-3">
              Engine vocabulary — Clear or Verified unlocks the stage gate.
            </span>
          </label>

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-tint-pink px-3 py-2 text-[12px] font-medium text-tint-fg-pink">
              <AppIcon name="circle-alert" size={14} className="mt-[1px] shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={uploading}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!file || uploading}
            title={file ? undefined : 'Pick the report PDF first'}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="shield-plus" size={15} />
            {uploading ? 'Uploading…' : 'Upload report'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
