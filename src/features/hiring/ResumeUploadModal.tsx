// Resume upload — the big resume screen for a live pipeline candidate.
// Drag-and-drop (or click-to-pick) a PDF/DOC/DOCX up to 15MB, then send it base64-encoded via…
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
import {
  FileDropZone,
  MAX_UPLOAD_BYTES,
  SelectedFileCard,
  extOf,
  fileToBase64,
  gasAction,
  humanSize,
  inferMime,
} from './shared'

const ALLOWED_EXTS = ['pdf', 'doc', 'docx']

export default function ResumeUploadModal({
  open,
  onOpenChange,
  candidate,
  onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: any | null
  onUploaded: (resumeLink: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const close = (o: boolean) => {
    if (!o) {
      setFile(null)
      setError(null)
    }
    onOpenChange(o)
  }

  const pickFile = (f: File) => {
    if (!ALLOWED_EXTS.includes(extOf(f.name))) {
      setError('Unsupported file type — upload a PDF, DOC or DOCX resume.')
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
      const data = await gasAction<{ resume_link: string }>('resumeUpload', {
        candidate_id: candidate.id,
        email: candidate.email,
        filename: file.name,
        mime_type: inferMime(file),
        base64,
      })
      toast({
        type: 'success',
        title: 'Resume uploaded',
        body: `${candidate.name} · the file is linked on the candidate record.`,
      })
      onUploaded(data.resume_link)
      close(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DragPerson
              name={candidate?.name ?? ''}
              id={candidate?.id}
              avatar={candidate?.avatar}
              subtitle={candidate?.role}
              className="shrink-0"
            >
              <SafeImg src={candidate?.avatar} name={candidate?.name} size={44} shape="round" />
            </DragPerson>
            <div className="min-w-0 text-left">
              <DialogTitle className="font-display text-[18px] font-bold text-text-1">
                <DragPerson
                  name={candidate?.name ?? ''}
                  id={candidate?.id}
                  avatar={candidate?.avatar}
                  subtitle={candidate?.role}
                >
                  {candidate?.name ?? 'Candidate'}
                </DragPerson>
              </DialogTitle>
              <p className="clamp-1 text-[12px] font-medium text-text-3">{candidate?.role ?? ''}</p>
            </div>
          </div>
          <DialogDescription className="text-[13px] text-text-2">
            Upload the candidate's resume — it files into the talent drive and links back to this record.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {file ? (
            <SelectedFileCard file={file} disabled={uploading} onRemove={() => setFile(null)} />
          ) : (
            <FileDropZone
              accept=".pdf,.doc,.docx"
              hint="PDF, DOC or DOCX · up to 15MB"
              disabled={uploading}
              onFile={pickFile}
            />
          )}
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
            title={file ? undefined : 'Pick a resume file first'}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="upload" size={15} />
            {uploading ? 'Uploading…' : 'Upload resume'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
