// THE HIRING SIMULATOR.
// A simulator identical to the real hiring process, run against the configured test e-mails and phone numbers so…
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowRight, BadgeCheck, Check, ChevronRight, CircleAlert,
  ChevronDown, Clock3, Loader2, Mail, MessageSquare, Play, RefreshCw, Settings2, Shield,
  Trash2, User, X,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { dropAlertsCache } from '@/lib/hiringAlerts'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'

// ------------------------------------------------------------------ what the backend hands over (HiringSim.gs)…

type SimStep = {
  id: string
  n: number
  title: string
  about: string
  // THE LOOP SIGN: steps that repeat themselves — a cut screening call asks for one more try and keeps watching…
  loop?: string
  // THE LONG HALF, HIDDEN UNTIL ASKED FOR — where a step is too large to print in full it is still described…
  more?: string[]
  action: string
  to: 'team' | 'candidate' | 'interviewer' | 'card'
  channel: string
  // THE MOCK — one press pretends a given person answered by e-mail: the rehearsal stands in for them and replies…
  pretend?: { channel: string; label: string; hint: string; preset?: string }
}

type JourneyLine = {
  id: string
  candidate_id: string
  name: string
  step: string
  title: string
  channel: string
  to: string
  ok: boolean
  detail: string
  ref: string
  rehearsal: boolean
  at: string
  by: string
}

type SimActors = {
  mode: 'actors' | 'redirect'
  screen_line: string
  watcher_emails: string[]
  candidate_email: string
  candidate_phone: string
  interviewer_name: string
  interviewer_email: string
  interviewer_phone: string
  cc_emails: string[]
  team_emails: string[]
  decider_emails: string[]
  team_sms: string[]
}

type SimAsk = {
  id: string
  step: string
  candidate_id: string
  sent: string
  max: string
  interval_minutes: string
  last_sent_at: string
  state: string
  answered_by: string
}

type SimBlock = {
  actors: SimActors
  attempts: Record<string, { attempts: number; minutes: number }>
  asks: SimAsk[]
  cfg: Record<string, string>
}

type SimState = {
  steps: SimStep[]
  flows?: { id: string; title: string; about?: string; steps: string[] }[]
  test_mode: { on: boolean; sms: string; email: string; mode?: 'actors' | 'redirect'; test_redirect_on?: boolean }
  sim: SimBlock | null
  team: { emails: string[]; names: Record<string, string> }
  interviewer: { name: string; email: string; phone: string; by: string; user_id?: string }
  interviewers: { user_id: string; name: string; email: string; phone: string; role: string; types: string }[]
  candidate: {
    id: string; name: string; phone: string; email: string
    status: string; stage: string; resume_link: string
    cjis: string; decision: string; screen_status: string; screen_result: string
  } | null
  gate: { from: string | null; to: string | null; ok: boolean; reasons: string[] } | null
  gates?: { from: string; to: string; ok: boolean; reasons: string[] }[] | null
  ask: {
    ask_id: string; state: string; picked_date: string; picked_time: string
    supervisor_reply: string; confirmed_date: string; confirmed_time: string
  } | null
  journey: JourneyLine[] | null
  journey_unreadable: boolean
  link_secret: boolean
}

/** What the backend's own walk came back with (HiringWalk.gs). */
type WalkReport = {
  ok?: boolean
  refused?: string
  failed: number
  truncated?: boolean
  ms?: number
  started_at: string
  candidate_id?: string
  link?: string
  next?: string
  journey?: number
  reported_to?: string
  checks: { name: string; ok: boolean; detail: string }[]
  steps: {
    step: string; action: string; status: number; ms: number
    sent: boolean | null; redirected: boolean; to: string; delivered_to: string
    reason: string; message: string; error: string
  }[]
}

// What one press came back with.
type StepResult = {
  ok: boolean
  at: string
  sent?: boolean
  redirected?: boolean
  to?: string
  delivered_to?: string
  subject?: string
  error?: string
  detail?: string
  reason?: string
  raw?: unknown
}

// ------------------------------------------------------------------ the branches drawn beside the spine (the small…

// A path that leaves the main line.
const BRANCHES: { after: string; label: string; tone: 'mint' | 'amber' | 'danger' }[] = [
  { after: 'shortlist', label: 'Initial e-mails', tone: 'mint' },
  { after: 'outreach_sms', label: 'Referral · e-mail only', tone: 'amber' },
  { after: 'schedule_invite', label: 'Scheduling exchange', tone: 'mint' },
  { after: 'interviewer_ask', label: 'No → three times offered', tone: 'amber' },
  { after: 'discarded', label: 'Candidate discarded', tone: 'danger' },
]

const TONE_RING: Record<string, string> = {
  mint: 'border-primary/40 bg-primary/5 text-primary',
  amber: 'border-warning/40 bg-warning/5 text-warning',
  danger: 'border-danger/40 bg-danger/5 text-danger',
}

/* ------------------------------------------------------------------ */

const btn = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors'
const btnGhost = `${btn} border border-border text-text-2 hover:bg-surface-2`
const btnGo = `${btn} bg-primary text-white hover:bg-primary/90 disabled:opacity-50`
const inputCls = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-1 outline-none focus:border-primary'

