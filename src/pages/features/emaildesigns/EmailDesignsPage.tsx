// EMAIL DESIGNS — every letter the platform can write, rendered.
// An app that shows, on screen, every available e-mail layout RENDERED.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mail, RefreshCw, Send } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

type Design = { id: string; label: string; about: string; subject: string; html: string; text: string }

export default function EmailDesignsPage() {
  const myEmail = useAuthStore((s) => s.user?.email ?? '')
  const [designs, setDesigns] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<Record<string, 'html' | 'text'>>({})
  const [sending, setSending] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await gasAction<{ designs: Design[] }>('mailPreview', {})
      setDesigns(r.designs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The templates could not be rendered.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const sendMe = async (d: Design) => {
    setSending(d.id)
    try {
      const r = await gasAction<{ to: string; redirected?: boolean }>('mailPreviewSend', { design_id: d.id })
      toast({
        type: 'success',
        title: `Sent to ${r.to}`,
        body: r.redirected
          ? 'Test mode is on — it reached the testers instead, wearing the [TEST] strip.'
          : 'Open your mailbox — what Gmail draws is the rendering that counts.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not sent', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSending('')
    }
  }

  return (
    <div>
      <PageHeader
        title="Email Designs"
        subtitle="Every letter the platform can write — the real templates, rendered with sample people."
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Re-render
          </button>
        }
      />

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Rendering the letters…
        </p>
      ) : error ? (
        <div className="mt-6">
          <EmptyState title="The templates did not render" body={error} />
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {designs.map((d) => {
            const mode = view[d.id] ?? 'html'
            return (
              <article key={d.id} className="flex flex-col rounded-lg border border-border bg-surface shadow-1">
                <header className="flex flex-wrap items-start gap-2.5 border-b border-border px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-mint text-tint-fg-mint">
                    <Mail size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[13.5px] font-bold text-text-1">{d.label}</h2>
                    <p className="mt-0.5 text-[12px] leading-4 text-text-3">{d.about}</p>
                    <p className="mt-1 text-[11.5px] text-text-2">
                      <span className="font-semibold text-text-3">Subject · </span>{d.subject}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SegmentedTabs
                      tabs={[{ id: 'html', label: 'Layout' }, { id: 'text', label: 'Plain text' }]}
                      value={mode}
                      onChange={(id) => setView((v) => ({ ...v, [d.id]: id as 'html' | 'text' }))}
                    />
                    <button
                      onClick={() => void sendMe(d)}
                      disabled={!!sending || !myEmail.includes('@')}
                      title={myEmail.includes('@') ? `Send this design to ${myEmail}` : 'Your sign-in has no mailbox'}
                      className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      {sending === d.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Send me this
                    </button>
                  </div>
                </header>
                <div className={cn('min-h-0 flex-1', mode === 'html' ? 'bg-[#f5f6f8]' : 'bg-surface-2')}>
                  {mode === 'html' ? (
                    // sandbox with NO allowances: a template is platform-authored html, and the gallery still…
                    <iframe
                      title={d.label}
                      sandbox=""
                      srcDoc={d.html}
                      className="h-[520px] w-full border-0"
                    />
                  ) : (
                    <pre className="scroll-thin h-[520px] w-full overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-[12px] leading-5 text-text-1">
                      {d.text}
                    </pre>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
