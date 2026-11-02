// WHAT THE READINGS TAUGHT — the lab's learning panel.
// Can the decoder lab adapt as new readings land, and can it do so deterministically?
import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, GraduationCap, Lightbulb, Loader2, RefreshCw, X } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { authHeaders } from '@/lib/snapshotClient'
import { cn } from '@/lib/utils'

export type Proposal = {
  id: string; status: string; type: string; kind: string; category: string
  needles: string; file_hints: string; family: string; evidence_n: string
  coverage: string; leak: string; examples: string; ledger: string; notes: string
  decided_by?: string; decided_at?: string
}
type Answer = {
  status?: number; message?: string
  proposals?: Proposal[]; kinds?: string[]; categories?: string[]
  scan?: { proposed: number; written: number; kinds_known: number } | null
}

const chips = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(authHeaders() || {}), ...(init?.headers || {}) } })
  return (await r.json()) as T
}

export function ProposalsPane({ onKinds }: { onKinds?: (kinds: string[], categories: string[]) => void }) {
  const [data, setData] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [showDecided, setShowDecided] = useState(false)
  const [cats, setCats] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async (scan = false) => {
    setLoading(true); setErr('')
    try {
      const body = await call<Answer>(`/digest/proposals${scan ? '?scan=1' : ''}`)
      if (body.status && body.status !== 200) { setErr(body.message || `refused (${body.status})`); return }
      setData(body)
      onKinds?.(body.kinds || [], body.categories || [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'the server did not answer')
    } finally {
      setLoading(false)
    }
  }, [onKinds])

  useEffect(() => { void load(false) }, [load])

  const decide = useCallback(async (p: Proposal, action: 'approve' | 'reject') => {
    setBusyId(p.id); setErr('')
    try {
      const body = await call<{ status?: number; message?: string; proposal?: Proposal }>('/digest/proposals/decide', {
        method: 'POST', body: JSON.stringify({ id: p.id, action, category: cats[p.id] || p.category }),
      })
      if (body.status && body.status !== 200) { setErr(body.message || `refused (${body.status})`); return }
      setData((d) => d ? { ...d, proposals: (d.proposals || []).map((q) => q.id === p.id && body.proposal ? body.proposal : q) } : d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'the server did not answer')
    } finally {
      setBusyId('')
    }
  }, [cats])

  const proposals = data?.proposals || []
  const pending = proposals.filter((p) => p.status === 'proposed')
  const decided = proposals.filter((p) => p.status !== 'proposed')
  const categories = data?.categories || []

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardHeader
          title="What the readings taught"
          sub="families the decoder could not name, by their own letterhead — counted, never guessed. Approving writes one row in the words book."
        />
        <button
          type="button" disabled={loading}
          onClick={() => load(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          count again
        </button>
      </div>
      {data?.scan ? (
        <p className="mt-2 text-xs text-text-2">
          counted now: {data.scan.proposed} famil{data.scan.proposed === 1 ? 'y' : 'ies'} proposed, {data.scan.written} new, {data.scan.kinds_known} kinds in the book
        </p>
      ) : null}
      {err ? <p className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">{err}</p> : null}

      {!data && loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-text-2"><Loader2 className="h-4 w-4 animate-spin" /> reading the words book</div>
      ) : pending.length === 0 ? (
        <div className="mt-4 flex items-start gap-2 text-sm text-text-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
          Nothing to teach right now — every family the readings form is already in the book.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {pending.map((p) => (
            <li key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                  p.type === 'new' ? 'bg-tint-mint text-tint-fg-mint' : 'bg-tint-blue text-tint-fg-blue')}>
                  {p.type === 'new' ? 'new kind' : 'extends'}
                </span>
                <span className="font-mono text-sm font-semibold">{p.kind}</span>
                <select
                  value={cats[p.id] || p.category}
                  onChange={(e) => setCats((c) => ({ ...c, [p.id]: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                >
                  {(categories.includes(p.category) ? categories : [p.category, ...categories]).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <span className="text-xs text-text-2">
                  {p.evidence_n} reading{p.evidence_n === '1' ? '' : 's'} · in {Math.round(Number(p.coverage) * 100)}% of them, in {Math.round(Number(p.leak) * 1000) / 10}% of others
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" disabled={busyId === p.id} onClick={() => decide(p, 'approve')}
                          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} approve
                  </button>
                  <button type="button" disabled={busyId === p.id} onClick={() => decide(p, 'reject')}
                          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2 disabled:opacity-50">
                    <X className="h-3 w-3" /> reject
                  </button>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips(p.needles).map((n) => (
                  <span key={n} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{n}</span>
                ))}
                {chips(p.file_hints).map((h) => (
                  <span key={`h-${h}`} className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-text-2" title="title hint">{h}</span>
                ))}
              </div>
              <p className="mt-2 truncate text-xs text-text-2" title={p.examples}>
                e.g. {p.examples}{p.notes ? ` · ${p.notes}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 ? (
        <div className="mt-4">
          <button type="button" onClick={() => setShowDecided((v) => !v)}
                  className="flex items-center gap-1 text-xs text-text-2 hover:text-text-1">
            {showDecided ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {decided.length} decided
          </button>
          {showDecided ? (
            <ul className="mt-2 space-y-1">
              {decided.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-text-2">
                  <span className={cn('rounded px-1.5 py-0.5 font-semibold', p.status === 'approved' ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2')}>{p.status}</span>
                  <span className="font-mono">{p.kind}</span>
                  <span>{chips(p.needles).slice(0, 3).join(' · ')}</span>
                  <span className="ml-auto">{p.decided_by ? `by ${p.decided_by}` : ''} {p.decided_at ? p.decided_at.slice(0, 10) : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

export function TeachControl({ ledger, rowId, kinds, current }: {
  ledger: string; rowId: string; kinds: string[]; current?: string
}) {
  const [kind, setKind] = useState(current || '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { setKind(current || ''); setNote('') }, [current, rowId])

  const teach = useCallback(async () => {
    if (!kind) return
    setBusy(true); setNote('')
    try {
      const body = await call<{ status?: number; message?: string; filed?: string; written?: number; proposal?: Proposal | null }>('/digest/teach', {
        method: 'POST', body: JSON.stringify({ ledger, row_id: rowId, kind }),
      })
      if (body.status && body.status !== 200) { setNote(body.message || `refused (${body.status})`); return }
      setNote(body.proposal
        ? `filed as ${body.filed} · ${chips(body.proposal.needles).length} phrase(s) proposed for the family — approve them below`
        : `filed as ${body.filed} · this paper's first lines carry nothing distinctive to propose`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'the server did not answer')
    } finally {
      setBusy(false)
    }
  }, [kind, ledger, rowId])

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="h-4 w-4 text-text-2" />
        <span className="text-sm font-medium">Teach it</span>
        <span className="text-xs text-text-2">file this paper as</span>
        <input list="lab-kinds" value={kind} onChange={(e) => setKind(e.target.value)}
               placeholder="kind…" className="w-52 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs" />
        <datalist id="lab-kinds">{kinds.map((k) => <option key={k} value={k} />)}</datalist>
        <button type="button" disabled={busy || !kind || kind === current} onClick={teach}
                className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} file it
        </button>
      </div>
      <p className="mt-1.5 text-xs text-text-2">
        {note || 'The row is filed as you say and stays that way; its distinctive first lines become a proposal for the family.'}
      </p>
    </Card>
  )
}
