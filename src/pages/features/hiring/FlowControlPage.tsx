// FLOW CONTROL — the hiring machine's rhythm, as its own page.
// Flow Control left the Flow view for the Hiring Simulator app, which now holds both Simulations and Flow Control.
import { useEffect, useState } from 'react'
import { CircleAlert, Loader2, Mail, MessageSquare, Phone } from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import { gasAction } from '@/features/hiring/shared'
import { api } from '@/lib/api'
import { ohioDateTime } from '@/lib/ohio'
import { formatPhoneList } from '@/lib/phoneFormat'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'

// The same six stages the Flow board draws — a copy, so the bench never couples to the Flow view's internals.
const STAGES: { id: string; label: string; tint: TintName }[] = [
  { id: 'new', label: 'New', tint: 'blue' },
  { id: 'phone-screen', label: 'Phone Screen', tint: 'lavender' },
  { id: 'interview', label: 'Interview', tint: 'amber' },
  { id: 'onboarding', label: 'Onboarding', tint: 'peach' },
  { id: 'hired', label: 'Hired', tint: 'mint' },
  { id: 'ready', label: 'Ready to start', tint: 'blue' },
]

type FlowControlData = {
  stages: { id: string; purpose: string }[]
  situations: { id: string; label: string; enabled: boolean; kind: string; event: string; channels: string; to: string; days_before: string }[]
  ledger: {
    total: number
    bySituation: Record<string, { count: number; last: string }>
    byPerson: Record<string, { count: number; last: string }>
    recent: { situation: string; person: string; channel: string; at: string }[]
  }
  rehearsing: boolean
}

export default function FlowControlPage() {
  const [rows, setRows] = useState<{ id: string; stage: string }[]>([])
  const [data, setData] = useState<FlowControlData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api.list<{ id: string; stage: string }>('candidates')
      .then((r) => setRows(r ?? []))
      .catch(() => setRows([]))
    gasAction<FlowControlData>('hiringFlowControl', {})
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  const body = failed ? (
    <p className="py-8 text-center text-[13px] text-text-3">Flow Control could not be read.</p>
  ) : !data ? (
    <p className="flex items-center gap-2 py-10 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the rhythm…</p>
  ) : (() => {
    const stageOf: Record<string, string> = {}
    for (const r of rows) stageOf[r.id] = r.stage
    // messages that reached candidates, folded onto the stage they sit in NOW
    const perStage: Record<string, number> = {}
    for (const [cid, agg] of Object.entries(data.ledger.byPerson)) {
      const st = stageOf[cid]
      if (st) perStage[st] = (perStage[st] ?? 0) + agg.count
    }
    return (
      <div className="space-y-3">
        {data.rehearsing && (
          <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] font-semibold text-warning">
            <CircleAlert size={14} /> Test mode is ON — nothing below reaches anybody, testers included: every message is a row in the mock outbox, and the counts include rehearsals.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {STAGES.map((s) => {
            const purpose = data.stages.find((x) => x.id === s.id)?.purpose ?? ''
            const inStage = rows.filter((r) => r.stage === s.id).length
            return (
              <Card key={s.id} className="p-3">
                <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG[s.tint], TINT_FG[s.tint])}>{s.label}</span>
                <p className="mt-1.5 min-h-[32px] text-[11.5px] leading-4 text-text-3">{purpose}</p>
                <div className="mt-2 flex items-center gap-3 text-[12px] text-text-2">
                  <span className="font-bold text-text-1">{inStage}</span> candidates
                  <span className="flex items-center gap-1 text-text-3"><MessageSquare size={12} /> {perStage[s.id] ?? 0} messages</span>
                </div>
              </Card>
            )
          })}
        </div>

        <Card className="overflow-x-auto p-0">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <p className="text-[13px] font-bold text-text-1">Message rhythm — configured, and actually sent</p>
            <span className="text-[11.5px] text-text-3">{data.ledger.total} sends on the ledger</span>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-wide text-text-3">
                <th className="px-3 py-2">Situation</th>
                <th className="px-3 py-2">Switch</th>
                <th className="px-3 py-2">Channels</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2 text-right">Sent</th>
                <th className="px-3 py-2">Last</th>
              </tr>
            </thead>
            <tbody>
              {data.situations.map((s) => {
                const agg = data.ledger.bySituation[s.id]
                return (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[300px] truncate px-3 py-2 font-medium text-text-1" title={s.label}>{s.label}</td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-semibold', s.enabled ? 'text-success' : 'text-text-3')}>
                        <span className={cn('h-2 w-2 rounded-full', s.enabled ? 'bg-success' : 'bg-surface-3')} />
                        {s.enabled ? 'on' : 'off'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-2">{s.channels || '—'}</td>
                    <td className="px-3 py-2 text-text-2">{formatPhoneList(s.to) || 'the person'}</td>
                    <td className="px-3 py-2 text-right font-bold text-text-1">{agg?.count ?? 0}</td>
                    {/* the ledger's stamp on Ohio's clock — cutting the raw ISO
                        published UTC, an hour nobody in the company works in */}
                    <td className="px-3 py-2 text-[12px] text-text-3">{agg?.last ? ohioDateTime(agg.last) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-[11.5px] text-text-3">
            Texts and switches are edited in Settings → Smart Comms. The scheduling e-mail is the situation
            <span className="mx-1 rounded bg-surface-3 px-1 font-mono text-[11px]">hiring_event_scheduled</span>—
            off means scheduling still works and nobody is mailed.
          </p>
        </Card>

        {data.ledger.recent.length > 0 && (
          <Card className="p-0">
            <p className="border-b border-border px-3 py-2.5 text-[13px] font-bold text-text-1">Last sends</p>
            <div className="divide-y divide-border/60">
              {data.ledger.recent.map((r, i) => (
                <p key={i} className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-2">
                  {r.channel === 'email' ? <Mail size={12} className="text-text-3" /> : <Phone size={12} className="text-text-3" />}
                  <span className="font-medium text-text-1">{r.situation}</span>
                  <span className="text-text-3">→ {r.person}</span>
                  <span className="ml-auto text-text-3">{ohioDateTime(r.at)}</span>
                </p>
              ))}
            </div>
          </Card>
        )}
      </div>
    )
  })()

  return (
    <div className="w-full">
      <PageHeader
        title="Flow Control"
        subtitle="The machine's rhythm — stages, message situations and the send ledger, in one read."
      />
      <div className="mt-4">{body}</div>
    </div>
  )
}
