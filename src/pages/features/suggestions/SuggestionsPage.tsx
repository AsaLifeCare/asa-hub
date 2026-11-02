// SUGGESTIONS: a field, a send.
// Anybody signed in writes one; the MASTER also sees the whole branch's list right here — everyone else never…
import { useEffect, useState } from 'react'
import { ohioDateTime } from '@/lib/ohio'
import { Lightbulb, Loader2, Send } from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import HelpfulContacts from './HelpfulContacts'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { useDraftGuard } from '@/lib/useDraftGuard'

type Suggestion = { id: string; at: string; by: string; email: string; role: string; text: string }

export default function SuggestionsPage() {
  const isMaster = useAuthStore((s) => s.user?.isMaster === true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Kept-copy paint: the master's list is a live GAS read with no slice, so "Reading…" used to run for a whole…
  const [rows, setRows] = useState<Suggestion[] | null>(() => {
    try { return JSON.parse(localStorage.getItem('asa:suggestions:rows') || 'null') as Suggestion[] | null }
    catch { return null }
  })

  // Unsaved-work reminder: anything typed in the box and not sent survives a navigation as a post-it sliver…
  useDraftGuard({ id: 'suggestion', label: 'An unsent suggestion', dirty: text.trim().length > 0 })

  const loadList = () => {
    gasAction<{ rows: Suggestion[] }>('suggestionsList', {})
      .then((d) => {
        const r = d.rows ?? []
        setRows(r)
        try { localStorage.setItem('asa:suggestions:rows', JSON.stringify(r)) } catch { /* quota — the paint stands */ }
      })
      .catch(() => setRows((cur) => cur ?? []))
  }
  useEffect(() => {
    if (isMaster) loadList()
  }, [isMaster])

  const send = async () => {
    const t = text.trim()
    if (t.length < 3 || busy) return
    setBusy(true)
    try {
      await gasAction('suggestionCreate', { text: t })
      toast({ type: 'success', title: 'Suggestion sent', body: 'Thank you — it lands with the right person.' })
      setText('')
      if (isMaster) loadList()
    } catch (e) {
      toast({ type: 'danger', title: 'Not sent', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    // FULL WIDTH — the whole side area is used: the form takes a column, the master's branch list takes the rest.
    <div className="w-full">
    <div className={isMaster ? 'flex w-full flex-col gap-4 lg:flex-row lg:items-start' : 'w-full'}>
      <Card className={isMaster ? 'w-full shrink-0 p-4 lg:w-[400px]' : 'w-full p-4'}>
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb size={16} className="text-warning" />
          <h1 className="text-[15px] font-bold text-text-1">Make a suggestion</h1>
        </div>
        <p className="mb-3 text-[12.5px] text-text-3">
          Anything — a screen that fights you, a step that could vanish, an idea. Signed with your name.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Write it the way you would say it…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none focus:border-primary"
        />
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => void send()}
            disabled={busy || text.trim().length < 3}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
          </button>
        </div>
      </Card>

      {isMaster && (
        <Card className="min-w-0 flex-1 p-0">
          <p className="border-b border-border px-4 py-3 text-[13.5px] font-bold text-text-1">
            The branch's suggestions {rows && <span className="ml-1 text-[12px] font-semibold text-text-3">{rows.length}</span>}
          </p>
          {rows === null ? (
            <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] italic text-text-3">Nothing yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {rows.map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                  {/* r.id is the suggestion's row id, never a person id — the
                      name is the identity Focus gets here. */}
                  <DragPerson name={r.by} subtitle={r.role || undefined} className="shrink-0">
                    <Avatar src="" name={r.by} size="sm" />
                  </DragPerson>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-text-3">
                      <DragPerson name={r.by} subtitle={r.role || undefined}>
                        <span className="font-semibold text-text-1">{r.by}</span>
                      </DragPerson>
                      {r.role && <span className="rounded bg-surface-3 px-1.5 text-[10.5px] font-semibold uppercase">{r.role}</span>}
                      <span>{ohioDateTime(r.at ?? '')}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-text-2">{r.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

    </div>

      {/* the numbers a shift actually dials — the old platform's block, this skin.
          Full width, below the row, whatever the viewer's role drew above. */}
      <HelpfulContacts />
    </div>
  )
}
