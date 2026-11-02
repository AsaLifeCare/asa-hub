// Settings → Platform health (admins only, anchor #platformhealth).
// Three questions this platform could not answer from its own screens until now, and all three decide whether it is…
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, CheckCircle2, PlayCircle, Radio, ShieldAlert, ShieldCheck } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { readSlice } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

type Audit = {
  mode?: string
  actions_total?: number
  declared?: number
  undeclared_count?: number
  undeclared?: string[]
  invalid?: string[]
  by_lane?: Record<string, number>
}
type Abilities = { sending?: string; methods?: Record<string, { channel?: string; what?: string; reaches_a_person?: boolean }> }
type TestResult = { failures?: number; ran?: number; failed?: { check: string; detail: string }[]; live?: Record<string, number> }
type Traffic = {
  window_s?: number; slice_reads?: number; exec_reads?: number; exec_writes?: number
  exec_tools?: number; exec_share?: number | null; exec_share_covers?: string
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'plain' }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-text-3">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[18px] font-semibold leading-6',
          tone === 'good' && 'text-tint-fg-mint',
          tone === 'bad' && 'text-tint-fg-danger',
          (!tone || tone === 'plain') && 'text-text-1',
        )}
      >
        {value}
      </div>
    </div>
  )
}

export default function PlatformHealthSection() {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [rpc, setRpc] = useState<Abilities | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [running, setRunning] = useState(false)
  const [traffic, setTraffic] = useState<Traffic | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [a, r] = await Promise.all([
          gasAction('resolverAudit', {}),
          gasAction('rpcAbilities', {}),
        ])
        if (!alive) return
        setAudit(a as Audit)
        setRpc(r as Abilities)
        // Served as an ordinary admin-only slice, off the builder's disk — no execution spent to find out how many…
        const t = await readSlice<Traffic>('resolverHealth')
        if (alive && t?.length) setTraffic(t[0])
      } catch (err) {
        // Said plainly rather than shown as an empty card: a blank panel reads as "nothing wrong", which is the one…
        if (alive) setLoadError(String((err as Error)?.message || err))
      }
    })()
    return () => { alive = false }
  }, [])

  const runTest = async () => {
    setRunning(true)
    try {
      // Python's own checks (resolverHealth): every route the relay sends to Python against a door that answers it,
      // every declaration against its handler, every app's back-end
      const got = (await gasAction('resolverHealth', {})) as { checks?: TestResult } | null
      const r = got?.checks
      if (!r || typeof r.ran !== 'number') throw new Error('the health check came back without its checks')
      setTest(r)
      toast(
        r.failures === 0
          ? { type: 'success', title: 'Self-test passed', body: `${r.ran} checks, nothing failed.` }
          : { type: 'warning', title: `${r.failures} check(s) failed`, body: 'The list is below.' },
      )
    } catch (err) {
      toast({ type: 'danger', title: 'The self-test could not run', body: String((err as Error)?.message || err) })
    } finally {
      setRunning(false)
    }
  }

  const undeclared = audit?.undeclared_count ?? null
  const invalid = audit?.invalid?.length ?? 0
  const sending = rpc?.sending === 'on'
  const methods = Object.entries(rpc?.methods ?? {})

  return (
    <motion.section
      id="platformhealth"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card>
        <CardHeader
          title="Platform health"
          sub="What the resolver knows, what the platform may send, and whether the platform's own checks still hold."
          extra={<Activity size={16} className="text-text-3" />}
        />

        {loadError && (
          <p className="mt-3 text-[13px] text-tint-fg-danger">
            Could not read the platform state: {loadError}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Actions declared" value={audit ? `${audit.declared}/${audit.actions_total}` : '—'} />
          <Stat
            label="Undeclared"
            value={undeclared === null ? '—' : String(undeclared)}
            tone={undeclared === null ? 'plain' : undeclared === 0 ? 'good' : 'bad'}
          />
          <Stat label="Malformed" value={audit ? String(invalid) : '—'} tone={invalid ? 'bad' : 'good'} />
          <Stat label="Gate" value={audit?.mode === 'strict' ? 'strict' : audit ? 'audit' : '—'} />
        </div>

        {/* The lane split is the shape of the platform in one line: how much
            of it answers questions, how much changes things, how much is a
            job somebody waits on. */}
        {audit?.by_lane && (
          <p className="mt-3 text-[13px] text-text-2">
            {audit.by_lane.read ?? 0} answer questions · {audit.by_lane.write ?? 0} change something ·{' '}
            {audit.by_lane.tool ?? 0} are jobs a person waits on.
          </p>
        )}

        {undeclared !== null && undeclared > 0 && (
          <div className="mt-3 rounded-[12px] border border-border bg-tint-danger px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-tint-fg-danger">
              <ShieldAlert size={14} /> {undeclared} action(s) have no declared contract
            </div>
            <p className="mt-1 text-[12px] text-tint-fg-danger">
              {(audit?.undeclared ?? []).slice(0, 8).join(', ')}
              {(audit?.undeclared?.length ?? 0) > 8 ? ' …' : ''}
            </p>
          </div>
        )}

        {/* The one number worth tracking weekly. */}
        {traffic && (
          <div className="mt-4 rounded-[12px] border border-border bg-surface-2 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[11px] uppercase tracking-wide text-text-3">
                Requests still costing a Google execution
              </span>
              <span className="text-[18px] font-semibold leading-6 text-text-1">
                {traffic.exec_share == null ? '—' : `${Math.round(traffic.exec_share * 100)}%`}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-text-2">
              {(traffic.slice_reads ?? 0)} answered from a slice · {(traffic.exec_reads ?? 0)} reads,{' '}
              {(traffic.exec_writes ?? 0)} writes and {(traffic.exec_tools ?? 0)} tools reached the
              backend, over the last {Math.round((traffic.window_s ?? 0) / 60)} min.
            </p>
            {/* Said out loud: the builder's own calls are in neither term. */}
            {traffic.exec_share_covers && (
              <p className="mt-0.5 text-[11px] text-text-3">{traffic.exec_share_covers}</p>
            )}
          </div>
        )}

        {/* Sending */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Radio size={15} className={sending ? 'text-tint-fg-amber' : 'text-text-3'} />
            <span className="text-[13px] font-semibold text-text-1">
              Messages to people: {rpc ? (sending ? 'ON' : 'off') : '—'}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-text-2">
            {sending
              ? 'The platform will really text and e-mail people — the New Hire packet request and the overdue alert go out on their own.'
              : 'Nothing leaves the platform. Every message that would be sent is written to the system log instead, so it can be read before it is switched on.'}
          </p>
          {methods.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {methods.map(([name, m]) => (
                <li key={name} className="flex items-start gap-2 text-[12px] text-text-2">
                  {m.reaches_a_person ? (
                    <ShieldAlert size={13} className="mt-0.5 shrink-0 text-tint-fg-amber" />
                  ) : (
                    <ShieldCheck size={13} className="mt-0.5 shrink-0 text-text-3" />
                  )}
                  <span>
                    <span className="font-medium text-text-1">{name}</span> — {m.what}
                    <span className="text-text-3"> ({m.channel})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Self-test */}
        <div className="mt-5 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-text-1">Platform self-test</div>
              {/* The count below is the live number. */}
              <p className="mt-0.5 text-[13px] text-text-2">
                Every route the server sends to Python checked against a door that answers it, every door
                against its declaration, and every app against its back-end.
                It reads; it never writes, moves or sends.
              </p>
            </div>
            <button
              onClick={runTest}
              disabled={running}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <PlayCircle size={14} />
              {running ? 'Running…' : 'Run self-test'}
            </button>
          </div>

          {test && (
            <div className="mt-3">
              <div
                className={cn(
                  'flex items-center gap-1.5 text-[13px] font-semibold',
                  test.failures === 0 ? 'text-tint-fg-mint' : 'text-tint-fg-danger',
                )}
              >
                {test.failures === 0 ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
                {test.failures === 0
                  ? `All ${test.ran} checks passed`
                  : `${test.failures} of ${test.ran} checks failed`}
              </div>
              {!!test.live && Object.keys(test.live).length > 0 && (
                <p className="mt-1 text-[12px] text-text-3">
                  {Object.entries(test.live).map(([k, v]) => `${v} ${k}`).join(' · ')}
                </p>
              )}
              {(test.failed ?? []).map((f) => (
                <div key={f.check} className="mt-2 rounded-[10px] border border-border bg-surface-2 px-3 py-2">
                  <div className="text-[12px] font-semibold text-text-1">{f.check}</div>
                  <div className="mt-0.5 text-[12px] text-text-2">{f.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </motion.section>
  )
}
