// Upload asset: the renewed card or certificate, filed through the same door the compliance record uses…
// The person is the server row's own, never typed here.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { fileToBase64, gasAction, humanSize, inferMime, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'

export type UploadAsk = { certs: string[]; uploadFor: string }

type Filed = { name: string; url: string; shared?: boolean }

/** Why this file cannot go, or '' when it can. */
export function uploadRefusal(file: { name: string; size: number; type: string }): string {
  const mime = inferMime(file as File)
  if (!(mime.startsWith('image/') || mime === 'application/pdf')) return 'Images and PDFs only.'
  if (file.size > MAX_UPLOAD_BYTES) return `${humanSize(file.size)} — up to 15MB.`
  return ''
}

export function UploadAssetBody({ ask, cert, onCert, busy, done, error, onPick }: {
  ask: UploadAsk
  cert: string
  onCert: (c: string) => void
  busy: boolean
  done: Filed | null
  error: string
  onPick: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-[1.55] text-text-2">
        Filed under <span className="font-semibold text-text-1">{ask.uploadFor}</span> in the compliance folder, beside
        the certification it renews. A photo or a PDF, up to 15MB.
      </p>
      {ask.certs.length > 1 ? (
        <label className="block text-[12px] font-semibold text-text-2">
          Certification
          <select value={cert} onChange={(e) => onCert(e.target.value)} aria-label="Certification"
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary">
            {ask.certs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      ) : (
        <p className="text-[12px] font-semibold text-text-2">Certification <span className="ml-1 font-normal text-text-1">{cert}</span></p>
      )}
      <button type="button" onClick={onPick} disabled={busy || !cert}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-primary px-4 text-[12.5px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose a file
      </button>
      {error && <p role="alert" className="text-[12.5px] text-[var(--danger)]">{error}</p>}
      {done && (
        <p className="text-[12.5px] text-[var(--success)]">
          {done.name} was filed in the compliance folder{done.shared ? ', with the shared Drive copy' : ''}.
        </p>
      )}
    </div>
  )
}

export default function UploadAssetSheet({ ask, onClose }: { ask: UploadAsk | null; onClose: () => void }) {
  const [cert, setCert] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Filed | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCert(ask?.certs[0] ?? '')
    setDone(null)
    setError('')
  }, [ask])

  const picked = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f || !ask || !cert) return
    const refused = uploadRefusal(f)
    if (refused) {
      setError(refused)
      return
    }
    setBusy(true)
    setError('')
    try {
      const base64 = await fileToBase64(f)
      const row = await gasAction<Filed>('certDocUpload', {
        person: ask.uploadFor, cert, base64, filename: f.name, mime: inferMime(f),
      })
      setDone({ name: f.name, url: row?.url ?? '', shared: row?.shared })
    } catch (e) {
      setError(e instanceof Error ? `The upload did not go through: ${e.message}` : 'The upload did not go through.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={ask !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface p-6 sm:max-w-[384px]">
        {ask && (
          <>
            <SheetHeader className="mb-3">
              <SheetTitle className="font-display text-[17px] font-bold text-text-1">Upload asset</SheetTitle>
              <SheetDescription className="text-[12px] text-text-3">The renewed card or certificate.</SheetDescription>
            </SheetHeader>
            <UploadAssetBody ask={ask} cert={cert} onCert={setCert} busy={busy} done={done} error={error}
              onPick={() => input.current?.click()} />
            <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={picked} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