export default function SimulatorPage() {
  const role = useAuthStore((s) => s.user?.role)
  const writer = role === 'admin' || role === 'manager'

  const [state, setState] = useState<SimState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, StepResult>>({})
  const [discardReason, setDiscardReason] = useState('Rehearsal — walking the discard path')
  const [walkDiscard, setWalkDiscard] = useState(false)
  const [walk, setWalk] = useState<WalkReport | null>(null)
  const [openStep, setOpenStep] = useState('')
  // ONE FLOW PER TAB — each an ordered reading of the same shared steps, complete end to end, so the screen tells…
  const [flowId, setFlowId] = useState('main')
  const visibleSteps = useMemo<SimStep[]>(() => {
    if (!state) return []
    const flows = state.flows ?? []
    const active = flows.find((f) => f.id === flowId) ?? flows[0]
    if (!active) return state.steps
    return active.steps
      .map((id) => state.steps.find((s) => s.id === id))
      .filter((s): s is SimStep => !!s)
  }, [state, flowId])
  const spine = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    gasAction<SimState>('hiringSimState', {})
      .then((d) => setState(d))
      .catch((e) => toast({ type: 'danger', title: 'Could not read the simulator state',
                            body: e instanceof Error ? e.message : 'Try again.' }))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const cand = state?.candidate ?? null
  const testOn = !!state?.test_mode?.on

  // The payload each step presses with.
  const payloadFor = useCallback((s: SimStep): Record<string, unknown> => {
    const cid = cand?.id ?? ''
    switch (s.id) {
      case 'ask':
      case 'welcome': return {}
      case 'shortlist': return { limit: 5 }
      case 'interest': return {}
      // No `about` on purpose: the backend reads the CHOSEN GROUP off the conversation journey — 5 chosen, 5 in the…
      case 'interest_thanks': return { candidate_id: cid }
      case 'referral_arrives':
      case 'manual_add': return {}
      case 'sim_evidence': return { candidate_id: cid }
      case 'outreach_sms':
      case 'outreach_reply':
      case 'accepted':
      case 'screen_call':
      case 'screen_watch':
      case 'resume_request':
      case 'cjis_request':
      case 'cjis_recheck':
      case 'screen_seed':
      case 'screen_analyze':
      case 'decision_ask':
      case 'schedule_invite': return { candidate_id: cid }
      case 'phone_screen': return { candidate_id: cid, to_stage: 'phone-screen' }
      case 'interviewer_ask': return {}
      case 'discarded': return { candidate_id: cid, reason: discardReason }
      default: return { candidate_id: cid }
    }
  }, [cand, discardReason])

  // WHERE THIS STEP WILL WRITE, resolved from the configured cast: the rehearsal states that the address used is…
  const addressesFor = useCallback((s: SimStep): { to: string; cc: string } | null => {
    const a = state?.sim?.actors
    if (!a || a.mode !== 'actors') return null
    // NEVER THE SAME LIST TWICE — step 0 was unreadable because To and Cc printed the same three addresses).
    const minus = (list: string[], toStr: string) => {
      const have = new Set(toStr.toLowerCase().split(/[,·\s]+/).filter(Boolean))
      return list.filter((x) => !have.has(x.toLowerCase())).join(', ')
    }
    if (s.to === 'candidate') {
      const to = [a.candidate_email, s.channel.includes('sms') ? formatPhoneDisplay(a.candidate_phone) : ''].filter(Boolean).join(' · ')
      return { to, cc: minus(a.cc_emails, to) }
    }
    if (s.to === 'interviewer') {
      const to = [a.interviewer_email, formatPhoneDisplay(a.interviewer_phone)].filter(Boolean).join(' · ') || '(no interviewer actor configured)'
      return { to, cc: minus(a.cc_emails, to) }
    }
    if (s.to === 'team') {
      // team letters: To = the deciders, Cc = the watchers, nobody listed twice
      const sms = s.channel.includes('sms') && a.team_sms.length ? ' · sms: ' + a.team_sms.map(formatPhoneDisplay).join(', ') : ''
      const to = a.decider_emails.join(', ')
      return { to: to + sms, cc: minus(a.watcher_emails, to) }
    }
    return null
  }, [state])

  /** The attempt clock a step runs on, when it is a retryable one. */
  const RETRY_STEP: Record<string, string> = { ask: 'ask', shortlist: 'shortlist', outreach_sms: 'outreach', schedule_invite: 'invite' }
  const attemptsFor = useCallback((s: SimStep) => {
    const key = RETRY_STEP[s.id]
    if (!key || !state?.sim) return null
    const spec = state.sim.attempts[key]
    const ask = state.sim.asks.filter((x) => x.step === key).slice(-1)[0]
    return spec ? { ...spec, ask } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  /** One step, pressed. Returns the result so the whole walk can read it. */
  const press = async (s: SimStep): Promise<StepResult> => {
    try {
      const d = await gasAction<Record<string, unknown>>(s.action, payloadFor(s))
      const r: StepResult = {
        ok: true,
        at: new Date().toISOString(),
        sent: typeof d?.sent === 'boolean' ? (d.sent as boolean) : undefined,
        redirected: d?.redirected as boolean | undefined,
        to: d?.to as string | undefined,
        delivered_to: d?.delivered_to as string | undefined,
        subject: d?.subject as string | undefined,
        error: d?.error as string | undefined,
        detail: d?.detail as string | undefined,
        reason: d?.reason as string | undefined,
        raw: d,
      }
      setResults((p) => ({ ...p, [s.id]: r }))
      return r
    } catch (e) {
      const r: StepResult = { ok: false, at: new Date().toISOString(),
                              error: e instanceof Error ? e.message : 'the call failed' }
      setResults((p) => ({ ...p, [s.id]: r }))
      return r
    }
  }

  const run = async (s: SimStep) => {
    if (!s.action || busy) return
    setBusy(s.id)
    await press(s)
    setOpenStep(s.id)
    load()
    setBusy('')
  }

  // THE WHOLE WALK — ONE CALL.
  const runAll = async () => {
    if (busy || !state) return
    setBusy('walk')
    try {
      const d = await gasAction<WalkReport>('hiringWalkRun', {
        candidate_id: cand?.id ?? '',
        include_discard: walkDiscard,
        tear_down: false,
      })
      setWalk(d)
      // Every step the walk pressed lands on the same result blocks a single press would have filled, so the column…
      const byStep: Record<string, StepResult> = {}
      for (const st of d.steps ?? []) {
        byStep[st.step] = {
          ok: st.status === 200 && !st.error,
          at: d.started_at,
          sent: st.sent === null ? undefined : st.sent,
          redirected: st.redirected,
          to: st.to,
          delivered_to: st.delivered_to,
          reason: st.reason,
          detail: st.message || st.error,
          raw: st,
        }
      }
      setResults((p) => ({ ...p, ...byStep }))
      load()
      toast({
        type: d.failed ? 'danger' : 'success',
        title: d.refused
          ? 'The walk refused to start'
          : `The walk finished — ${(d.checks ?? []).length} checks, ${d.failed} failed`,
        body: d.refused
          ? d.refused
          : `${Math.round((d.ms ?? 0) / 1000)}s, one execution.` +
            (d.truncated ? ' It stopped early against its own budget.' : ''),
      })
    } catch (e) {
      toast({ type: 'danger', title: 'The walk could not run',
              body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  const seed = async (fresh: boolean) => {
    setBusy('seed')
    try {
      const d = await gasAction<{ candidate_id: string; created: boolean }>('hiringSimSeed', { fresh })
      toast({ type: 'success', title: d.created ? 'Rehearsal card created' : 'Rehearsal card found',
              body: d.candidate_id })
      load()
    } catch (e) {
      toast({ type: 'danger', title: 'The rehearsal card was refused',
              body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const tearDown = async () => {
    if (!cand) return
    setBusy('reset')
    try {
      const d = await gasAction<{ removed: Record<string, number> }>('hiringSimReset', { candidate_id: cand.id })
      const n = Object.values(d.removed ?? {}).reduce((a, b) => a + b, 0)
      toast({ type: 'success', title: 'Rehearsal removed', body: `${n} row(s) across ${Object.keys(d.removed ?? {}).length} tab(s).` })
      setResults({})
      load()
    } catch (e) {
      toast({ type: 'danger', title: 'Tear-down refused',
              body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const journeyByStep = useMemo(() => {
    const idx: Record<string, JourneyLine[]> = {}
    for (const l of state?.journey ?? []) (idx[l.step] ??= []).push(l)
    return idx
  }, [state])

  if (!writer) {
    return (
      <Card className="p-6">
        <p className="text-[13.5px] text-text-2">
          The simulator sends real messages on the platform’s behalf. It is open to admins and
          managers.
        </p>
      </Card>
    )
  }

  return (
    <div>
      {/* ---------------------------------------------------------- */}
      {/* the header                                                  */}
      {/* ---------------------------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <h1 className="text-[17px] font-bold text-text-1">Simulator</h1>
          <p className="max-w-[70ch] text-[12.5px] text-text-3">
            The whole hiring process, walked one step at a time against a rehearsal card. Every
            step below presses the same action the real pipeline presses — nothing here is a
            mock-up of it.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-text-2" title="The discard takes the card off the board, so the walk leaves it out unless you say otherwise.">
            <input
              type="checkbox"
              checked={walkDiscard}
              onChange={(e) => setWalkDiscard(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            include the discard
          </label>
          {/* the redirect switch, right where the rehearsal runs — one
              button at the top, on or off. OFF is the
              loud state — letters reach their REAL recipients. */}
          <button
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-semibold ${
              state?.test_mode?.test_redirect_on
                ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20'
                : 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20'
            }`}
            title={state?.test_mode?.test_redirect_on
              ? 'Test mode is ON — every send folds into the listed testers. Press to switch it OFF (real recipients).'
              : 'Test mode is OFF — letters reach their REAL recipients (the [TEST] subject tag stays). Press to switch it ON.'}
            onClick={async () => {
              if (busy || !state) return
              setBusy('testmode')
              try {
                const next = state.test_mode?.test_redirect_on ? 'off' : 'on'
                await gasAction('hiringAlertsSet', { values: { test_mode: next } })
                // THE MOST IMPORTANT CACHE DROP ON THE PLATFORM: this switch decides whether letters reach real…
                dropAlertsCache()
                toast({
                  type: next === 'off' ? 'warning' : 'success',
                  title: `Test mode ${next.toUpperCase()}`,
                  body: next === 'off'
                    ? 'Letters now reach their REAL recipients — the [TEST] subject tag stays on rehearsals.'
                    : 'Every send now folds into the listed testers.',
                })
                load()
              } catch (e) {
                toast({ type: 'danger', title: 'Could not switch test mode', body: e instanceof Error ? e.message : 'Try again.' })
              } finally { setBusy('') }
            }}
            disabled={!!busy || !state}
          >
            <Shield size={13} /> Test mode: {state?.test_mode?.test_redirect_on ? 'ON' : 'OFF'}
          </button>
          <button className={btnGo} onClick={runAll} disabled={!!busy || !testOn}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run the whole walk
          </button>
          <button
            className={btnGhost}
            title="Read the deciders’ replies now, then re-send whatever is unanswered and under its attempt ceiling."
            onClick={async () => {
              setBusy('retry')
              try {
                const d = await gasAction<{ open: number; resent: number; exhausted: number; answered: number }>('hiringSimRetryNow', {})
                toast({ type: 'success', title: 'Retry pass ran',
                        body: `${d.open} open · ${d.resent} re-sent · ${d.answered} answered · ${d.exhausted} exhausted.` })
                load()
              } catch (e) {
                toast({ type: 'danger', title: 'The retry pass failed', body: e instanceof Error ? e.message : 'Try again.' })
              } finally { setBusy('') }
            }}
            disabled={!!busy}
          >
            <Clock3 size={13} /> Retry pass
          </button>
          <button className={btnGhost} onClick={load} disabled={!!busy}>
            <RefreshCw size={13} className={busy === '' ? '' : 'animate-spin'} /> Refresh
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* the safety banner — mode-aware                              */}
      {/* ---------------------------------------------------------- */}
      {!loading && (
        <div
          className={cn(
            'mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3',
            testOn ? 'border-primary/40 bg-primary/5' : 'border-danger/50 bg-danger/5',
          )}
        >
          {testOn ? <Shield size={16} className="text-primary" /> : <AlertTriangle size={16} className="text-danger" />}
          <div className="min-w-0">
            {state?.test_mode.mode === 'actors' ? (
              <>
                <p className={cn('text-[13.5px] font-bold', testOn ? 'text-primary' : 'text-danger')}>
                  {testOn ? 'ACTORS MODE — real sends, one mailbox per actor' : 'ACTORS MODE — the cast is incomplete'}
                </p>
                <p className="text-[12px] text-text-2">
                  {testOn ? (
                    <>The candidate is <b>{state?.test_mode.email}</b> / <b>{formatPhoneDisplay(state?.test_mode.sms)}</b>,
                      the interviewer is <b>{state?.sim?.actors.interviewer_email || '—'}</b>, and every
                      letter carries <b>{state?.sim?.actors.cc_emails.join(', ')}</b> in copy.
                      These are REAL deliveries — the team reads its own mail.</>
                  ) : (
                    <>Fill sim_candidate_email and sim_candidate_phone in the configuration below —
                      the rehearsal card IS those mailboxes, and nothing runs without them.</>
                  )}
                  {state?.test_mode.test_redirect_on && (
                    <> <b className="text-warning">Note:</b> test mode is ALSO on, so the redirect folds
                      every actor into the listed testers — switch it off in Settings to see each
                      mailbox receive its own half.</>
                  )}
                </p>
              </>
            ) : (
              <>
                <p className={cn('text-[13.5px] font-bold', testOn ? 'text-primary' : 'text-danger')}>
                  {testOn ? 'Test mode is ON — nothing reaches a real person' : 'TEST MODE IS OFF'}
                </p>
                <p className="text-[12px] text-text-2">
                  {testOn ? (
                    <>Every text goes to <b>{formatPhoneDisplay(state?.test_mode.sms)}</b> and every e-mail to{' '}
                      <b>{state?.test_mode.email}</b>, whatever address the step is addressed to.</>
                  ) : (
                    <>Turn it on in Settings before running anything here: the steps below send real
                      messages, and the redirect is the only thing between this rehearsal and a real
                      candidate.</>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* the simulation config — every parameter is a field          */}
      {/* ---------------------------------------------------------- */}
      {!loading && state?.sim && (
        <SimConfigPanel cfg={state.sim.cfg} onSaved={load} />
      )}

      {/* ---------------------------------------------------------- */}
      {/* THE FLOW TABS — one complete story per tab                  */}
      {/* ---------------------------------------------------------- */}
      {!loading && state && (state.flows?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {state.flows!.map((f) => (
            <button
              key={f.id}
              title={f.about ?? ''}
              onClick={() => setFlowId(f.id)}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold ${
                (state.flows!.some((x) => x.id === flowId) ? flowId : state.flows![0].id) === f.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-line bg-surface-2/50 text-text-2 hover:bg-surface-2'
              }`}
            >
              {f.title}
            </button>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* THE SMALL MAP — the same flow, with the branches beside it  */}
      {/* ---------------------------------------------------------- */}
      {!loading && state && (
        <Card className="mb-4 overflow-x-auto p-0">
          <div className="flex items-stretch gap-1 px-3 py-3">
            {visibleSteps.map((s, i) => {
              const done = !!results[s.id]?.ok || (journeyByStep[s.id]?.length ?? 0) > 0
              const branch = BRANCHES.find((b) => b.after === s.id)
              return (
                <div key={s.id} className="flex items-stretch gap-1">
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => {
                        setOpenStep(s.id)
                        document.getElementById(`step-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }}
                      className={cn(
                        'flex h-8 min-w-[104px] items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors',
                        done
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                      )}
                      title={s.about}
                    >
                      {done ? <Check size={11} /> : <span className="tabular-nums opacity-60">{i + 1}</span>}
                      <span className="truncate">{s.title}</span>
                    </button>
                    {branch && (
                      <div className={cn('flex h-6 min-w-[104px] items-center gap-1 rounded-md border px-2 text-[10.5px] font-semibold',
                        TONE_RING[branch.tone])}>
                        <ChevronRight size={10} />
                        <span className="truncate">{branch.label}</span>
                      </div>
                    )}
                  </div>
                  {i < visibleSteps.length - 1 && (
                    <ArrowRight size={12} className="mt-2.5 shrink-0 self-start text-text-3" />
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {loading && (
        <Card className="p-8 text-center text-[13px] text-text-3">
          <Loader2 size={16} className="mx-auto mb-2 animate-spin" /> Reading the pipeline…
        </Card>
      )}

      {!loading && state && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* -------------------------------------------------- */}
          {/* THE FLOW — top to bottom, no ceiling                */}
          {/* -------------------------------------------------- */}
          <div ref={spine} className="flex flex-col gap-3">
            {visibleSteps.map((s, i) => (
              <StepBlock
                key={s.id}
                step={s}
                num={i + 1}
                last={i === visibleSteps.length - 1}
                busy={busy === s.id}
                disabled={!!busy || (!cand &&
                  ['ask', 'welcome', 'shortlist', 'interest', 'referral_arrives', 'manual_add'].indexOf(s.id) === -1)}
                result={results[s.id]}
                addresses={addressesFor(s)}
                attempts={attemptsFor(s)}
                personas={
                  s.pretend?.channel === 'team'
                    ? [...(state.sim?.actors.decider_emails ?? []), ...(state.sim?.actors.watcher_emails ?? [])]
                    : s.pretend?.channel === 'candidate'
                      ? [state.sim?.actors.candidate_email ?? ''].filter(Boolean)
                      : s.pretend?.channel === 'interviewer'
                        ? [state.sim?.actors.interviewer_email ?? ''].filter(Boolean)
                        : []
                }
                presetText={s.pretend?.preset ? (state.sim?.cfg?.[s.pretend.preset] ?? '') : ''}
                onPretend={async (from, text) => {
                  if (busy) return
                  setBusy(s.id)
                  try {
                    const d = await gasAction<Record<string, unknown>>('hiringSimPretendReply', {
                      channel: s.pretend?.channel ?? '', from, text, candidate_id: cand?.id ?? '',
                    })
                    setResults((prev) => ({ ...prev, [s.id]: {
                      ok: true, at: new Date().toISOString(),
                      detail: String(d.note ?? d.acted ?? d.message ?? ''),
                      reason: d.read_as ? `read as: ${String(d.read_as)}` : undefined,
                      raw: d,
                    } }))
                    setOpenStep(s.id)
                    load()
                  } catch (e) {
                    setResults((prev) => ({ ...prev, [s.id]: {
                      ok: false, at: new Date().toISOString(),
                      error: e instanceof Error ? e.message : 'the pretend failed',
                    } }))
                  } finally { setBusy('') }
                }}
                lines={journeyByStep[s.id] ?? []}
                open={openStep === s.id}
                onToggle={() => setOpenStep((v) => (v === s.id ? '' : s.id))}
                onRun={() => run(s)}
                branch={BRANCHES.find((b) => b.after === s.id)}
                extra={
                  s.id === 'discarded' ? (
                    <label className="mt-2 block">
                      <span className="mb-1 block text-[11.5px] font-semibold text-text-2">
                        Reason (it is written on the row and named in the letter)
                      </span>
                      <input
                        className={inputCls}
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                      />
                    </label>
                  ) : s.id === 'cjis_request' ? (
                    <p className="mt-2 max-w-[70ch] rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[11.5px] leading-[18px] text-text-3">
                      The press looks in the designated docs folder FIRST — a report already
                      there is attached and nobody is asked. Otherwise the question goes to
                      the deciders, e-mail and Quo text together: “did the candidate send it
                      to you?” A YES fills the dot (On file); a no changes nothing — CJIS
                      never blocks the ladder. In the rehearsal the SIM acting as Arthur
                      answers by itself and puts a (SIM) file in the folder.
                    </p>
                  ) : s.id === 'schedule_invite' && !state.link_secret ? (
                    <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-warning">
                      INTERVIEW_LINK_SECRET is not set in Script Properties, so the invite has
                      nothing to sign the link with and this step will answer{' '}
                      <code>no_link_secret</code> without sending.
                    </p>
                  ) : null
                }
              />
            ))}
          </div>

          {/* -------------------------------------------------- */}
          {/* the state, beside it                                */}
          {/* -------------------------------------------------- */}
          <div className="flex flex-col gap-3 xl:sticky xl:top-3 xl:self-start">
            <Card className="p-3">
              <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-text-1">
                <User size={13} /> The rehearsal card
              </h2>
              {cand ? (
                <div className="space-y-1 text-[12.5px]">
                  <p className="font-semibold text-text-1">
                    {/* a rehearsal card is still a real row with a real id */}
                    <DragPerson name={cand.name} id={cand.id} type="staff" subtitle={cand.stage || cand.status}>{cand.name}</DragPerson>
                  </p>
                  <p className="text-text-3">{cand.id}</p>
                  <Row k="Stage" v={cand.stage || cand.status} />
                  <Row k="Phone" v={formatPhoneDisplay(cand.phone)} />
                  <Row k="E-mail" v={cand.email} />
                  <Row k="CJIS" v={cand.cjis || '—'} />
                  <Row k="Resume decision" v={cand.decision || '—'} />
                  <Row k="Screen" v={[cand.screen_status, cand.screen_result].filter(Boolean).join(' · ') || '—'} />
                  <div className="mt-2 flex gap-2">
                    <button className={btnGhost} onClick={() => seed(true)} disabled={!!busy}>
                      <RefreshCw size={12} /> New card
                    </button>
                    <button
                      className={`${btn} border border-danger/40 text-danger hover:bg-danger/5`}
                      onClick={tearDown}
                      disabled={!!busy}
                    >
                      <Trash2 size={12} /> Tear down
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-text-2">
                    No rehearsal card yet — <b>it is born from the choice</b>: when a decider
                    names the winners at step 2, the card fills itself with the first chosen
                    name, on the actor mailboxes. Its name starts with <b>[TEST]</b>, which is
                    what stops the graduation ever minting a staff account from it. The button
                    below is the by-hand door for skipping steps 0–2.
                  </p>
                  <button className={btnGo} onClick={() => seed(false)} disabled={!!busy || !testOn}>
                    {busy === 'seed' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    Create the rehearsal card
                  </button>
                </div>
              )}
              {/* WHO THIS REHEARSAL USES — the rehearsal card names the
                  people standing in for the test: the cast, and
                  the fence that keeps every send inside it. */}
              {state.sim && (
                <div className="mt-3 border-t border-line pt-2 text-[12px]">
                  <p className="mb-1 font-semibold text-text-2">The cast in use</p>
                  <Row k="Candidate" v={[state.sim.actors.candidate_email, formatPhoneDisplay(state.sim.actors.candidate_phone)].filter(Boolean).join(' · ')} />
                  <Row k="Interviewer" v={[state.sim.actors.interviewer_email, formatPhoneDisplay(state.sim.actors.interviewer_phone)].filter(Boolean).join(' · ') || state.sim.actors.interviewer_name} />
                  <Row k="Deciders (To)" v={state.sim.actors.decider_emails.join(', ')} />
                  <Row k="Watcher (Cc)" v={state.sim.actors.watcher_emails.join(', ')} />
                  <Row k="Team Quo" v={state.sim.actors.team_sms.map(formatPhoneDisplay).join(', ')} />
                  {(state.sim.cfg?.sim_outbound_guard ?? 'on') !== 'off' ? (
                    <p className="mt-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11.5px] text-text-2">
                      <b>Fence ON</b> — only these addresses and numbers can be written to.
                      Anything outside the cast is refused, even with test mode off.
                    </p>
                  ) : (
                    <p className="mt-1.5 rounded-md border border-danger/40 bg-danger/5 px-2 py-1 text-[11.5px] text-danger">
                      <b>Fence OFF</b> — sends can leave for ANY address (production shape).
                    </p>
                  )}
                </div>
              )}
            </Card>

            {walk && (
              <Card className="p-3">
                <h2 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-text-1">
                  {walk.failed ? <CircleAlert size={13} className="text-danger" />
                               : <Check size={13} className="text-primary" />}
                  The walk
                </h2>
                {walk.refused ? (
                  <p className="text-[12.5px] text-danger">{walk.refused}</p>
                ) : (
                  <>
                    <p className="text-[12.5px] text-text-2">
                      {walk.checks.length - walk.failed} of {walk.checks.length} checks passed
                      {walk.ms ? ` · ${Math.round(walk.ms / 1000)}s, one execution` : ''}
                    </p>
                    {walk.truncated && (
                      <p className="mt-1 text-[12px] text-warning">
                        It stopped early against its own four-minute budget. What is below is what
                        finished — it says so rather than looking complete.
                      </p>
                    )}
                    {walk.next && <p className="mt-1 text-[12px] text-text-2">{walk.next}</p>}
                    {walk.link && (
                      <a href={walk.link} target="_blank" rel="noreferrer"
                         className="mt-1 block break-all text-[12px] font-semibold text-primary">
                        open the candidate’s page
                      </a>
                    )}
                    <ul className="mt-2 max-h-[320px] space-y-1 overflow-y-auto">
                      {walk.checks.map((c, i) => (
                        <li key={i} className="flex gap-1.5">
                          {c.ok ? <Check size={12} className="mt-0.5 shrink-0 text-primary" />
                                : <X size={12} className="mt-0.5 shrink-0 text-danger" />}
                          <span className="min-w-0">
                            <span className={cn('text-[12px]', c.ok ? 'text-text-2' : 'font-semibold text-danger')}>
                              {c.name}
                            </span>
                            {c.detail && <span className="block text-[11.5px] text-text-3">{c.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {walk.reported_to && (
                      <p className="mt-2 text-[11.5px] text-text-3">
                        The report was e-mailed to {walk.reported_to}.
                      </p>
                    )}
                  </>
                )}
              </Card>
            )}

            {(state.gates?.length || state.gate) && (
              <Card className="p-3">
                <h2 className="mb-1.5 text-[13px] font-bold text-text-1">
                  {state.gates?.length ? 'The gates — the whole ladder' : 'The gate, right now'}
                </h2>
                {state.gates?.length ? (
                  // EVERY RUNG: climbed ✓ · current amber with what is missing · ahead grey with what it will ask…
                  <div className="space-y-1.5">
                    {state.gates.map((g) => {
                      const order = ['new', 'phone-screen', 'interview', 'onboarding', 'hired']
                      const ci = order.indexOf(cand?.stage ?? '')
                      const gi = order.indexOf(g.from)
                      const climbed = ci > gi || (cand?.stage ?? '') === 'ready'
                      const isCurrent = gi === ci
                      return (
                        <div key={g.from}>
                          <p className={`flex items-center gap-1.5 text-[12.5px] ${
                            climbed ? 'text-primary'
                            : isCurrent ? (g.ok ? 'font-semibold text-primary' : 'font-semibold text-warning')
                            : 'text-text-3'
                          }`}>
                            {climbed ? <Check size={13} className="shrink-0" />
                              : isCurrent
                                ? (g.ok ? <Check size={13} className="shrink-0" />
                                        : <CircleAlert size={13} className="shrink-0" />)
                                : <span className="inline-block h-[13px] w-[13px] shrink-0 text-center leading-[13px]">○</span>}
                            <span>{g.from} <ArrowRight size={10} className="inline" /> {g.to || '—'}</span>
                            {isCurrent && <span className="text-[10.5px] font-normal text-text-3">· now</span>}
                            {climbed && <span className="text-[10.5px] font-normal text-text-3">· done</span>}
                            {isCurrent && g.ok && <span className="text-[10.5px] font-normal">· ready to move</span>}
                          </p>
                          {!climbed && !g.ok && g.reasons.length > 0 && (
                            <ul className="ml-5 mt-0.5 space-y-0.5">
                              {g.reasons.map((r, i) => (
                                <li key={i} className={`flex gap-1.5 text-[11.5px] ${isCurrent ? 'text-warning' : 'text-text-3'}`}>
                                  <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-current" />
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : state.gate ? (
                  <>
                    <p className="text-[12.5px] text-text-2">
                      {state.gate.from ?? '—'} <ArrowRight size={11} className="inline" />{' '}
                      {state.gate.to ?? '—'}
                    </p>
                    {state.gate.ok ? (
                      <p className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-primary">
                        <Check size={13} /> it would allow the move
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {state.gate.reasons.map((r, i) => (
                          <li key={i} className="flex gap-1.5 text-[12px] text-warning">
                            <CircleAlert size={12} className="mt-0.5 shrink-0" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : null}
              </Card>
            )}

            <Card className="p-3">
              <h2 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-text-1">
                <BadgeCheck size={13} /> Who answers
              </h2>
              <p className="text-[12px] text-text-3">The interviewer, found by badge</p>
              <p className="text-[12.5px] font-semibold text-text-1">
                <DragPerson name={state.interviewer.name} id={state.interviewer.user_id} type="staff" subtitle="Holds the INTERVIEWER badge">
                  {state.interviewer.name || 'nobody holds the INTERVIEWER badge'}
                </DragPerson>
              </p>
              <p className="text-[12px] text-text-2">{state.interviewer.email || '—'}</p>
              <p className="mt-0.5 text-[11.5px] italic text-text-3">{state.interviewer.by}</p>
              {state.interviewers.length > 1 && (
                <p className="mt-1 text-[11.5px] text-text-3">
                  {state.interviewers.length} people hold the badge:{' '}
                  {/* joined into one string, none of the badge holders could be
                      picked up — the comma is now between elements, not inside
                      a sentence */}
                  {state.interviewers.map((p, i) => (
                    <Fragment key={p.user_id || p.email || i}>
                      {i > 0 ? ', ' : ''}
                      <DragPerson name={p.name || p.email} id={p.user_id} type="staff" subtitle={p.role || 'holds the INTERVIEWER badge'}>
                        {p.name || p.email}
                      </DragPerson>
                    </Fragment>
                  ))}
                </p>
              )}
              <p className="mt-2 text-[12px] text-text-3">The team that decides</p>
              <ul className="text-[12.5px] text-text-1">
                {state.team.emails.map((e) => (
                  <li key={e}>
                    {state.team.names[e.toLowerCase()] ? (
                      <>
                        <DragPerson name={state.team.names[e.toLowerCase()]} type="staff" subtitle="Decides on this card">
                          {state.team.names[e.toLowerCase()]}
                        </DragPerson>
                        {' · '}
                      </>
                    ) : ''}
                    {e}
                  </li>
                ))}
              </ul>
            </Card>

            {state.ask && (
              <Card className="p-3">
                <h2 className="mb-1.5 text-[13px] font-bold text-text-1">The scheduling exchange</h2>
                <Row k="State" v={state.ask.state} />
                <Row k="Picked" v={[state.ask.picked_date, state.ask.picked_time].filter(Boolean).join(' ') || '—'} />
                <Row k="Their reply" v={state.ask.supervisor_reply || '—'} />
                <Row k="Confirmed" v={[state.ask.confirmed_date, state.ask.confirmed_time].filter(Boolean).join(' ') || '—'} />
              </Card>
            )}

            <Card className="p-3">
              <h2 className="mb-1.5 text-[13px] font-bold text-text-1">Everything that happened</h2>
              {state.journey_unreadable ? (
                <p className="text-[12.5px] text-warning">
                  The journey tab could not be read. That is not an empty journey — it is a read
                  that failed, and the difference matters.
                </p>
              ) : (state.journey ?? []).length === 0 ? (
                <p className="text-[12.5px] italic text-text-3">Nothing yet.</p>
              ) : (
                <ul className="max-h-[420px] space-y-1.5 overflow-y-auto">
                  {(state.journey ?? []).slice().reverse().map((l) => (
                    <li key={l.id} className="border-b border-border/40 pb-1.5 last:border-0">
                      <p className="flex items-center gap-1 text-[12px]">
                        {l.ok ? <Check size={11} className="text-primary" /> : <X size={11} className="text-danger" />}
                        <span className="font-semibold text-text-1">{l.title}</span>
                        {l.rehearsal && (
                          <span className="rounded bg-warning/10 px-1 text-[10px] font-bold text-warning">
                            rehearsal
                          </span>
                        )}
                      </p>
                      <p className="text-[11.5px] text-text-3">{l.detail}</p>
                      <p className="text-[10.5px] text-text-3">{l.at.replace('T', ' ').slice(0, 19)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex gap-2 text-[12.5px]">
      <span className="w-[110px] shrink-0 text-text-3">{k}</span>
      <span className="min-w-0 break-words text-text-1">{v || '—'}</span>
    </p>
  )
}

// ONE STEP, WITH ROOM TO EXPLAIN ITSELF.
function StepBlock({
  step, last, busy, disabled, result, lines, open, onToggle, onRun, extra, branch,
  addresses, attempts, personas, onPretend, presetText, num,
}: {
  step: SimStep
  last: boolean
  busy: boolean
  disabled: boolean
  result?: StepResult
  lines: JourneyLine[]
  open: boolean
  onToggle: () => void
  onRun: () => void
  extra?: React.ReactNode
  branch?: { label: string; tone: 'mint' | 'amber' | 'danger' }
  addresses?: { to: string; cc: string } | null
  attempts?: { attempts: number; minutes: number; ask?: SimAsk } | null
  personas?: string[]
  onPretend?: (from: string, text: string) => void
  presetText?: string
  num?: number
}) {
  const [showMore, setShowMore] = useState(false)
  const [pretendOpen, setPretendOpen] = useState(false)
  const [pretendFrom, setPretendFrom] = useState('')
  const [pretendText, setPretendText] = useState('')
  const ran = !!result || lines.length > 0
  const failed = result && (result.ok === false || (result.sent === false && !result.reason))
  return (
    <div id={`step-${step.id}`}>
      <Card
        className={cn(
          'p-4 transition-colors',
          open && 'ring-1 ring-primary/30',
          ran && !failed && 'border-primary/30',
          failed && 'border-danger/40',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <div
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold tabular-nums',
                ran && !failed ? 'bg-primary/10 text-primary' : failed ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-text-3',
              )}
            >
              {ran && !failed ? <Check size={16} /> : (num ?? step.n)}
            </div>
            {/* THE LOOP SIGN, UNDER THE NUMBER */}
            {step.loop && (
              <span
                title={step.loop}
                className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-primary"
              >
                <RefreshCw size={11} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <button onClick={onToggle} className="block text-left">
              <h2 className="text-[15.5px] font-bold leading-tight text-text-1">{step.title}</h2>
            </button>
            {/* the big caption — it gets the room */}
            <p className="mt-1 max-w-[85ch] text-[13.5px] leading-relaxed text-text-2">{step.about}</p>
            {step.loop && (
              <div className="mt-2 max-w-[85ch] rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="mb-1 inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
                  <RefreshCw size={10} /> loop
                </span>
                <p className="text-[12.5px] leading-[19px] text-text-2">{step.loop}</p>
              </div>
            )}

            {/* and the whole process, one press away when it does not fit */}
            {(step.more?.length ?? 0) > 0 && (
              <>
                <button
                  onClick={() => setShowMore((v) => !v)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
                >
                  {showMore ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {showMore ? 'Hide how this works' : 'How this works, in full'}
                </button>
                {showMore && (
                  <div className="mt-2 max-w-[85ch] rounded-md border border-border bg-surface-2/50 px-4 py-3">
                    {(step.more ?? []).map((line, i) =>
                      line === '' ? (
                        <div key={i} className="h-2" />
                      ) : (
                        <p
                          key={i}
                          className={cn(
                            'text-[13px] leading-relaxed',
                            // A line that is a heading is written as one: all caps up to the first full stop.
                            /^[A-Z0-9·\s,'’—-]{12,}$/.test(line.split('.')[0])
                              ? 'font-bold text-text-1'
                              : 'text-text-2',
                          )}
                        >
                          {line}
                        </p>
                      ),
                    )}
                  </div>
                )}
              </>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Chip icon={step.channel.includes('sms') ? <MessageSquare size={11} /> : <Mail size={11} />}
                    label={step.channel} />
              <Chip label={`to: ${step.to}`} />
              {step.action ? <Chip label={step.action} mono /> : <Chip label="no door — the platform does this itself" />}
              {attempts && (
                <Chip icon={<Clock3 size={11} />}
                      label={`${attempts.attempts}× every ${attempts.minutes} min`} />
              )}
              {step.action && (
                <button className={btnGo} onClick={onRun} disabled={disabled || busy}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Run this step
                </button>
              )}
            </div>

            {/* WHERE IT WILL WRITE — the configured addresses, said BEFORE the
                press: the field decides, the step says. */}
            {addresses && (
              <p className="mt-1.5 text-[12px] text-text-3">
                <span className="font-semibold text-text-2">Will write to:</span> {addresses.to}
                {addresses.cc && step.channel.includes('email') && (
                  <> <span className="mx-1">·</span>
                    <span className="font-semibold text-text-2">Cc:</span> {addresses.cc}</>
                )}
              </p>
            )}
            {attempts?.ask && (
              <p className="mt-0.5 text-[11.5px] text-text-3">
                Attempt book: {attempts.ask.sent} of {attempts.ask.max} sent ·{' '}
                {attempts.ask.state === 'open'
                  ? 'still waiting for a reply'
                  : attempts.ask.state === 'answered'
                    ? `answered by ${attempts.ask.answered_by || 'a reply'}`
                    : 'the asking ended without a reply'}
              </p>
            )}

            {extra}

            {/* mock composer: the typed words travel the real reading machinery */}
            {step.pretend && onPretend && (
              <div className="mt-2">
                <button
                  onClick={() => {
                    // the configured fake reply pre-fills the box the first time it opens — still yours to edit…
                    if (!pretendOpen && !pretendText && presetText) setPretendText(presetText)
                    setPretendOpen((v) => !v)
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1 text-[12px] font-semibold text-warning hover:bg-warning/10"
                >
                  <MessageSquare size={12} />
                  {step.pretend.label}
                </button>
                {pretendOpen && (
                  <div className="mt-2 max-w-[70ch] space-y-2 rounded-md border border-warning/30 bg-surface-2/50 p-3">
                    <p className="text-[11.5px] text-text-3">{step.pretend.hint}</p>
                    {step.pretend.channel !== 'pick' && (personas?.length ?? 0) > 0 && (
                      <label className="block">
                        <span className="mb-0.5 block text-[11.5px] font-semibold text-text-2">I am replying as</span>
                        <select
                          className={inputCls}
                          value={pretendFrom || personas![0]}
                          onChange={(e) => setPretendFrom(e.target.value)}
                        >
                          {personas!.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                    )}
                    {step.pretend.channel !== 'pick' && (
                      <label className="block">
                        <span className="mb-0.5 block text-[11.5px] font-semibold text-text-2">The message we are pretending</span>
                        <textarea
                          rows={2}
                          className={inputCls}
                          value={pretendText}
                          placeholder={
                            step.pretend.channel === 'team' ? 'OK — or: I like Mandy Radtka. Or: send me more options.'
                            : step.pretend.channel === 'candidate' ? 'YES — I want to participate.'
                            : 'YES — that time works. Or: no. Or: I can do Tue 10am, Wed 2pm or Thu 5pm.'
                          }
                          onChange={(e) => setPretendText(e.target.value)}
                        />
                      </label>
                    )}
                    <button
                      className={btnGo}
                      disabled={busy || (step.pretend.channel !== 'pick' && !pretendText.trim())}
                      onClick={() => onPretend(pretendFrom || (personas?.[0] ?? ''), pretendText)}
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                      {step.pretend.channel === 'pick' ? 'Pretend the pick' : 'Send the pretend reply'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div
                className={cn(
                  'mt-3 rounded-md border px-3 py-2',
                  failed ? 'border-danger/40 bg-danger/5' : 'border-primary/30 bg-primary/5',
                )}
              >
                <p className="text-[12.5px] font-semibold text-text-1">
                  {result.ok === false
                    ? 'The call itself failed'
                    : result.sent === false
                      ? `Nothing was sent — ${result.reason || result.error || 'the platform declined'}`
                      : result.sent === true
                        ? 'Sent'
                        : 'Done'}
                </p>
                {result.subject && <Row k="Subject" v={result.subject} />}
                {result.to && <Row k="Addressed to" v={formatPhoneDisplay(result.to)} />}
                {result.delivered_to && result.delivered_to !== result.to && (
                  <Row k="Actually reached" v={formatPhoneDisplay(result.delivered_to)} />
                )}
                {result.redirected && (
                  <p className="mt-1 text-[12px] font-semibold text-warning">
                    Redirected by test mode — this is the rehearsal endpoint, not the addressee.
                  </p>
                )}
                {(result.detail || result.error) && (
                  <p className="mt-1 text-[12px] text-text-2">{result.detail || result.error}</p>
                )}
                {open && (
                  <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface-2 p-2 text-[11px] leading-snug text-text-2">
                    {JSON.stringify(result.raw ?? result, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {lines.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {lines.map((l) => (
                  <li key={l.id} className="flex gap-1.5 text-[12px] text-text-3">
                    {l.ok ? <Check size={12} className="mt-0.5 shrink-0 text-primary" />
                          : <X size={12} className="mt-0.5 shrink-0 text-danger" />}
                    <span>
                      <span className="text-text-2">{l.detail}</span>
                      <span className="ml-1.5 text-[11px]">{l.at.replace('T', ' ').slice(0, 19)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* the branch, drawn beside the spine rather than in it */}
      {branch && (
        <div className="ml-12 mt-1 flex items-center gap-1.5">
          <ArrowRight size={12} className={cn(
            branch.tone === 'danger' ? 'text-danger' : branch.tone === 'amber' ? 'text-warning' : 'text-primary')} />
          <span className={cn('rounded-md border px-2 py-0.5 text-[11.5px] font-semibold', TONE_RING[branch.tone])}>
            {branch.label}
          </span>
        </div>
      )}

      {!last && (
        <div className="flex justify-center py-1">
          <ArrowDown size={14} className="text-text-3" />
        </div>
      )}
    </div>
  )
}

function Chip({ icon, label, mono }: { icon?: React.ReactNode; label: string; mono?: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2',
      mono && 'font-mono',
    )}>
      {icon}{label}
    </span>
  )
}

// ------------------------------------------------------------------ the configuration — every parameter of the…

// The groups the fields are drawn in, with a human label per key.
const CFG_GROUPS: { title: string; keys: { key: string; label: string }[] }[] = [
  // THE AUTOMATIC LANE FIRST — the keyword appeared nowhere in the simulator.
  { title: 'The automatic lane — what the platform does without being asked', keys: [
    { key: 'sim_talent_autocross_backlog', label: 'Work through the BACKLOG of signed applications? (yes / no)' },
    { key: 'sim_talent_autocross_per_pass', label: 'Automatic crossings per pass (0 turns it off)' },
    { key: 'sim_talent_autofill_new_floor', label: 'Start people when New falls below… (0 turns it off)' },
    { key: 'sim_talent_autofill_take', label: '…and take this many from the queue' },
    { key: 'sim_talent_autofill_idle_hours', label: 'Hours with nobody moving a card that count as "unwatched"' },
    { key: 'sim_talent_finish_minutes', label: 'Minutes an already-employed person stands at Ready before the record closes' },
  ] },
  { title: 'The cast', keys: [
    { key: 'sim_mode', label: 'Mode (actors / redirect)' },
    { key: 'sim_candidate_email', label: 'Candidate e-mail (campo do candidato)' },
    { key: 'sim_candidate_phone', label: 'Candidate phone' },
    { key: 'sim_interviewer_name', label: 'Interviewer name' },
    { key: 'sim_interviewer_email', label: 'Interviewer e-mail' },
    { key: 'sim_interviewer_phone', label: 'Interviewer phone' },
    { key: 'sim_outbound_guard', label: 'The fence — only the cast can be written to (on/off)' },
    { key: 'sim_recruiter_name', label: 'Recruiter named in the outreach (blank = who chose)' },
    { key: 'sim_auto_reply', label: 'Auto-actor — every reply answers itself (on/off)' },
  ] },
  { title: 'Copy list & team', keys: [
    { key: 'sim_decider_emails', label: 'The deciders — To on team letters (Arthur & Ty)' },
    { key: 'sim_watcher_emails', label: 'Cc on team letters ("em copia somente eu")' },
    { key: 'sim_cc_emails', label: 'Cc on candidate letters (the 3)' },
    { key: 'sim_team_emails', label: 'The wider team (fallbacks)' },
    { key: 'sim_team_sms', label: 'Team Quo numbers' },
    { key: 'sim_decider_sms', label: 'Nudge numbers — one per decider (the "4×" fix)' },
  ] },
  { title: 'Frequency — attempts until a reply', keys: [
    { key: 'sim_attempts', label: 'Attempts (global default)' },
    { key: 'sim_retry_minutes', label: 'Minutes between attempts' },
    { key: 'sim_attempts_ask', label: 'Step 0 · the ask (blank = global)' },
    { key: 'sim_attempts_shortlist', label: 'Step 1 · the shortlist' },
    { key: 'sim_attempts_outreach', label: 'Step 4 · the outreach' },
    { key: 'sim_attempts_invite', label: 'Step 9 · the scheduling link' },
  ] },
  { title: 'Quo & sources', keys: [
    { key: 'sim_quo_identify', label: 'SMS opens saying who/why (yes/no)' },
    { key: 'sim_quo_intro', label: 'The identification line ({purpose})' },
    { key: 'sim_screen_line', label: 'The evaluation line the candidate calls' },
    { key: 'sim_transcript_from', label: 'Step 8 transcript source (CAN_ id, blank = newest)' },
  ] },
  { title: 'Pretend replies — the fake answers the buttons start with', keys: [
    { key: 'sim_pretend_ask_reply', label: 'Step 0 · the decider\'s "sim, estamos contratando"' },
    { key: 'sim_pretend_interest_reply', label: 'Step 2 · the decider\'s answer to the shortlist' },
    { key: 'sim_pretend_outreach_reply', label: 'Step 4.5 · the candidate\'s YES' },
    { key: 'sim_pretend_interviewer_reply', label: 'Step 10 · the interviewer\'s YES' },
  ] },
  { title: 'Message texts — the words each letter and SMS actually says. Edit here and save (it writes the sheet); clear a cell to return to the shipped words. Steps 9–10 live in Smart Comms.', keys: [
    { key: 'sim_subject_tag', label: 'Subject tag on rehearsal letters (clear = production)' },
    { key: 'sim_text_welcome_subject', label: 'Welcome letter subject (pipeline open)' },
    { key: 'sim_text_welcome_body', label: 'Welcome letter body' },
    { key: 'sim_text_ask_subject', label: 'Step 0 subject' },
    { key: 'sim_text_ask_body', label: 'Step 0 body' },
    { key: 'sim_text_shortlist_subject', label: 'Step 1 subject' },
    { key: 'sim_text_shortlist_body', label: 'Step 1 intro (table & criteria always ride)' },
    { key: 'sim_text_thanks_subject', label: 'Step 3 subject (no DSP name in the title)' },
    { key: 'sim_text_thanks_body', label: 'Step 3 body ({who} · {about} = all chosen names)' },
    { key: 'sim_text_outreach_sms', label: 'Step 4 SMS' },
    { key: 'sim_text_outreach_email_subject', label: 'Step 4 e-mail subject' },
    { key: 'sim_text_outreach_email_body', label: 'Step 4 e-mail body' },
    { key: 'sim_text_accepted_subject', label: 'Step 5 subject ({name})' },
    { key: 'sim_text_accepted_body', label: 'Step 5 body' },
    { key: 'sim_text_accepted_sms', label: 'Step 5 Quo message ({name} {phone})' },
    { key: 'sim_text_screen_call_subject', label: 'Step 5.2 subject' },
    { key: 'sim_text_screen_call_body', label: 'Step 5.2 body (call the line)' },
    { key: 'sim_text_screen_call_sms', label: 'Step 5.2 SMS ({first_name} {line})' },
    { key: 'sim_text_resume_request_subject', label: 'Step 5.5 subject' },
    { key: 'sim_text_resume_request_body', label: 'Step 5.5 body ({first_name} {referrer})' },
    { key: 'sim_text_cjis_request_subject', label: 'Step 6 subject ({name})' },
    { key: 'sim_text_cjis_request_body', label: 'Step 6 body ({name} {status})' },
    { key: 'sim_text_cjis_nudge_sms', label: 'CJIS Quo nudge, rides with the letter ({name})' },
    { key: 'sim_text_screen_redo_subject', label: 'Step 11 LOOP subject ({name})' },
    { key: 'sim_text_screen_redo_body', label: 'Step 11 LOOP body ({first_name} {line})' },
    { key: 'sim_text_screen_redo_sms', label: 'Step 11 LOOP text ({name} {line})' },
    { key: 'sim_text_onboarding_sms', label: 'Ch. 23 login text ({email} {password})' },
    { key: 'sim_text_ready_ask_subject', label: 'Ch. 25 subject ({name})' },
    { key: 'sim_text_ready_ask_body', label: 'Ch. 25 letter ({name} {notes})' },
    { key: 'sim_text_ready_ask_sms', label: 'Ch. 25 OpenPhone text ({name})' },
    { key: 'sim_text_interviewer_days_subject', label: 'Days-ask subject ({name} {interviewer})' },
    { key: 'sim_text_interviewer_days_body', label: 'Days-ask letter ({interviewer} {link})' },
    { key: 'sim_text_interviewer_days_sms', label: 'Days-ask OpenPhone text ({name} {link})' },
    { key: 'sim_text_interview_done_subject', label: 'Step 19 subject ({name} {interviewer})' },
    { key: 'sim_text_interview_done_body', label: 'Step 19 body ({score} {recommendation} {comments})' },
    { key: 'sim_text_decision_ask_subject', label: 'Step 8.7 subject ({name})' },
    { key: 'sim_text_decision_ask_body', label: 'Step 8.7 intro (score & ADVANCE/DECLINE ride)' },
    { key: 'sim_text_decision_ask_sms', label: 'Step 8.7 Quo nudge ({name})' },
    { key: 'sim_text_discard_subject', label: 'Step 11 subject ({name})' },
    { key: 'sim_text_discard_body', label: 'Step 11 body (fact rows always ride)' },
    { key: 'sim_text_onboarding_subject', label: 'Step 15 subject ({first_name})' },
    { key: 'sim_text_onboarding_body', label: 'Step 15 welcome (credentials always ride)' },
  ] },
]

function SimConfigPanel({ cfg, onSaved }: { cfg: Record<string, string>; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dirty = Object.keys(draft).filter((k) => draft[k] !== (cfg[k] ?? ''))

  const grouped = new Set(CFG_GROUPS.flatMap((g) => g.keys.map((k) => k.key)))
  const extras = Object.keys(cfg).filter((k) => !grouped.has(k))

  const save = async () => {
    if (!dirty.length || saving) return
    setSaving(true)
    try {
      const values: Record<string, string> = {}
      for (const k of dirty) values[k] = draft[k]
      await gasAction('hiringSimConfigSet', { values })
      toast({ type: 'success', title: 'Simulation config saved', body: `${dirty.length} field(s).` })
      setDraft({})
      onSaved()
    } catch (e) {
      toast({ type: 'danger', title: 'Not saved', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setSaving(false) }
  }

  const field = (key: string, label: string) => {
    const value = draft[key] !== undefined ? draft[key] : (cfg[key] ?? '')
    const long = (key.indexOf('_text_') !== -1 && key.indexOf('subject') === -1) ||
      key.indexOf('sim_pretend_') === 0
    return (
      <label key={key} className="block">
        <span className="mb-0.5 flex items-center gap-1 text-[11.5px] font-semibold text-text-2">
          {label}
          <span className="font-mono text-[10px] font-normal text-text-3">{key}</span>
        </span>
        {long ? (
          <textarea
            rows={4}
            className={inputCls}
            value={value}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          />
        ) : (
          <input
            className={inputCls}
            value={value}
            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          />
        )}
      </label>
    )
  }

  return (
    <Card className="mb-4 p-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Settings2 size={15} className="text-text-2" />
        <span className="text-[13.5px] font-bold text-text-1">Simulation configuration</span>
        <span className="text-[12px] text-text-3">
          every actor, address, frequency and text — “todos os parâmetros são configuráveis”
        </span>
        {dirty.length > 0 && (
          <span className="rounded bg-warning/10 px-1.5 text-[11px] font-bold text-warning">
            {dirty.length} unsaved
          </span>
        )}
        <ChevronDown size={15} className={cn('ml-auto text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CFG_GROUPS.map((g) => (
              <div key={g.title} className="space-y-2">
                <p className="text-[12px] font-bold uppercase tracking-wide text-text-3">{g.title}</p>
                {g.keys.map((k) => field(k.key, k.label))}
              </div>
            ))}
            {extras.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] font-bold uppercase tracking-wide text-text-3">Everything else</p>
                {extras.map((k) => field(k, k))}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button className={btnGo} onClick={() => void save()} disabled={!dirty.length || saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Save configuration
            </button>
            {dirty.length > 0 && (
              <button className={btnGhost} onClick={() => setDraft({})} disabled={saving}>
                Discard edits
              </button>
            )}
            <p className="text-[11.5px] text-text-3">
              Saved server-side (hiring_sim_config) — every step reads it at press time.
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}
