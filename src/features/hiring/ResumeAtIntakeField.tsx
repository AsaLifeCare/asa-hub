// The resume, at the moment the candidate is typed in: a referral sometimes arrives with the complete CV already…
// A referral arrives however the person who sent it had it — an attachment forwarded from an email, or the whole CV…
import { useRef, useState } from 'react'
import { Check, FileText, Loader2, Paperclip, X } from 'lucide-react'
import { extOf, fileToBase64, gasAction, humanSize, inferMime, MAX_UPLOAD_BYTES } from './shared'
import { cn } from '@/lib/utils'

export type IntakeResume = { resume_link: string; filename: string }

const ACCEPT_EXT = new Set(['pdf', 'doc', 'docx'])

export function ResumeAtIntakeField({
  name,
  live,
  file,
  text,
  onFile,
  onText,
}: {
  name: string
  live: boolean
  file: IntakeResume | null
  text: string
  onFile: (r: IntakeResume | null) => void
  onText: (v: string) => void
}) {
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const pick = async (f: File) => {
    setError('')
    if (!ACCEPT_EXT.has(extOf(f.name))) {
      setError('PDF, DOC or DOCX only.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`File is ${humanSize(f.size)} — the limit is 15MB.`)
      return
    }
    setBusy(true)
    try {
      const base64 = await fileToBase64(f)
      const stored = await gasAction<{ resume_link: string; filename: string }>('resumeStore', {
        filename: f.name,
        mime_type: inferMime(f),
        base64,
      })
      onFile({ resume_link: stored.resume_link, filename: stored.filename || f.name })
      onText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not store the resume.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-text-2">Resume</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">optional</span>
        {!file && (
          <div className="ml-auto flex rounded-md border border-border p-0.5">
            {(['file', 'text'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'h-6 rounded-sm px-2 text-[11px] font-semibold transition-colors',
                  mode === m ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:text-text-1',
                )}
              >
                {m === 'file' ? 'File' : 'Paste text'}
              </button>
            ))}
          </div>
        )}
      </div>

      {file ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-tint-mint text-tint-fg-mint">
            <Check size={11} strokeWidth={3} />
          </span>
          <p className="min-w-0 flex-1 truncate text-[12px] text-text-2">{file.filename}</p>
          <button
            type="button"
            onClick={() => onFile(null)}
            aria-label="Remove the resume"
            className="shrink-0 rounded-sm p-1 text-text-3 hover:bg-surface-2 hover:text-text-1"
          >
            <X size={13} />
          </button>
        </div>
      ) : mode === 'file' ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void pick(f)
            }}
          />
          <button
            type="button"
            disabled={busy || !live}
            onClick={() => inputRef.current?.click()}
            title={live ? undefined : 'Available on the live pipeline'}
            className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
            {busy ? 'Storing…' : 'Attach resume'}
          </button>
        </>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => onText(e.target.value)}
            rows={4}
            placeholder={`Paste ${name.trim().split(/\s+/)[0] || 'their'} resume here — it is filed as a document on the card.`}
            className="mt-2 w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
          />
          {text.trim().length > 0 && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-text-3">
              <FileText size={11} /> {text.trim().length.toLocaleString()} characters — filed when the candidate is created.
            </p>
          )}
        </>
      )}
      {error && <p className="mt-2 text-[12px] font-medium text-tint-fg-danger">{error}</p>}
    </div>
  )
}
