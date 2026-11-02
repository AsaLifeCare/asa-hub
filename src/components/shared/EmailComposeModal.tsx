// The platform's one e-mail dialog — mounted once, in Layout.
// Type who it goes to, adjust the words, send.
import { useEffect, useState } from 'react'
import { Loader2, Mail, Send, X } from 'lucide-react'
import { useEmailComposeStore } from '@/stores/useEmailComposeStore'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

const field =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary'

export default function EmailComposeModal() {
  const draft = useEmailComposeStore((s) => s.draft)
  if (!draft) return null
  // Remount per draft: the fields initialise FROM the draft in useState, so there is no state-sync effect to fire a…
  return <ComposerBody key={`${draft.source ?? ''}|${draft.subject ?? ''}`} draft={draft} />
}

function ComposerBody({ draft }: { draft: NonNullable<ReturnType<typeof useEmailComposeStore.getState>['draft']> }) {
  const closeCompose = useEmailComposeStore((s) => s.closeCompose)
  const [to, setTo] = useState(draft.to ?? '')
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && closeCompose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, closeCompose])

  const canSend = to.includes('@') && (subject.trim() || body.trim()) && !busy

  const send = async () => {
    setBusy(true)
    try {
      const r = await gasAction<{ sent: boolean; gated?: boolean; note?: string }>('platformMailSend', {
        to: to.trim(),
        subject: subject.trim(),
        body,
      })
      if (r.sent) {
        toast({ type: 'success', title: 'Sent', body: `asa-hub mailed ${to.trim()}.` })
        closeCompose()
      } else {
        toast({ type: 'warning', title: 'Not sent', body: r.note ?? 'Recorded, not sent.' })
        setBusy(false)
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Not sent', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={() => !busy && closeCompose()}>
      <div
        className="w-full max-w-[560px] rounded-lg border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-tint-blue text-tint-fg-blue">
            <Mail size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[14.5px] font-semibold text-text-1">Send by e-mail</p>
            <p className="clamp-1 text-[11.5px] text-text-3">
              From the platform — asa-hub{draft.source ? ` · ${draft.source}` : ''}
            </p>
          </div>
          <button
            onClick={() => !busy && closeCompose()}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2"
          >
            <X size={15} />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-text-3">To</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="who@example.org" autoFocus className={field} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-text-3">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.05em] text-text-3">Message</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className={cn(field, 'resize-y font-mono text-[13px] leading-5')} />
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-[11.5px] text-text-3">The recipient sees asa-hub, never your address.</p>
          <button
            onClick={() => void send()}
            disabled={!canSend}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-on-primary disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Sending…' : 'Send'}
          </button>
        </footer>
      </div>
    </div>
  )
}
