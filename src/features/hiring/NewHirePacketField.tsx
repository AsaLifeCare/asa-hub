// The New Hire packet, inside the intake form.
// Two ways this ends up satisfied, and the field shows whichever is true: - The person ALREADY signed in Dropbox…
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, FileCheck2, Loader2, Paperclip, X } from 'lucide-react'
import { gasAction } from './shared'
import { cn } from '@/lib/utils'

export type PacketProbe = { state: string; label: string; srid?: string }
export type PacketAttached = { file_id: string; verdict: 'match' | 'mismatch' | 'unreadable'; name_in_document?: string; message?: string }

export function NewHirePacketField({
  name,
  email,
  phone,
  live,
  attached,
  onAttached,
}: {
  name: string
  email: string
  phone: string
  live: boolean
  attached: PacketAttached | null
  onAttached: (a: PacketAttached | null) => void
}) {
  const [probe, setProbe] = useState<PacketProbe | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Ask as they type, but only once they have typed enough to be asking about somebody real — and debounced…
  useEffect(() => {
    if (!live) return
    const enough = name.trim().length > 3 || email.includes('@') || phone.replace(/\D/g, '').length >= 10
    if (!enough) { setProbe(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      gasAction<PacketProbe>('packetProbe', { name, email, phone })
        .then((r) => { if (!cancelled) setProbe(r) })
        .catch(() => { if (!cancelled) setProbe(null) })
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [name, email, phone, live])

  const pick = async (file: File) => {
    setBusy(true); setError('')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
        fr.onerror = () => reject(new Error('Could not read the file'))
        fr.readAsDataURL(file)
      })
      const res = await gasAction<PacketAttached>('packetAttach', {
        name: name.trim(), base64, filename: file.name, mime_type: file.type,
      })
      onAttached(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the packet.')
    } finally {
      setBusy(false)
    }
  }

  const alreadySigned = probe?.state === 'signed' || probe?.state === 'waived'

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-text-2">New Hire Packet</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">optional</span>
        {alreadySigned && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-tint-mint px-2 py-0.5 text-[10px] font-semibold text-tint-fg-mint">
            <Check size={11} strokeWidth={3} /> Already signed
          </span>
        )}
      </div>

      {alreadySigned ? (
        <p className="mt-1.5 text-[12px] leading-5 text-text-3">
          Found in Dropbox Sign — nothing to attach.
        </p>
      ) : attached ? (
        <div className="mt-2 flex items-start gap-2">
          <span
            className={cn(
              'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
              attached.verdict === 'match' ? 'bg-tint-mint text-tint-fg-mint' : 'bg-tint-amber text-tint-fg-amber',
            )}
          >
            {attached.verdict === 'match' ? <Check size={11} strokeWidth={3} /> : <AlertTriangle size={11} />}
          </span>
          <p className="flex-1 text-[12px] leading-5 text-text-2">
            {attached.message}
            {attached.verdict !== 'match' && (
              <span className="block text-text-3">It is attached either way — this is a check, not a rule.</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => onAttached(null)}
            aria-label="Remove the attached packet"
            className="shrink-0 rounded-sm p-1 text-text-3 hover:bg-surface-2 hover:text-text-1"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-[12px] leading-5 text-text-3">
            {probe && probe.state === 'unsigned'
              ? 'Their envelope exists but is not signed yet.'
              : 'No signed envelope found for this person — attach it here if you have it.'}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }}
          />
          <button
            type="button"
            disabled={busy || !name.trim() || !live}
            onClick={() => fileRef.current?.click()}
            title={!name.trim() ? 'Type the name first — the document is checked against it' : undefined}
            className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
            {busy ? 'Reading the document…' : 'Attach signed packet'}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-[12px] font-medium text-tint-fg-danger">{error}</p>}
      {!alreadySigned && !attached && (
        <p className="mt-2 flex items-center gap-1 text-[11px] leading-4 text-text-3">
          <FileCheck2 size={11} /> Leaving this empty does not hold the candidate back.
        </p>
      )}
    </div>
  )
}
