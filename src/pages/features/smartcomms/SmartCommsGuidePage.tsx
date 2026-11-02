// HOW IT WORKS — Smart Comms taught, inside Smart Comms.
// The Smart Comms app doubles as a guide to how the lane works, beside doing the work itself.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, BookOpen, Brain, CalendarClock, Check, ClipboardCheck,
  Clock, Compass, DoorOpen, Ear, Eye, FlaskConical, Hammer, HeartHandshake, Landmark,
  Layers, Lock, MessageSquareReply, Moon, RefreshCw, Rocket, Scale, Send, ShieldCheck, X,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// ------------------------------------------------------------------ the shapes commBoard returns…

/** One row of `comm_bindings`, as commBoard attaches it to its intent. */
type Item = {
  req_id?: string
  state?: string
  band?: string
  binding_state?: string
  qualified_by?: string
  also?: string
  settles?: string
}

/** One row of `comm_intents` — one person's thread. */
type Row = {
  state?: string
  verdict?: string
  worst?: string
  carried?: string | number
  deferred?: string | number
  attempts?: string | number
  test_attempts?: string | number
  test_mode?: string
  escalate?: string
  // Written only once a send is claimed, and it changes meaning mid-life — see the chapter on reading the board.
  channel?: string
  items?: Item[]
}

/** What the page prints where it has no measurement. Never a zero. */
const GAP = '—'

// WHERE A THREAD STANDS.
const BANDS: { key: string; label: string; tint: ExtendedTintName }[] = [
  { key: 'planned', label: 'Planned', tint: 'blue' },
  { key: 'asking', label: 'Asking', tint: 'amber' },
  { key: 'answered', label: 'Answered', tint: 'mint' },
  { key: 'stopped', label: 'Asked us to stop', tint: 'pink' },
]
const BAND_KEYS = BANDS.map((b) => b.key)

/** `verdict.policy` — CommPolicy.gs:288. What the POLICY decided, dial aside. */
const VERDICTS: { key: string; label: string; tint: ExtendedTintName; gloss: string }[] = [
  { key: 'would send', label: 'Would send', tint: 'mint', gloss: 'every policy rule said yes' },
  { key: 'held', label: 'Held', tint: 'amber', gloss: 'not yet — a gap, a quiet hour, a weekend' },
  { key: 'blocked', label: 'Blocked', tint: 'pink', gloss: 'past the attempt budget' },
  { key: 'unplanned', label: 'Unplanned', tint: 'slate', gloss: 'no verdict was reached for this row' },
]
const VERDICT_KEYS = VERDICTS.map((v) => v.key)

// The chapters, in the order a learner climbs them — and the ONE list that numbers them.
const CHAPTERS: { id: string; label: string; title: string; icon: React.ReactNode }[] = [
  { id: 'ch-what', label: 'What it is', title: 'What this lane is for', icon: <Layers size={15} /> },
  { id: 'ch-screens', label: 'The screens', title: 'The screens, and where each one reads', icon: <Eye size={15} /> },
  { id: 'ch-out', label: 'One message out', title: 'The journey of one message', icon: <Send size={15} /> },
  { id: 'ch-door', label: 'The one door', title: 'The transport — one door out', icon: <DoorOpen size={15} /> },
  { id: 'ch-test', label: 'Test mode', title: 'How nobody real receives anything', icon: <FlaskConical size={15} /> },
  { id: 'ch-catalogue', label: 'The catalogue', title: 'Situations, words, ledger', icon: <BookOpen size={15} /> },
  { id: 'ch-gates', label: 'Six gates', title: 'Six gates, not one dial', icon: <Lock size={15} /> },
  { id: 'ch-pace', label: 'Waiting', title: 'How long a message may be made to wait', icon: <Clock size={15} /> },
  { id: 'ch-repair', label: 'A correction', title: 'The three paths of a correction', icon: <HeartHandshake size={15} /> },
  { id: 'ch-hours', label: 'Which source', title: 'Where the answer comes from when the sources disagree', icon: <CalendarClock size={15} /> },
  { id: 'ch-back', label: 'The answer back', title: 'What comes back, and how we know whose it is', icon: <Ear size={15} /> },
  { id: 'ch-levels', label: 'The two levels', title: 'The two levels of the answer', icon: <Scale size={15} /> },
  { id: 'ch-written', label: 'What is written', title: 'What is written down, and who owns it', icon: <Landmark size={15} /> },
  { id: 'ch-cortex', label: 'The cortex', title: 'The cortex — both directions', icon: <Brain size={15} /> },
  { id: 'ch-honest', label: 'Reading the numbers', title: 'Reading the board honestly', icon: <Eye size={15} /> },
  { id: 'ch-measured', label: 'The design, measured', title: 'The design, measured — and what the review found', icon: <ClipboardCheck size={15} /> },
  { id: 'ch-notbuilt', label: 'Not built', title: 'What is not built', icon: <Hammer size={15} /> },
  { id: 'ch-before', label: 'Before production', title: 'Before anybody real hears anything', icon: <Rocket size={15} /> },
  { id: 'ch-where', label: 'Where to look', title: 'Where to look', icon: <Compass size={15} /> },
]

// ------------------------------------------------------------------ small pieces…

function Pill({ tint, children }: { tint: ExtendedTintName; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>
      {children}
    </span>
  )
}

// A LIVE NUMBER, ON THE STEP IT EXPLAINS.
function Stat({ value, label, tint = 'slate' }: { value: React.ReactNode; label: string; tint?: ExtendedTintName }) {
  return (
    <span className={cn('inline-flex max-w-full items-baseline gap-1.5 rounded-md px-2 py-1', TINT_BG[tint], TINT_FG[tint])}>
      <span className="font-stat shrink-0 text-[15px] leading-none">{value}</span>
      <span className="min-w-0 text-[11.5px] leading-[1.35] opacity-85">{label}</span>
    </span>
  )
}

// A FIGURE NO DOOR IN THIS APP CAN ANSWER — the count the written explanation was drawn against, printed as what it…
function Ill({ v, children }: { v: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-dashed border-border px-2 py-1">
      <span className="font-stat shrink-0 text-[15px] leading-none text-text-2">{v}</span>
      <span className="min-w-0 text-[11.5px] leading-[1.35] text-text-3">{children}</span>
      <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
        illustration
      </span>
    </span>
  )
}

// The same admission at the size of a paragraph, for a section whose every figure was frozen when the explanation…
function IllNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] leading-[1.55] text-text-3">
      <strong className="font-semibold text-text-2">These figures are an illustration.</strong> {children}
    </p>
  )
}

// VOCABULARY WHERE IT IS USED.
function Term({ w, d }: { w: string; d: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'border-b border-dashed pb-px font-semibold transition-colors',
          open ? 'border-primary text-primary' : 'border-text-3 text-text-1 hover:border-primary hover:text-primary',
        )}
      >
        {w}
      </button>
      {open ? (
        <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[12px] italic text-text-2">{d}</span>
      ) : null}
    </>
  )
}

// One chapter of the climb.
function Chapter({
  id, title, lede, icon, children,
}: { id: string; title: string; lede: string; icon: React.ReactNode; children: React.ReactNode }) {
  const n = CHAPTERS.findIndex((c) => c.id === id) + 1
  return (
    <section id={id} className="scroll-mt-[92px]">
      <Card className="mb-4">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-primary">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-3">
              Chapter {n} of {CHAPTERS.length}
            </p>
            <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">{title}</h2>
            <p className="mt-1 text-[12.5px] leading-[1.55] text-text-3">{lede}</p>
          </div>
        </div>
        <div className="space-y-3 text-[13px] leading-[1.65] text-text-2 [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_strong]:text-text-1">
          {children}
        </div>
      </Card>
    </section>
  )
}

/** One step of the spine: a numbered node on a rail, with its live number. */
function Step({
  n, title, stats, refs, last, children,
}: {
  n: number; title: string; stats?: React.ReactNode; refs?: string; last?: boolean; children: React.ReactNode
}) {
  return (
    <li className={cn('relative pl-9', last ? 'pb-0' : 'pb-5')}>
      <span className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-2 font-stat text-[11px] text-text-2">
        {n}
      </span>
      {!last && <span aria-hidden className="absolute bottom-0 left-[11.5px] top-7 w-px bg-border" />}
      <p className="text-[13px] font-semibold leading-6 text-text-1">{title}</p>
      <div className="mt-0.5 space-y-2">{children}</div>
      {stats ? <div className="mt-2 flex flex-wrap gap-1.5">{stats}</div> : null}
      {refs ? <p className="mt-1.5 break-words font-mono text-[11px] leading-[1.5] text-text-3">{refs}</p> : null}
    </li>
  )
}

// THE THINGS A READER MOST OFTEN GETS WRONG, drawn as a refusal rather than a footnote.
function Wrong({ claim, natural, children }: { claim: string; natural: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border border-border bg-surface-2 p-3.5"
      style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}
    >
      <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.amber }} />
        <span>Commonly got wrong: <span className="italic">&ldquo;{claim}&rdquo;</span></span>
      </p>
      <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-3">
        <strong className="font-semibold text-text-2">Why it is natural.</strong> {natural}
      </p>
      <div className="mt-1.5 space-y-2 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
        <p className="font-semibold text-text-1">The fact that corrects it</p>
        {children}
      </div>
    </div>
  )
}

/** A two-column can / cannot list — the authority boundary, drawn. */
function Powers({ can, cannot }: { can: React.ReactNode[]; cannot: React.ReactNode[] }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: TINT_VAR.mint }}>
          <Check size={13} /> It may decide
        </p>
        <ul className="space-y-1.5 text-[12.5px] leading-[1.55] text-text-2">
          {can.map((c, i) => <li key={i} className="flex gap-1.5"><span className="text-text-3">·</span><span>{c}</span></li>)}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: TINT_VAR.pink }}>
          <X size={13} /> It may not decide
        </p>
        <ul className="space-y-1.5 text-[12.5px] leading-[1.55] text-text-2">
          {cannot.map((c, i) => <li key={i} className="flex gap-1.5"><span className="text-text-3">·</span><span>{c}</span></li>)}
        </ul>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export default function SmartCommsGuidePage() {
  const [dial, setDial] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  const [here, setHere] = useState(CHAPTERS[0].id)
  const railRef = useRef<HTMLDivElement | null>(null)

  // Re-armed on mount, not only cleared on unmount: a ref that is set false once and never true again turns any…
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // ONE DOOR, ASKED AGAIN ON DEMAND.
  const load = useCallback((again = false) => {
    setBusy(true)
    gasAction<{ rows?: Row[]; dial?: string; note?: string }>('commBoard', {}, { timeoutMs: 120_000 })
      .then((r) => {
        if (!alive.current) return
        setDial(r.dial ?? ''); setRows(r.rows ?? []); setNote(r.note ?? ''); setFailed(false)
      })
      .catch(() => {
        if (!alive.current) return
        // A DOOR THAT DID NOT ANSWER IS NOT A BOARD OF ZEROS.
        setFailed(true)
        if (again) toast({ type: 'danger', title: 'The board did not answer', body: 'The chapters below are still true; only the live numbers are stale.' })
      })
      .finally(() => { if (alive.current) setBusy(false) })
  }, [])

  useEffect(() => { load() }, [load])

  // WHERE THE READER IS IN THE CLIMB.
  useEffect(() => {
    const root = document.getElementById('main-scroll')
    const obs = new IntersectionObserver((entries) => {
      const seen = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (seen[0]) setHere(seen[0].target.id)
    }, { root: root ?? null, rootMargin: '-100px 0px -55% 0px', threshold: 0 })
    CHAPTERS.forEach((c) => { const el = document.getElementById(c.id); if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [])

  // Keep the active chip in view on a phone, by moving the RAIL's own scrollLeft — never scrollIntoView, which…
  useEffect(() => {
    const rail = railRef.current
    const chip = rail?.querySelector<HTMLElement>(`[data-nav="${here}"]`)
    if (!rail || !chip) return
    rail.scrollTo({ left: Math.max(0, chip.offsetLeft - rail.clientWidth / 2 + chip.clientWidth / 2), behavior: 'smooth' })
  }, [here])

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // EVERY NUMBER ON THE PAGE, derived from commBoard's rows and nothing else.
  const live = useMemo(() => {
    if (!rows) return null
    const num = (v: unknown) => Number(v || 0) || 0
    const current = rows.filter((r) => r.state !== 'superseded')

    // A state the engine has never written folds into `planned`, which is what CommRecord.gs starts a thread at…
    const states: Record<string, number> = {}
    BAND_KEYS.forEach((k) => { states[k] = 0 })
    const verdicts: Record<string, number> = {}
    VERDICT_KEYS.forEach((k) => { verdicts[k] = 0 })
    const worst: Record<string, number> = { expired: 0, expiring: 0, missing: 0 }
    const bands: Record<string, number> = { overdue: 0, soon: 0, open: 0 }
    const itemStates: Record<string, number> = { open: 0, settled: 0, deferred: 0, superseded: 0 }
    const closedBy: Record<string, number> = { estate: 0, engine: 0, person: 0, unsaid: 0 }
    // WHICH DOOR CARRIED IT.
    const doors: Record<string, number> = { sms: 0, email: 0, unsaid: 0 }
    let carried = 0, deferred = 0, folded = 0, items = 0

    current.forEach((r) => {
      const s = String(r.state || 'planned')
      states[BAND_KEYS.indexOf(s) === -1 ? 'planned' : s] += 1
      const v = String(r.verdict || 'unplanned')
      verdicts[VERDICT_KEYS.indexOf(v) === -1 ? 'unplanned' : v] += 1
      const w = String(r.worst || '')
      if (w in worst) worst[w] += 1
      carried += num(r.carried)
      deferred += num(r.deferred)
      if (num(r.attempts) > 0 || num(r.test_attempts) > 0) {
        const ch = String(r.channel || '').trim().toLowerCase()
        doors[ch === 'sms' || ch === 'email' ? ch : 'unsaid'] += 1
      }
      ;(r.items || []).forEach((it) => {
        items += 1
        const b = String(it.band || '')
        if (b in bands) bands[b] += 1
        const st = String(it.binding_state || 'open')
        itemStates[st in itemStates ? st : 'open'] += 1
        if (String(it.also || '').trim() || String(it.settles || '').trim()) folded += 1
        if (st === 'settled') {
          const by = String(it.qualified_by || '').trim().toLowerCase()
          if (by === 'estate') closedBy.estate += 1
          else if (by === 'engine') closedBy.engine += 1
          else if (by) closedBy.person += 1
          else closedBy.unsaid += 1
        }
      })
    })

    return {
      threads: current.length,
      written: rows.length,
      superseded: rows.length - current.length,
      states, verdicts, worst, bands, itemStates, closedBy, doors,
      carried, deferred, folded, items,
      /* "asked" counts CLAIMS, not deliveries — the caveat has its own chapter. */
      asked: current.filter((r) => num(r.attempts) > 0 || num(r.test_attempts) > 0).length,
      // THE TWO MEMORIES, COUNTED APART, because that is the whole point of keeping them apart: a production claim…
      prodAsked: current.filter((r) => num(r.attempts) > 0).length,
      testAsked: current.filter((r) => num(r.test_attempts) > 0).length,
      testRows: current.filter((r) => r.test_mode === 'yes').length,
      escalated: current.filter((r) => r.escalate === 'yes').length,
    }
  }, [rows])

  /** The one place a measurement becomes a printable string. */
  const n = (pick: (l: NonNullable<typeof live>) => number): React.ReactNode => (live ? pick(live) : GAP)

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="How it works"
          subtitle="A guide to the platform's mouth — and its ear. What the lane is for, how one message goes out through one door, how nobody real hears it yet, how long it may be made to wait, how a correction is made, what comes back, who decides, what is written down, what the cortex learns, how the design measured up, and what must be true before anybody real hears anything."
          actions={
            <>
              <PageSwitch />
              <button
                type="button"
                onClick={() => load(true)}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface"
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} /> Refresh
              </button>
            </>
          }
        />
      </motion.div>

      {/* ══ THE LIVE HEADLINE ═══════════════════════════════════════════
          Words about a machine must be read against the machine's current
          mode, or they describe something that is not running. */}
      <div className="mb-4 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Threads the lane is holding
            </p>
            <p className="font-stat text-[60px] leading-none text-white">{live ? live.threads : GAP}</p>
            <p className="mt-1 text-[12px] leading-[1.5] text-white/60">
              of {live ? live.written : GAP} row{live && live.written === 1 ? '' : 's'} ever written
              {live && live.superseded > 0 ? <> · {live.superseded} superseded</> : null}
              {live ? <> · {live.asked} already asked</> : null}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Where those threads stand
            </p>
            {/* `heroBand`, not TINT_VAR: this bar is painted on the hero, which
                is deep navy in BOTH themes, while the tint foreground tokens
                flip and become dark ink for white paper — on navy half the
                estate saw no bar at all. */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {BANDS.map((b) => (
                live && live.states[b.key] ? (
                  <span
                    key={b.key}
                    title={`${live.states[b.key]} ${b.label.toLowerCase()}`}
                    style={{ width: `${(live.states[b.key] / Math.max(1, live.threads)) * 100}%`,
                             background: heroBand(b.tint) }}
                  />
                ) : null
              ))}
            </div>
            {/* a band with nobody in it keeps its place in the legend: "none"
                and "not measured" must not read the same — which is why an
                unmeasured band shows the em dash and never a 0. */}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-white/70">
              {BANDS.map((b) => (
                <span key={b.key} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(b.tint) }} />
                  {b.label} <span className="font-stat text-white">{live ? live.states[b.key] : GAP}</span>
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {live && live.testRows > 0 && (
                <Pill tint="amber">{live.testRows} written during a test-mode pass</Pill>
              )}
              {live && live.escalated > 0 && (
                <Pill tint="pink">{live.escalated} past the attempt budget — nothing acts on that</Pill>
              )}
            </div>
            {/* THE PAGE SAYS SO ITSELF. A toast is gone in five seconds and the
                first load never fired one, so a reader met a hero that looked
                measured and was not. */}
            {failed ? (
              <p className="mt-3 text-[12.5px] font-semibold" style={{ color: heroBand('danger') }}>
                {rows
                  ? 'The board did not answer this time — the numbers above are the last ones it gave.'
                  : 'The board did not answer — nothing above is measured. The chapters below are still true.'}
              </p>
            ) : null}
            {note ? <p className="mt-3 text-[12.5px] leading-[1.5] text-white/80">{note}</p> : null}
          </div>
        </div>

        {/* THE DIAL, as three positions rather than one word. The live one is
            outlined; the other two still say what they would mean. */}
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
            The dial — it follows <span className="font-mono normal-case tracking-normal text-white/60">test_mode</span>: on is record, off is send
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ['off', 'Refuses to run. The sweep returns before it reads anything.'],
              ['record', 'Works everything out and writes it down. Contacts nobody.'],
              ['send', 'Hands cleared threads to the transport.'],
            ].map(([k, v]) => {
              const on = dial === k
              return (
                <div key={k} className={cn('rounded-lg border p-2.5', on ? 'border-white/60 bg-white/10' : 'border-white/10')}>
                  <p className="flex items-center gap-2 font-mono text-[12.5px] font-semibold text-white">
                    {k}
                    {on && <span className="rounded-full bg-white/20 px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-[0.08em]">now</span>}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-[1.45] text-white/60">{v}</p>
                </div>
              )
            })}
          </div>
          {!dial && (
            <p className="mt-2 text-[11.5px] text-white/50">
              The board has not said which position the dial is in.
            </p>
          )}
        </div>
      </div>

      {/* ══ THE RAIL — where you are in the climb ═══════════════════════ */}
      <nav
        ref={railRef}
        aria-label="Chapters"
        className="scroll-thin sticky top-0 z-20 -mx-1 mb-4 flex gap-1.5 overflow-x-auto rounded-lg border border-border bg-surface/95 px-2 py-2 shadow-1 backdrop-blur"
      >
        {CHAPTERS.map((c, i) => {
          const on = here === c.id
          return (
            <button
              key={c.id}
              data-nav={c.id}
              type="button"
              onClick={() => jump(c.id)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
                on ? 'bg-tint-primary text-tint-fg-primary' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
              )}
            >
              <span className={cn('font-stat text-[11px]', on ? '' : 'text-text-3')}>{i + 1}</span>
              {c.label}
            </button>
          )
        })}
      </nav>

      {/* ══ THE OPENING — the write-up's own headline, carried whole ════
          Four figures the explanation was drawn against. Two of them the
          board can answer today and does; two of them nothing in this app can
          answer, and those two say so on the number. */}
      <Card className="mb-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-3">
          Where the lane stands, in test mode
        </p>
        <h2 className="mt-1 font-display text-[17px] font-bold leading-6 text-text-1">
          Smart Comms, explained
        </h2>
        <p className="mt-1 text-[12.5px] leading-[1.55] text-text-3">
          How every message leaves the platform, who decides it may, what the obligations lane does with a reply,
          how the cortex learns from all of it — and what must be true before test mode comes off.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-stat text-[30px] leading-none text-text-1">{live ? live.asked : GAP}</p>
            <p className="mt-1 text-[12px] leading-[1.45] text-text-2">
              threads with an ask claimed
              {live ? <> — {live.doors.sms} by SMS, {live.doors.email} by e-mail
                {live.doors.unsaid > 0 ? <>, {live.doors.unsaid} with no door named</> : null}</> : null}
            </p>
            <p className="mt-1 text-[11px] text-text-3">live, from the board</p>
          </div>
          <div>
            <p className="font-stat text-[30px] leading-none text-text-1">{live ? live.prodAsked : GAP}</p>
            <p className="mt-1 text-[12px] leading-[1.45] text-text-2">
              threads with a <em>production</em> ask claimed — the memory that only moves when a real person is aimed at
            </p>
            <p className="mt-1 text-[11px] text-text-3">
              live, from the board · {live ? <>{live.testAsked} claimed against the test memory</> : 'the test memory is not measured'}
            </p>
          </div>
          <div>
            <p className="font-stat text-[30px] leading-none text-text-1">6</p>
            <p className="mt-1 text-[12px] leading-[1.45] text-text-2">houses, declared and mirrored</p>
            <p className="mt-1 text-[11px] text-text-3">
              not a measurement — the six this guide names, one chapter down
            </p>
          </div>
          <div>
            <p className="font-stat text-[30px] leading-none text-text-2">11</p>
            <p className="mt-1 text-[12px] leading-[1.45] text-text-2">facts the cortex has learned back</p>
            <p className="mt-1 text-[11px] text-text-3">
              illustration — the reader that files them runs on the intelligence side and has no door here
            </p>
          </div>
        </div>

        <p className="mt-4 text-[12.5px] leading-[1.65] text-text-2">
          Every SMS went to <strong className="text-text-1">the one test line — +1 (330) 919-5558</strong> and every
          e-mail to the <strong className="text-text-1">four testers</strong>. Every attempt has a provider receipt; every ledger row
          reads <em>rehearsal</em> — the platform&apos;s word for &ldquo;a tester heard it, the person has not been
          told&rdquo;. The loop is closed: the lane&apos;s own record taught the graph{' '}
          <Ill v="11">route corrections</Ill>, and the graph now proposes a supervisor for{' '}
          <Ill v="11">people</Ill>.
        </p>

        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.primary}` }}>
          <p className="text-[13px] leading-[1.65] text-text-2">
            <strong className="text-text-1">The short version.</strong> Smart Comms is one door out of the platform, a
            catalogue of things it may say, a ledger of what it said, a lane that works out who is owed a word about
            their compliance and says it once, a desk where the answers wait for a person, and a reader that teaches the
            cortex from all of it. Today the whole machine runs in test mode. It runs in asa-hub-app, in Python: the
            file reference beside a rule names the module that runs it, in <code>app/comm_*.py</code> and{' '}
            <code>app/smart_comms*.py</code>.
          </p>
        </div>
      </Card>

      {/* ══ CHAPTER 1 ═══════════════════════════════════════════════════ */}
      <Chapter
        id="ch-what" icon={<Layers size={17} />}
        title="What this lane is for"
        lede="The platform's mouth, and its ear. One governed door out, words kept in a book that is edited by hand, and every send written down."
      >
        <p>
          Every message this platform sends a person — a credential about to expire, an event telling,
          a weekly digest, and now a single letter about <em>everything</em> one person still owes —
          leaves through one door, in words nobody in the code wrote, and is recorded. Replies come back,
          are read against the estate's own records, and are either settled or put in front of a human.
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['May we say anything, and through which door?', 'the transport', 'app/smart_comms.py · app/platform_mail.py'],
            ['What do we say, and to whom does this kind of message apply?', 'the catalogue', 'app/smart_comms_desk.py · the situations, kept in Postgres'],
            ['Who is owed a word, about what, when — and did they answer?', 'the obligations lane', 'app/comm_*.py · comm_cortex.py · comm_events.py'],
          ].map(([q, who, where]) => (
            <div key={q} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold leading-[1.45] text-text-1">{q}</p>
              <p className="mt-1.5 text-[12px] text-text-2">{who}</p>
              <p className="mt-0.5 font-mono text-[11px] text-text-3">{where}</p>
            </div>
          ))}
        </div>
        <p>
          Three questions, three owners, and keeping them apart is the whole design. The transport does not
          know why it is sending. The catalogue does not know whether a person is reachable. The lane
          renders no words and owns no ledger.
        </p>

        <p className="pt-1">
          Six words carry the rest of this guide. Tap any of them — here, or anywhere below — to read what it means.
        </p>
        <p>
          A <Term w="situation" d="one row of the Smart Comms catalogue describing one kind of message: who it applies to, which channels, and the words — app/smart_comms.py" /> is
          a kind of message. An <Term w="obligation" d="one thing one person owes, exactly as requirement_states already computed it; this lane never recomputes one — app/comm_record.py" /> is
          one thing one person owes. An <Term w="intent" d="one person's need to be asked about something, carrying many obligations; the unit of asking, keyed person|purpose — app/comm_record.py" /> is
          one person's need to be asked, and each obligation riding inside it is
          a <Term w="binding" d="one obligation inside one conversation, with a state of its own, because a binding resolves alone — app/comm_record.py" />.
          Each of those lives in a <Term w="house" d="a dedicated 'ASA Data — …' workbook resolved by pointer, never by tab name — the constant is named _HOUSE and never _TAB" />,
          and whether any of it runs at all is the <Term w="dial" d="it follows test mode, the one switch: on is record (works everything out and writes it down), off is send (hands cleared threads to the transport), and off only when test mode could not be read — app/comm_record.py" />.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Words that nearly mean the same thing, and why both exist
          </p>
          <ul className="space-y-2 text-[12.5px] leading-[1.6] text-text-2">
            <li><strong>Obligation / binding</strong> — the first is the estate's fact; the second is that fact's presence inside one conversation. They are kept apart so a message can never be the authority on a certificate.</li>
            <li><strong>Intent / thread</strong> — the same object. <em>Intent</em> is the row; <em>thread</em> is what it is for a reader.</li>
            <li><strong>Claim / contribution</strong> — the claim is what a reply asserts; the contribution is the row that carries it plus whatever an owner later said about it.</li>
            <li><strong>Ledger / evidence house / trail</strong> — <code>smart_comms_sent</code> is the catalogue's shared history, <code>comm_attempts</code> is this lane's per-attempt receipt, <code>comm_observations</code> is what completed. Three records, because they have three owners and three lifetimes.</li>
            <li><strong>Rehearsal / test mode / <code>record</code></strong> — one position now: test mode on puts the dial at <code>record</code>, which stops the hand-over entirely, and a <em>rehearsal</em> is the row each held message leaves in Postgres (<code>app.comm_rehearsal</code>). Nothing is redirected to the testers any more.</li>
            <li><strong>Digest</strong> — two unrelated things: a weekly report message (<code>SMART_DIGESTS</code>) <em>and</em> the words-book reader every setting in this lane is read through (<code>digestSetting_</code>). <code>comm_dial</code> is the second and has nothing to do with the first.</li>
          </ul>
        </div>
      </Chapter>

      {/* ══ THE SCREENS ═════════════════════════════════════════════════ */}
      <Chapter
        id="ch-screens" icon={<Eye size={17} />}
        title="The screens, and where each one reads"
        lede="Every Smart Comms screen reads Postgres through asa-hub-app, and the ones that change while you watch read again on their own — on the Smart Comms ring, a reconnected stream, or the tab coming back into view. None of them polls."
      >
        <div className="space-y-2">
          {[
            ['Desk', 'The situations — ASA Data — Situations, a book Postgres keeps the record of; the Google sheet is its backup copy. Every switch, gates included, is saved here and takes effect at once. The book-write funnel never holds the Desk, so a gate can always be switched off again.'],
            ['Catalogue', 'Every situation by species, with the rung the lane resolves for it and the value each knob of the Digest Settings holds now.'],
            ['Words', 'The plan (comm_intents) and the words, rendered for real people. With test mode on, every message is held in Postgres instead of being sent.'],
            ['Activity', 'The deliveries — each one says Sent, and shows its words when the outbox kept them; Not sent, from the outbox; Held by test mode, from app.comm_rehearsal; and the lane’s houses counted live. It reads again on every turn of the clock that told or held somebody.'],
            ['Replies', 'One card per message: a text that reached two of our lines (a group with both numbers) is folded into one and says so. It reads again whenever a text is filed or an e-mail captured.'],
            ['Proposals', 'Every word the lane reads, shipped and taught, listed rather than counted, with what each proposal would cost. It reads again on the ring.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold text-text-1">{t}</p>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-text-2">{d}</p>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-text-3">
          A read that fails — during a restart, usually — keeps what the screen last read, says so, and the next ring
          reads again.
        </p>
      </Chapter>

      {/* ══ CHAPTER 2 — THE SPINE ═══════════════════════════════════════ */}
      <Chapter
        id="ch-out" icon={<Send size={17} />}
        title="The journey of one message"
        lede="From the thing that made it necessary to the row that proves it happened. Fourteen steps, in order, with the board's own count on each step that honestly has one."
      >
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] leading-[1.55]">
          <Clock size={14} className="mt-0.5 shrink-0 text-text-3" />
          <span>
            <strong>Nothing here runs on a Google trigger.</strong> asa-hub-app&apos;s own clock calls{' '}
            <code>commRecordSweep</code> and the lane decides for itself whether it is due — a six-hour
            window it keeps itself. <code>force:true</code> runs the pass now. The clock rings; it
            never decides.
          </span>
        </p>

        <ol className="mt-1">
          <Step
            n={0} title="The dial refuses, before anything is read"
            refs="app/comm_record.py · app/smart_comms_desk.py"
            stats={<Stat value={dial || GAP} label="the dial says" tint={dial === 'send' ? 'mint' : dial === 'record' ? 'blue' : 'slate'} />}
          >
            <p>
              <code>commRecordSweep_</code> asks <code>commDial_()</code> first and returns having done
              nothing when it reads <code>off</code>. Anything that is not <code>record</code> or{' '}
              <code>send</code> reads as <code>off</code> — a typo in the cell is a refusal, never a send.
            </p>
          </Step>

          <Step
            n={1} title="What decides a person is owed a word"
            refs="app/comm_record.py · OPEN_STATES"
            stats={<>
              <Stat value={n((l) => l.worst.expired)} label="threads whose worst item is expired" tint="pink" />
              <Stat value={n((l) => l.worst.expiring)} label="expiring" tint="amber" />
              <Stat value={n((l) => l.worst.missing)} label="missing" tint="blue" />
            </>}
          >
            <p>
              The obligations matrix is <strong>read and never recomputed</strong>. <code>requirement_states</code>{' '}
              is taken by header name — <code>person_key, person_name, req_id, state, expires, days_left</code> —
              and only <code>missing</code>, <code>expiring</code> and <code>expired</code> count as open.
              Whether somebody owes something is the compliance catalogue's answer; this lane only reads it.
            </p>
            <p>
              What the lane is connecting is a demand engine that already runs to a catalogue that already exists.
              The size of that matrix, when this explanation was written:
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Ill v="13,410">rows in the obligations matrix</Ill>
              <Ill v="447">people in it</Ill>
              <Ill v="~10,900">open obligations</Ill>
            </div>
          </Step>

          <Step
            n={2} title="Three filters, before anybody is planned"
            refs="app/comm_record.py"
          >
            <ul className="space-y-1.5">
              <li><strong>One voice per credential.</strong> Any <code>req_id</code> an ON reminder situation already speaks for is dropped and left to the older lane. One person, one voice.</li>
              <li>
                <strong>The roster is a law.</strong> Only the estate Master's Status <code>yes</code> and{' '}
                <code>admin</code> pass — and it is asked <em>before</em> the work, not after. Most of the matrix is
                about somebody who does not work here: when the explanation was written the Master held{' '}
                <Ill v="170">rows</Ill> of which <Ill v="63">Yes</Ill> and <Ill v="4">Admin</Ill> were asked and the
                rest were not.
              </li>
              <li><strong>A thread the person stopped is never re-planned.</strong></li>
            </ul>
          </Step>

          <Step
            n={3} title="The thread — one per person, never one per obligation"
            refs="app/comm_record.py · BINDINGS_PER_INTENT"
            stats={<>
              <Stat value={n((l) => l.threads)} label="threads" tint="blue" />
              <Stat value={n((l) => l.carried)} label="obligations carried" tint="mint" />
              <Stat value={n((l) => l.deferred)} label="held back by the cap" tint="amber" />
              <Stat value={n((l) => l.folded)} label="folded into another ask" tint="lavender" />
            </>}
          >
            <p>
              A person's open rows become <Term w="bindings" d="one obligation inside one conversation, identified as person_key|req_id — app/comm_record.py" />,
              the background-check trio folds into <strong>one</strong> binding when the dates agree, the rest sort
              worst-first, and the intent carries <strong>at most six</strong>. Everything beyond six is counted as{' '}
              <em>deferred</em> — said out loud, never dropped.
            </p>
            <p>
              The key is the thread: <code>person|purpose</code>, deliberately <strong>not</strong> the demand set.
              A person whose list of owed things changes is still in the same conversation.
            </p>
          </Step>

          <Step
            n={4} title="The pacing memory is read back — two memories, never one"
            refs="app/comm_record.py"
          >
            <p>
              A test-mode send reached a tester, not the person; counted as production it would leave somebody
              &ldquo;exhausted&rdquo; the morning test mode came off. So each thread keeps <code>attempts</code> /{' '}
              <code>last_asked_at</code> for production and <code>test_attempts</code> / <code>test_last_asked_at</code>{' '}
              for test. A row with no <code>test_mode</code> column at all is treated as test-era and ignored in production.
            </p>
          </Step>

          <Step
            n={5} title="The policy verdict — a priority first, then four rules in this order"
            refs="app/comm_repair.py · app/comm_routes.py"
            stats={<>
              {VERDICTS.map((v) => (
                <Stat key={v.key} value={n((l) => l.verdicts[v.key])} label={v.label.toLowerCase()} tint={v.tint} />
              ))}
            </>}
          >
            <p>
              Before any rule is consulted, the plan is given a{' '}
              <Term w="priority" d="safety | repair | ask | notice — how much this message may cost the person; resolved from declared ids only, never from what the message says — app/comm_repair.py" />,
              and it is resolved from <strong>declared ids</strong> — a caller may say which id it speaks under and may
              never say which priority it gets. Everything the lane plans today lands on <code>ask</code>.
            </p>
            <p>
              Then: consolidate by urgency <Term w="band" d="overdue | soon | open — a single message cannot honestly carry two different urgencies, so each band travels separately — app/comm_repair.py" />;
              the attempt budget; the gap since the last ask (36 / 72 / 168 h by band, or a flat 24 h test pace); then
              quiet hours and the weekend. A priority may be allowed to skip the gap, the quiet hours or the weekend —{' '}
              <em>the chapter on waiting is that ladder</em> — and every skip is written onto the row as a skip, so a message that
              jumped a queue reads as one that jumped a queue.
            </p>
            <p>
              The quiet hours are the <strong>server's</strong> clock, not the recipient's: the sweep resolves one hour
              and one weekday from the script timezone for everybody. What <em>is</em> per person is the narrowing —
              the cortex's window may close hours the platform would have spoken in, and may never open one.
            </p>
            <p>
              <strong>In test mode the attempt cap and the window are recorded and not enforced.</strong> Only the
              pace survives. And the dial is applied <strong>last and separately</strong>: <code>verdict.policy</code>{' '}
              says what the policy decided, <code>verdict.send</code> says whether anything may happen. Folded into one
              field, every row of a rehearsal reads <em>blocked</em> — the one answer that teaches nothing.
            </p>
            <p className="text-[12.5px] text-text-3">
              {VERDICTS.map((v) => `${v.label}: ${v.gloss}`).join(' · ')}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Stat value={n((l) => l.bands.overdue)} label="items the plan put in the overdue band" tint="pink" />
              <Stat value={n((l) => l.bands.soon)} label="soon" tint="amber" />
              <Stat value={n((l) => l.bands.open)} label="open" tint="blue" />
            </div>
          </Step>

          <Step
            n={6} title="Consent, and the refusal that wins first"
            refs="app/comm_repair.py · app/comm_record.py"
          >
            <p>
              Each channel the situation lists is asked in turn. <strong>A refusal wins first and absolutely</strong> —
              our own opt-out list, gathered fail-closed, so an unreadable list is a refusal and never a send.
              Then a live grant for <em>this</em> purpose. Then silence, which falls to the <code>comm_silence</code>{' '}
              rule whose floor is <em>employment</em> and therefore permits <code>compliance.owed</code>.
            </p>
            <p>
              A grant for <em>another</em> purpose is treated as silence, not as a refusal — permission to be told
              about one thing is not permission to be told about everything. In test mode a refused route is
              overridden and recorded as overridden.
            </p>
          </Step>

          <Step
            n={7} title="The words — and this lane never writes a sentence"
            refs="app/comm_record.py · app/smart_comms.py"
          >
            <p>
              The purpose resolves to a <Term w="situation" d="one row of the catalogue: enabled, channels, credential, the sms_text / email_subject / email_text, a sender, max_attempts, frequency" />{' '}
              — the words book's bindings tab may re-point it, and the shipped floor is <code>compliance_bundle</code>.
              <code>smartSituationOn_</code> returns <strong>null when the row is absent or OFF</strong>, and the
              shipped seed is <code>enabled:&apos;no&apos;</code>: <strong>a publish can never switch a sender on.</strong>
            </p>
            <p>
              Then the variables are filled — <code>{'{first_name}'}</code>, <code>{'{name}'}</code>,{' '}
              <code>{'{expires}'}</code>, <code>{'{days_left}'}</code>, <code>{'{credential}'}</code> (the items{' '}
              <em>named</em>, never a count), <code>{'{items}'}</code>, <code>{'{sender}'}</code> and{' '}
              <code>{'{token}'}</code>, the reference a reply can quote — and the catalogue renders. Edit the words
              in the book by id; no sentence in this lane comes from the code.
            </p>
            <p className="rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] italic leading-[1.6] text-text-2">
              &ldquo;Hi {'{first_name}'}, this is {'{sender}'}. Our records show {'{credential}'} still outstanding on
              your file… Ref {'{token}'}&rdquo;
            </p>
            <p className="text-[12.5px] text-text-3">
              Where <code>{'{credential}'}</code> names the items — <em>CPR, DODD 8-Hour and 2 more</em> — and never a
              count, because a person cannot act on &ldquo;three things&rdquo;.
            </p>
          </Step>

          <Step
            n={8} title="The last gate names every rule that refused"
            refs="app/comm_record.py"
          >
            <p>
              Four rules are asked and <strong>every one that refused is reported</strong> — the dial, the policy,
              the route, and whether anything is still open — plus two of this lane's own: no situation resolved
              (<code>noWords</code>), and a person with neither phone nor address. A plan that says only &ldquo;no&rdquo;
              is a plan nobody can review.
            </p>
          </Step>

          <Step
            n={9} title="Claim the attempt, then send — never the other way round"
            refs="app/comm_record.py · app/comm_record_writes.py"
            stats={<Stat value={n((l) => l.asked)} label="threads with at least one claimed ask" tint="amber" />}
          >
            <p>
              The attempt is claimed <strong>before</strong> the send, fail-closed. Then the permitted channel is
              tried first, the situation's others after, and each call carries an idempotency key with the attempt
              number in it. Two effects for one plan is the failure mode this ordering exists to prevent.
            </p>
          </Step>

          <Step
            n={10} title="The one door out"
            refs="app/comms_rpc.py · app/smart_comms.py"
          >
            <p>
              <code>rpcCall_</code>: an undeclared method is refused; parameters are checked;{' '}
              <strong>the opt-out list is asked again</strong> at the only door every send goes through, and
              unreadable means refusal; an idempotency receipt is cached; and the master switch{' '}
              <code>HUB_RPC_SEND</code> must be on — Settings may <em>pause</em> it and can never start it.
            </p>
          </Step>

          <Step
            n={11} title="Test mode's sink — where nobody real receives anything"
            refs="app/comms_rpc.py · app/platform_mail.py · app/alerts_config.py"
            stats={live && live.testRows > 0 ? <Stat value={live.testRows} label="rows written during a test-mode pass" tint="amber" /> : undefined}
          >
            <p>
              Test mode is ON if the cell says so <em>or</em> if any tester is listed and the cell is blank — so
              upgrading the code can never silently point a rehearsal at real people. It is the one switch now:
              every on word (on, sheet, rehearsal, paper) sends <strong>nothing to anybody, testers included</strong> —
              each message is written into the mock outbox and the rehearsal house instead, and the sending dial
              follows it. The only letters that still leave are a password reset and an invitation a person has just
              asked for.
            </p>
            <p>
              The two transport doors <em>themselves</em> sink as well now, so a caller that bypassed{' '}
              <code>rpcCall_</code> still cannot reach a person. And a redirected receipt is deliberately{' '}
              <strong>not</strong> cached — a rehearsal must not consume the idempotency of a real send.
            </p>
          </Step>

          <Step
            n={12} title="Everything that happened is written down"
            refs="app/comm_record.py"
            stats={<Stat value={n((l) => l.items)} label="binding rows on the board" tint="blue" />}
          >
            <p>
              The intent row and one row per binding are upserted <em>column-preservingly</em>; the attempt is
              appended to <code>comm_attempts</code>; what completed is appended to <code>comm_observations</code>;
              and a courtesy row goes into the catalogue's own ledger, where a redirected send is logged as{' '}
              <em>rehearsal</em>. The chapter on what is written down is the whole list.
            </p>
          </Step>

          <Step
            n={13} last title="The pass stops politely"
            refs="app/comm_record.py"
          >
            <p>
              Ninety seconds of writing, then the cursor is stored and the six-hour stamp is <em>released</em>, so
              the next tick resumes where this one stopped instead of starting the estate again.
            </p>
          </Step>
        </ol>

        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[12px]">
          {[
            ['requirement_states', 'what each person owes'],
            ['CommIntent', 'one thread per person, six items at most'],
            ['CommPolicy', 'may we ask now'],
            ['CommConsent', 'may we ask this way'],
            ['CommDispatch', 'which words, which variables'],
            ['rpcCall_', 'the one door out'],
            ['comm_attempts', 'the receipt, appended'],
          ].map(([k, v], i, a) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="rounded-md border border-border bg-surface-2 px-2 py-1" title={v}><code>{k}</code></span>
              {i < a.length - 1 && <ArrowRight size={12} className="text-text-3" />}
            </span>
          ))}
        </div>

        <Wrong
          claim="Smart Comms sends the message; the Comm* lane just works out who."
          natural="The dispatch step is described as “a bridge, deliberately not a sender”, and every part of the lane insists it renders no words, touches no provider and owns no ledger."
        >
          <p>
            That is true of the dispatch step and false of the lane. The obligations sweep calls the
            transport itself — <code>rpcCall_(&apos;smsSend&apos;…)</code> and <code>rpcCall_(&apos;emailSend&apos;…)</code> —
            and only afterwards writes a courtesy row into the older lane's ledger. Smart Comms' own sweep never walks
            a <Term w="bundle" d="the species of situation that carries several obligations in one message — compliance_bundle; the reminder sweep refuses to walk one" />.
          </p>
          <p>
            What the lane borrows from the catalogue is the <strong>words</strong> and the <strong>ledger</strong>;
            what it borrows from the transport (<code>app/comms_rpc.py</code>) is the <strong>door</strong>. The two lanes are kept from speaking
            twice about one credential by a separate rule (<code>commRecordOwnedReqs_</code>) — not by one of them being
            unable to send.
          </p>
        </Wrong>
      </Chapter>

      {/* ══ THE TRANSPORT ═══════════════════════════════════════════════ */}
      <Chapter
        id="ch-door" icon={<DoorOpen size={17} />}
        title="The transport — one door out"
        lede="Four methods, five checks in a fixed order, and one answer shape every caller must actually read. Nothing leaves this platform any other way."
      >
        <p>
          Nothing leaves except through <code>rpcCall_</code>. Four methods exist — <code>smsSend</code>,{' '}
          <code>emailSend</code>, <code>packetRequest</code>, <code>teamAlert</code> — and an undeclared one is{' '}
          <strong>refused</strong>. A door that accepts a method nobody declared is not a door.
        </p>

        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Inside the door, in this order
        </p>
        <ol className="space-y-1.5">
          {[
            ['Parameters', 'checked before anything else is believed.'],
            ['The opt-out brake', 'asked here, at the one door every send goes through — and unreadable means refusal, never a send.'],
            ['Idempotency', 'a key remembered six hours, so a retry answers deduplicated instead of sending twice — and a redirected receipt is deliberately not remembered.'],
            ['The master switch', 'HUB_RPC_SEND, a platform property. Settings can pause it; nothing in Settings can start it.'],
            ['Test mode', 'the hold at record, described in the next chapter.'],
            ['The provider', 'OpenPhone, from the line named Automations; and the platform mailbox, through the platform’s own mail door.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-stat text-[11px] text-text-2">
                {i + 1}
              </span>
              <span><strong>{t}.</strong> <span className="text-text-2">{d}</span></span>
            </li>
          ))}
        </ol>

        <p>
          The answer is always the same seven fields — <code>ok</code>, <code>sent</code>, <code>gated</code>,{' '}
          <code>redirected</code>, <code>deduplicated</code>, <code>receipt</code>, <code>error</code> — and{' '}
          <strong>every one of those words means something a caller must read</strong>. A caller that tests only{' '}
          <code>ok</code> cannot tell a delivery from a rehearsal from a duplicate it already sent. A provider
          receipt — an <code>AC…</code> from the phone, an <code>smtp</code> id from the mail door — is the proof that
          something left; nothing else on the row is.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
          <p className="text-[12.5px] font-semibold text-text-1">And the two doors now sink for themselves</p>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
            Both transport doors ask about test mode <em>themselves</em>, rather than trusting that everybody came
            through <code>rpcCall_</code>. They did not all come through it: <Ill v="9">call sites</Ill> reached the
            mail door without it, and the lead scraper posted to the phone provider by hand. A guarantee that holds
            only for well-behaved callers is not a guarantee.
          </p>
        </div>
      </Chapter>

      {/* ══ TEST MODE ═══════════════════════════════════════════════════ */}
      <Chapter
        id="ch-test" icon={<FlaskConical size={17} />}
        title="How nobody real receives anything"
        lede="Three cells, a hold at every door, and five things a rehearsal must never be allowed to do. Each of the five was a real bug before it was a rule."
      >
        <p>
          The cells live in <em>Settings → Test mode</em>: the test-mode dropdown, the tester number and the tester
          addresses. Test mode is on if the cell says so — <strong>or if any tester is listed and the cell is
          blank</strong>, so upgrading the code can never silently point a rehearsal at real people.
        </p>
        <p>
          <strong>With it on, nothing is handed to a provider at all.</strong> The dial stands at{' '}
          <code>record</code>, and every message is kept in Postgres instead — a row of the rehearsal log
          (<code>app.comm_rehearsal</code>) and of the mock outbox (<code>app.comm_mock</code>), listed live on the
          Activity page. The testers are only named on those rows: the redirect to their phone, which made one
          group chat receive everybody&apos;s messages, is gone.
        </p>

        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Five things test mode must never do
        </p>
        <div className="space-y-2">
          {[
            ['Consume a real receipt.',
             'A redirected send’s key is not cached. Before that fix, switching test mode off within six hours answered deduplicated — and the person was never contacted at all.'],
            ['Count as the person having been told.',
             'The ledger says rehearsal; the lane keeps its test attempts apart from its production attempts, and production never reads a test-era row.'],
            ['Send Google’s own mail.',
             'Sharing a Drive file by adding a viewer made Google e-mail four administrators, outside every sink we control. Files are granted in silence now.'],
            ['Be recorded as a real delivery.',
             'An attendance letter a tester received was filed as sent to the directors. It reads sent-redirected now, and an app-release announcement no longer spends its once-per-app stamp on a rehearsal.'],
            ['Go stale.',
             'The four screens that write the shared config — the Simulator’s test-mode switch among them — drop the memo every reader shares, so nobody is deciding from a cached “off”.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold leading-[1.5] text-text-1">{t}</p>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-text-2">{d}</p>
            </div>
          ))}
        </div>
        <p className="text-[12.5px] text-text-3">
          One deliberate exception, claimed in the code rather than left to be discovered: the account release invite
          reaches the person even in test mode.
        </p>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-[12.5px] font-semibold leading-[1.5] text-text-1">The Desk&apos;s gates are brakes, armed only
            while test mode holds</p>
          <p className="mt-1 text-[12.5px] leading-[1.6] text-text-2">
            Each gate on the Desk holds the one door it names — a Drive share, a calendar link, a feed&apos;s ingest —
            while it is armed and test mode is on; off, or with test mode off, the door works. The widest is{' '}
            <code>gate_book_write_funnel</code>: armed, it refuses every write on the platform (409, in its own words),
            the Hub&apos;s screens, the imports and the feeds alike. Leave it off unless a rehearsal must leave no trace
            at all. The Desk itself is never held by it, so it can always be switched off again.
          </p>
        </div>
      </Chapter>

      {/* ══ THE CATALOGUE ═══════════════════════════════════════════════ */}
      <Chapter
        id="ch-catalogue" icon={<BookOpen size={17} />}
        title="Situations, words, ledger"
        lede="One row is one kind of message. The code ships the defaults, the situations overrule them by id, and a publish can never switch a sender on."
      >
        <p>
          A <Term w="situation" d="one row of the Smart Comms catalogue describing one kind of message: who it applies to, which channels, and the words" />{' '}
          is one row describing one kind of message. The live tab holds <Ill v="93">situations</Ill>, in six species:
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['reminder', 'a credential expiring', 'blue'],
            ['event', 'something happened in a flow', 'mint'],
            ['digest', 'a weekly report to a list', 'lavender'],
            ['mailbox', 'an alert derived from a mailbox', 'amber'],
            ['ai', 'which model answers a question — not a message at all', 'slate'],
            ['bundle', 'one message carrying several obligations — this lane’s species', 'pink'],
          ].map(([k, d, tint]) => (
            <div key={k} className="rounded-lg border border-border bg-surface-2 p-3">
              <Pill tint={tint as ExtendedTintName}>{k}</Pill>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-text-2">{d}</p>
            </div>
          ))}
        </div>

        <p>
          The code ships defaults, and the <strong>situations</strong> — <em>ASA Data — Situations</em>, a book
          Postgres keeps the record of, switched and edited on the Desk — overlay them by id. <strong>A row already
          there belongs to whoever edited it and is never overwritten.</strong>
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
          <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.mint }} />
            The law that matters: only what was already sending ships on
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            A publish can never switch a sender on. The Desk does, by id, one row at a time, with somebody&apos;s
            hand on it. That is why <code>compliance_bundle</code> — this lane&apos;s own situation — ships off, and
            one switch on the Desk turns it on.
          </p>
        </div>

        <p>
          The <strong>ledger</strong> records what really went out. A gated send is not recorded at all; a redirected
          one is recorded as <em>rehearsal</em>; and the weekly digest now records its week there. Its only memory used
          to be a six-hour transport receipt, and the pass that carries it runs every six hours — so a digest somebody
          had filled in went out two to four times a day.
        </p>
      </Chapter>

      {/* ══ THE GATES ═══════════════════════════════════════════════════ */}
      <Chapter
        id="ch-gates" icon={<Lock size={17} />}
        title="Six gates, not one dial"
        lede="The dial is the only switch with a name, a screen and three obvious values. It is also the first of six, and every one of them must pass before a person hears anything."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { g: '1 · The dial', w: <>Test mode must be off — the dial follows it and then reads <code>send</code>.</>, s: dial ? `now: ${dial}` : 'not measured' },
            { g: '2 · The policy', w: <>The thread's own verdict must be <em>would send</em> — budget, pace, quiet hours.</>, s: live ? `${live.verdicts['would send']} of ${live.threads} threads` : 'not measured' },
            { g: '3 · The route', w: <>Consent must permit at least one channel, and no refusal may stand.</>, s: 'per person, per channel' },
            { g: '4 · The words', w: <>A situation row must resolve <strong>and be ON</strong>. <code>compliance_bundle</code> ships <code>enabled:&apos;no&apos;</code>.</>, s: 'the Desk decides' },
            { g: '5 · A reachable person', w: <>Neither a phone nor an address is a refusal with a reason, not a silent failure.</>, s: 'per person' },
            { g: '6 · The door', w: <>The platform property <code>HUB_RPC_SEND</code> must be on. Settings may pause it, never start it.</>, s: 'the master switch' },
          ].map((x) => (
            <div key={x.g} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold text-text-1">{x.g}</p>
              <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">{x.w}</p>
              <p className="mt-1.5 font-mono text-[11px] text-text-3">{x.s}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3" style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
          <p className="text-[12.5px] leading-[1.6]">
            <strong>And over all six, test mode.</strong> With it on, every one of those gates passing still means
            nobody heard: the message is kept in Postgres as a rehearsal and the person is still owed it.
          </p>
        </div>

        <Wrong
          claim="The dial says send, so people are being messaged."
          natural="The dial is the only switch anybody talks about, and the board prints it in the hero."
        >
          <p>
            A message also needs the policy's own verdict, a permitted route, a situation row that is switched ON
            — a null situation costs the pass a quiet <code>no_words</code> — a reachable person, and{' '}
            <code>HUB_RPC_SEND</code> at the door. Six independent gates, of which the dial is merely the loudest.
          </p>
        </Wrong>
      </Chapter>

      {/* ══ CHAPTER 4 — THE TWO ANSWERS TO "WHEN" ═══════════════════════ */}
      <Chapter
        id="ch-pace" icon={<Clock size={17} />}
        title="How long a message may be made to wait"
        lede="The gates answer may we speak at all. This chapter answers the other question entirely — how long a message that is allowed must wait — and the lane has three answers to it: the kind of message, the person's sleep, and the quarter of an hour before their shift."
      >
        <p>
          Every message this lane has ever planned was paced identically, because every message was the same kind of
          message: a request for a document. The gap exists so the same person is not asked about the same thing four
          times a day; the weekend rule's own words are <em>&ldquo;compliance is not urgent enough to cost a
          Sunday&rdquo;</em>. Then the platform said something wrong and owed somebody a word — and a correction held
          behind a rule built to stop nagging people about paperwork is the wrong answer. Worse: it gets slower the
          calmer the thread is, because the gap is longest for the person we bothered least. The person with nothing
          overdue would wait a week to hear we got their company&apos;s name wrong.
        </p>

        {/* ---- one: the ladder ---- */}
        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          One — the priority ladder, which is four questions and not one flag
        </p>
        <p>
          A <Term w="priority" d="safety | repair | ask | notice — how much a message may cost the person. Not the band: the band is how overdue the item is — app/comm_repair.py" />{' '}
          is not a <Term w="band" d="overdue | soon | open — the urgency of the ITEM, which chooses the gap and what may share a message; it says nothing about the kind of message" />.
          The band is the urgency of the <em>thing</em>; the priority is the urgency of the <em>message</em>, and it
          answers four separate questions that stay separate on purpose: may it skip the gap · may it break sleep ·
          may it cost a weekend · how many times may it be tried.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-text-3">
                <th className="pb-1.5 pr-3 font-semibold">Priority</th>
                <th className="pb-1.5 pr-3 font-semibold">The gap</th>
                <th className="pb-1.5 pr-3 font-semibold">Quiet hours</th>
                <th className="pb-1.5 pr-3 font-semibold">The weekend</th>
                <th className="pb-1.5 font-semibold">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['safety', 'somebody could be hurt', 'pink', 'skipped', 'BROKEN — the only one', 'skipped', 'uncapped'],
                ['repair', 'we owe them a word', 'amber', 'skipped', 'obeyed, without exception', 'skipped', 'one, and only one'],
                ['ask', 'they owe us something', 'blue', '36 / 72 / 168 h by band', 'obeyed', 'obeyed', 'the book’s cap, then a person'],
                ['notice', 'worth knowing, never urgent', 'slate', 'obeyed', 'obeyed', 'obeyed', 'the book’s cap — and droppable'],
              ].map(([k, why, tint, gap, quiet, weekend, cap]) => (
                <tr key={k as string} className="border-t border-border align-top">
                  <td className="py-2 pr-3">
                    <Pill tint={tint as ExtendedTintName}>{k as string}</Pill>
                    <span className="mt-1 block text-[11.5px] leading-[1.4] text-text-3">{why as string}</span>
                  </td>
                  <td className="py-2 pr-3 text-text-2">{gap as string}</td>
                  <td className="py-2 pr-3 text-text-2">{quiet as string}</td>
                  <td className="py-2 pr-3 text-text-2">{weekend as string}</td>
                  <td className="py-2 text-text-2">{cap as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          <strong>Read the <code>repair</code> row across.</strong> It is the one that teaches the whole idea. It skips
          the gap, because the gap counts <em>asks</em> and an apology asks for nothing — pacing a correction against
          the last compliance message is exactly the bug above. It skips the weekend, for the same reason: what makes a
          weekend message rude is being asked to do work on a day off. And it <strong>obeys quiet hours without
          exception</strong>, because a correction at 3am is a second insult and worse than the first, since it is
          deliberate. Quiet hours <em>defer</em> it — the repair is still coming, at 8am. Its attempt cap is{' '}
          <strong>stricter</strong> than an ordinary ask, not looser: said once per person per incident, and an
          undeliverable correction becomes a person&apos;s job on the first failure rather than being retried into
          somebody&apos;s phone.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
          <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.mint }} />
            A priority is never a permission
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            Nothing on that ladder opens a door. The opt-out list, consent, the dial, <code>HUB_RPC_SEND</code> and
            test mode bind every one of them, <code>safety</code> included. A priority only decides how long a
            message may be made to wait at a door that is <em>already open</em> — which is why this chapter is not in
            the chapter on the gates.
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            And the powers are <strong>code</strong> while the membership is a <strong>row</strong>. Which declared ids
            carry which priority is read from the words book (<code>comm_priority_safety</code>,{' '}
            <code>comm_priority_repair</code>, <code>comm_priority_notice</code>); the four powers are not a cell,
            because the powers <em>are</em> the meaning of the word — a cell that let <code>notice</code> break sleep
            would not be a policy change, it would be a different word wearing the same name. <code>ask</code> has no
            list because <code>ask</code> is where everything lands.
          </p>
        </div>

        <p className="text-[12.5px] text-text-3">
          <strong className="text-text-2">What carries these today: almost nothing, and that is deliberate.</strong>{' '}
          <code>safety</code> is declared and carried by nothing — declared anyway, and declared <em>above</em>{' '}
          <code>repair</code>, so that the day something real needs the top of the ladder it does not have to argue
          with a correction that already claimed it. <code>repair</code>&apos;s floor names{' '}
          <code>correction.owed</code> and <code>correction_notice</code>; neither the purpose nor the situation exists
          yet, so the pacing half is ready and nothing is filed under it. Unless one of those three cells has been
          filled in the book, everything this lane plans resolves to <code>ask</code>. And <code>droppable</code> is a
          declaration, not yet a behaviour: the verdict carries it, and no caller reads it — this file decides and
          never acts.
        </p>

        <Wrong
          claim="Urgent is one switch — mark it urgent and it goes out now."
          natural="Every system anybody has used has one high-priority flag, and it means “ignore the rules”. Reading four columns where you expected a checkbox feels like over-engineering."
        >
          <p>
            Bundled into one flag, those four questions are precisely how a correction ends up waking somebody at 3am
            to apologise for a signature. They are independent because the reasons behind them are independent: the gap
            is about <em>asking twice</em>, the weekend is about <em>asking for work on a day off</em>, and quiet hours
            are about <em>sleep</em> — and only one of those three is a thing an apology is guilty of.
          </p>
          <p>
            Which is why the ladder is not ordered by loudness. <code>repair</code> sits <em>above</em> the ordinary ask
            and is still the more restrained of the two: it may jump the queue and it may only speak once.
          </p>
        </Wrong>

        {/* ---- two: the window that means sleep ---- */}
        <p className="pt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Two — the window, which now means when somebody is asleep
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-4" style={{ borderLeft: `3px solid ${TINT_VAR.lavender}` }}>
          <p className="flex items-start gap-2">
            <Moon size={16} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.lavender }} />
            <span className="font-display text-[15px] font-bold leading-6 text-text-1">
              The cortex tells the platform when a person is <em>asleep</em> — never when they are awake.
            </span>
          </p>
          <p className="mt-1.5 pl-[24px] text-[12.5px] leading-[1.6] text-text-2">
            This reads backwards, and it follows from one line of arithmetic. The Hub may only ever{' '}
            <strong>narrow</strong> its quiet hours: it takes the window and does{' '}
            <code>max(quiet_to, from)</code> and <code>min(quiet_from, to)</code>, so quiet may only grow. Knowing
            somebody is awake at 02:00 is therefore worth nothing — 02:00 is already shut, and this side is not allowed
            to open it. The only useful sentence the cortex can say is <em>&ldquo;close an hour you would have spoken
            in&rdquo;</em>. Sleep is the half of the day the platform was getting wrong.
          </p>
          <p className="mt-1.5 pl-[24px] text-[12.5px] leading-[1.6] text-text-3">
            Be exact about what changed. The pair written on the route row still means <em>the hours we believe this
            person is reachable</em> — that contract did not move. What moved is where the belief comes from: it is now
            the platform&apos;s own permitted band with the shadow of a night shift taken off the front, rather than a
            guess at somebody&apos;s waking hours parsed out of a sentence.
          </p>
        </div>

        <p>
          And it was getting it wrong measurably. The window used to be parsed out of free-text shift sentences; it is
          now read from <strong>4,289 clock-in / clock-out rows</strong> in PsiAnywhere&apos;s own time record. In those
          rows, <strong>58 people finish an overnight shift at 08:00 and 39 at 07:00</strong> — which is{' '}
          <em>exactly</em> the hour the platform&apos;s quiet floor lifts (<code>quiet_to</code> is 8). The lane was
          not merely allowed to text those people, it was aimed at their first hour of sleep.
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['Midnight is not a problem this table has', 'PsiAnywhere cuts a shift at midnight — 1,097 rows end at 23:59:59 and 1,134 start at 00:00:00 — so a 22:00→08:00 night is two rows on two dates. Not one of the 4,262 complete rows runs backwards. A min/max over the hours says “awake 0 to 23”, which is no window at all, so no span is taken: each row is painted onto a 24-hour ring and the two halves of a cut night meet at midnight on their own.'],
            ['A night buys the hours after it', 'A day counts as a night finish when the person was working before 06:00 and came off between 04:00 and 12:00; that buys the eight hours after the finish as sleep. An hour is only CALLED sleep when those days outnumber the days they were working in that same hour — so somebody who finishes one night at 07:00 and works 09:00 to 17:00 on the other four is awake at ten.'],
            ['Silence is a cost that wants evidence', 'A person with no night finishes keeps the whole band: the clock does not prove that somebody who starts at 14:00 was asleep at 09:00. And three hours of the day can never be taken away — a shadow long enough to eat the band would not be a narrowing, it would be a silence.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold leading-[1.45] text-text-1">{t}</p>
              <p className="mt-1.5 text-[12px] leading-[1.55] text-text-2">{d}</p>
            </div>
          ))}
        </div>

        <Wrong
          claim="A window that says “awake 0 to 8” is a night worker, honestly described."
          natural="It is honest, it is what the shifts say, and every other system in the world would store it exactly like that."
        >
          <p>
            It is also how one live route left a real person textable at three in the morning. Fed to the Hub&apos;s{' '}
            <code>max</code> / <code>min</code>, a window of 0 to 8 lands on <code>from === to === 8</code>. Quiet
            hours are read as overnight only while <code>from &gt; to</code>, and 8 is not greater than 8, so the
            reader falls to <code>h &gt;= 8 &amp;&amp; h &lt; 8</code> — true at no hour of the day. That person did
            not have narrower quiet hours; they had <strong>none</strong>.
          </p>
          <p>
            An inverted pair is worse still: 22 to 6 comes back as quiet 6 to 22 — an ordinary-looking pair that{' '}
            <em>opens</em> all eight hours the platform had closed, which is the one thing the narrowing promises will
            never happen. So nothing leaves that side now that is not a plain, non-empty slice of the permitted band,
            and a night worker is served by narrowing the band instead.
          </p>
        </Wrong>

        <p className="text-[12.5px] text-text-3">
          <strong className="text-text-2">Two sources, and they are not a tie.</strong> The clock is a record of
          somebody standing in a house; the prose is a sentence about it that arrives split mid-value. Where both
          speak, the clock speaks — and it names people the graph does not, 79 of its 80 matching a row in the
          platform&apos;s own employee table. Where the clock refuses — fewer than five entries is an anecdote, not a pattern — the parsed
          window is still published rather than dropped, because taking a person&apos;s window away is a change nobody
          asked for. <code>window_why</code> names the source on every row, so a measured window and a parsed one are
          never mistaken for each other.
        </p>

        {/* ---- three: the quarter of an hour before a shift ---- */}
        <p className="pt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Three — the one narrow opening: the quarter of an hour before a shift
        </p>
        <p>
          Sleep closes hours. One moment in the day opens nothing and still solves a real problem: a person who is
          about to start work can take a message <strong>without being disturbed by it</strong>. They are awake, they
          are dressed, they have not started, and the message is about the day they are walking into. Anywhere else in
          those twenty-four hours the same message is an interruption.
        </p>
        <p>
          So the moment is a window and not a point, and the window is{' '}
          <strong>from thirty minutes before the shift to five minutes before it</strong>. Both edges are chosen
          against a specific harm. Earlier than thirty minutes and we are reaching somebody who may still be asleep
          before an early start — the very thing the sleep window exists to prevent. Later than five minutes and we are
          reaching somebody who is driving, parking, or walking in, which is worse than useless: the message arrives at
          the exact moment it cannot be read and will not be read again.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['Thirty minutes before', 'the earliest edge. Before that, we are competing with the last of somebody’s sleep.'],
            ['Five minutes before', 'the latest edge. After that, they are arriving, and a message is a distraction at a door.'],
            ['Never during', 'a shift is somebody else’s time — the client’s. The window closes when the shift opens.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold leading-[1.45] text-text-1">{t}</p>
              <p className="mt-1.5 text-[12px] leading-[1.55] text-text-2">{d}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.blue}` }}>
          <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
            <MessageSquareReply size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.blue }} />
            And while we do not know their window, we ask — once a day, at that same moment
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            The best source for when somebody wants to be reached is the person. So while a person has not told us,
            the platform asks them, and it asks in exactly the slot above — the quarter of an hour before a shift,
            where a question costs nothing. <strong>Once a day</strong>, never twice; and it{' '}
            <strong>stops the moment they answer</strong>, because a question that keeps arriving after it has been
            answered is not a question, it is nagging, and it teaches people that answering changes nothing.
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-3">
            A person who never answers is asked once a day and no more. That is a cost we accept, deliberately: the
            alternative is guessing their hours forever and getting it wrong in silence.
          </p>
        </div>
      </Chapter>

      {/* ══ THE CORRECTION ══════════════════════════════════════════════ */}
      <Chapter
        id="ch-repair" icon={<HeartHandshake size={17} />}
        title="The three paths of a correction"
        lede="When the platform says something wrong, it owes the person a word. There are three ways that word reaches them, and not one of the three has a clock in it."
      >
        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
          <p className="text-[13px] font-semibold leading-[1.6] text-text-1">
            No timer, no clock, no deadline.
          </p>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
            An apology has no stopwatch. Nothing below is a deadline, a retry schedule, a window or an expiry.
            The three paths are not three speeds; they are three different <em>ways a correction finds the person</em>,
            and which one applies is decided by how we came to know, never by how much time has gone by.
          </p>
        </div>

        <p>
          The paths are an evolution: each one exists because the one before it did not catch the case. Read them in
          order and the reason for the next one is the failure of the last.
        </p>

        <div className="space-y-2.5">
          {[
            {
              k: 'A', tint: 'mint' as ExtendedTintName,
              t: 'We notice it ourselves — and the correction goes out in seconds',
              d: (
                <>
                  <p>
                    The best case, and the one worth building for. The platform discovers its own error — a wrong name,
                    a wrong date, a sentence that was never true — and the correction leaves{' '}
                    <strong>inside the very write that discovered it</strong>. Not queued, not scheduled, not handed to
                    a sweep that will come round in six hours: the same piece of work that learns the message was wrong
                    is the piece of work that puts it right.
                  </p>
                  <p>
                    That is why this path is measured in seconds and not in anything else. The seconds are not a target
                    — they are just what it costs to finish the thought you are already having.
                  </p>
                </>
              ),
            },
            {
              k: 'B', tint: 'amber' as ExtendedTintName,
              t: 'We did not notice in time — so the correction rides in front of the next real message',
              d: (
                <>
                  <p>
                    Sometimes the discovery is late, and by then sending a message whose entire content is an apology
                    would itself be an interruption. So the correction does not travel alone. It rides{' '}
                    <strong>in front of the next real message</strong> that person was going to receive anyway — the
                    apology first, then the thing we were going to say.
                  </p>
                  <p>
                    It goes into a slot of the template that <strong>no author can name</strong>. The person editing
                    the words in the book cannot address it, cannot reorder it, cannot accidentally delete it and
                    cannot fill it with something else: it is not one of the variables. A correction that an author
                    could overwrite is a correction that will eventually be overwritten.
                  </p>
                </>
              ),
            },
            {
              k: 'C', tint: 'blue' as ExtendedTintName,
              t: 'The person tells us — and we settle it with them',
              d: (
                <>
                  <p>
                    The last path is the one where we did not get there first. They reply, and they are right. From
                    that moment the correction is not a broadcast at all — it is a conversation with one person, and it
                    is settled <em>with</em> them rather than delivered <em>at</em> them.
                  </p>
                  <p>
                    This path is the reason the other two are worth the effort. Everything that arrives by path C is
                    something paths A and B failed to catch, which makes it the honest measure of how well they work.
                  </p>
                </>
              ),
            },
          ].map((p) => (
            <div key={p.k} className="rounded-lg border border-border bg-surface-2 p-3.5">
              <p className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-stat text-[12px]"
                  style={{ background: TINT_VAR[p.tint], color: 'var(--surface)' }}>{p.k}</span>
                <span className="font-display text-[14px] font-bold leading-5 text-text-1">{p.t}</span>
              </p>
              <div className="mt-1.5 space-y-2 pl-[34px] text-[12.5px] leading-[1.65] text-text-2">{p.d}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.pink}` }}>
          <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.pink }} />
            Never twice: one mark per person, shared by all three paths
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            The mark that says <em>this person has been apologised to</em> belongs to the{' '}
            <strong>person</strong>, not to the path, not to the message and not to the incident&apos;s delivery
            attempt. All three paths read the same mark and all three set it. So a person who was corrected in seconds
            by path A does not then receive the rider from path B in front of their next message, and does not get a
            third apology when they mention it themselves.
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-3">
            Three separate marks — one per path — would be the natural design and would be exactly wrong: each path
            would be individually correct and the person would be apologised to three times. A second apology does not
            read as extra care. It reads as a system that is not listening.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
          <p className="text-[12.5px] font-semibold text-text-1">
            Two segments, or it waits — because a third segment charges the person for our mistake
          </p>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
            Path B has a hard limit, and it is a limit of politeness rather than of code. A correction riding in front
            of a real message must leave the whole thing inside <strong>two SMS segments</strong>. Where it will not
            fit, the correction is <strong>not claimed</strong> — it is left unmarked and waits for the next message,
            which means the mark above is untouched and the apology is still owed.
          </p>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
            The reason is plain: pushing our apology into a third segment makes the person&apos;s own message longer,
            and on some plans more expensive, because we got something wrong. An apology that costs the person money
            is not an apology.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.lavender}` }}>
          <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
            <Ear size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.lavender }} />
            The reply is the part that has to be handled
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            An apology always comes back. That is not a risk to be managed — it is the normal, expected result of
            saying sorry to a person, and it is the part that decides whether the apology was worth anything. Somebody
            will answer: to accept it, to ask what happened, to say they were confused for a week, or to be annoyed.
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            So the correction is <strong>not finished when it is sent</strong>. It is finished when the conversation it
            opens has been closed — read, answered by somebody with the authority to answer, and ended. A correction
            that goes out and leaves a reply hanging in a queue nobody watches has made things worse than the original
            mistake: the person now knows we noticed, and that we stopped caring immediately afterwards.
          </p>
        </div>

        <p className="text-[12.5px] text-text-3">
          <strong className="text-text-2">How this sits on the ladder.</strong> All three paths are paced as{' '}
          <code>repair</code>: they skip the pause between messages and they skip the weekend, and they{' '}
          <strong>obey quiet hours without exception</strong>. And the pacing decides nothing about permission — a
          correction still passes the opt-out list, the dial, the send door and test mode like everything else.
        </p>
      </Chapter>

      {/* ══ WHICH SOURCE ANSWERS "WHEN" ═════════════════════════════════ */}
      <Chapter
        id="ch-hours" icon={<CalendarClock size={17} />}
        title="Where the answer comes from when the sources disagree"
        lede="Two records answer the question when does this person work, and they do not always agree. The order between them was settled deliberately, and the reason is about people rather than about data."
      >
        <p>
          The platform holds two answers to <em>when does this person work</em>. One is the{' '}
          <strong>punch</strong> — the record of somebody clocking in and clocking out, a measurement of a person
          standing in a house. The other is the <strong>calendar</strong> — the schedule as it was planned, a statement
          of intent made in advance by somebody who was not necessarily there.
        </p>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface-2 p-3"
            style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
            <p className="text-[12.5px] font-semibold text-text-1">The punch speaks first</p>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-text-2">
              Where there is a punch, it wins. It is the only one of the two that is evidence of anything having
              happened: somebody was there, and the clock says when.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3"
            style={{ borderLeft: `3px solid ${TINT_VAR.blue}` }}>
            <p className="text-[12.5px] font-semibold text-text-1">Where the punch is silent, the calendar speaks</p>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-text-2">
              Silence is not an answer, so the question passes to the plan. The calendar is a weaker witness and it is
              a witness, which beats having none.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
          <p className="flex items-start gap-2 text-[12.5px] font-semibold text-text-1">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.amber }} />
            A silent punch is not evidence that nobody worked
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            This is the whole reason the order is not simply &ldquo;trust the measurement&rdquo;. An empty punch means{' '}
            <strong>nobody typed</strong>, and nothing more than that. It does not mean the shift did not happen, that
            the person was not there, or that the client was unattended. The plain fact, said often enough to
            be a rule: <em>people are in the habit of not filling the punch record in.</em>
          </p>
          <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.6] text-text-2">
            Read a gap as an absence and the platform starts drawing conclusions about people from an administrative
            habit: a worker who never types looks like a worker who never works. Falling through to the calendar is the
            refusal to make that inference.
          </p>
        </div>

        <p>
          <strong>Every reading carries its source on its own row.</strong> A measured hour and a planned hour are
          never allowed to look the same, anywhere they are shown, because the difference between them is exactly what
          a reader needs in order to know how much to believe. Two rows that read the same and mean different things
          are worse than one row missing.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5"
          style={{ borderLeft: `3px solid ${TINT_VAR.lavender}` }}>
          <p className="text-[12.5px] font-semibold text-text-1">
            And anything about tomorrow has no choice at all
          </p>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
            The punch record holds what happened, and it holds no tomorrow. So for any question about the
            future — when does this person next start, is there a shift to reach them before, what does next week look
            like — the calendar is not merely preferred, it is the <strong>only</strong> source there is. The
            precedence above applies to the past. The future has one witness, and the row still says so, so that a
            reader can tell a planned tomorrow from a measured yesterday at a glance.
          </p>
        </div>
      </Chapter>

      {/* ══ THE ANSWER BACK ═════════════════════════════════════════════ */}
      <Chapter
        id="ch-back" icon={<Ear size={17} />}
        title="What comes back, and how we know whose it is"
        lede="SMS is pushed to us; e-mail is not, so the platform reads its own mailbox on a clock. Then one question has to be answered before anything else can be: which thread is this?"
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[12.5px] font-semibold text-text-1">An SMS arrives by itself</p>
            <p className="mt-1 text-[12.5px] leading-[1.55] text-text-2">
              The phone door hands it over <em>after</em> its own row is safe, and the hand-over can never fail
              because of it. Two entrances: the public webhook, and the platform-verified <code>quoIngest</code>.
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.5] text-text-2">
              <strong>Captured before it is interpreted</strong>, and one provider message is one row: both entrances
              retry, so a message already filed answers <em>duplicate</em> and the ear fires exactly once.
            </p>
            <p className="mt-1.5 text-[12px] leading-[1.5] text-text-3">
              Note the asymmetry: <strong>the SMS ear has no dial check.</strong> An incoming text is always captured.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[12.5px] font-semibold text-text-1">E-mail has to be fetched</p>
            <p className="mt-1 text-[12.5px] leading-[1.55] text-text-2">
              Nobody pushes, so <code>commRepliesSweep</code> is rung by the platform&apos;s clock every ten minutes against its own
              fifteen-minute window, forty threads a pass. It refuses while the dial is off, <strong>marks nothing
              read and files nothing</strong> — the attendance sweep still finds its own reports in that inbox — and
              only feeds the capture when the sender is a known person <em>and</em> that person has a thread open.
            </p>
          </div>
        </div>

        <p className="pt-1">
          <strong>Before either level of judgement: correlation.</strong> A three-rung ladder, and the bottom of it
          is a refusal rather than a guess.
        </p>
        <ol className="space-y-2">
          {[
            ['1', 'A token we minted', 'The reference the message itself carried (CI-XXXXXX). The only rung that is proof. A token nobody has refuses outright rather than falling through to the next rung.', 'mint'],
            ['2', "The provider's own thread", 'The phone or the mail server threaded it for us.', 'blue'],
            ['3', 'Exactly one open intent', 'And only when there is exactly one. Two open threads and the correlation stops.', 'amber'],
            ['—', 'Otherwise: ambiguous', '“The most recent one” is a guess wearing a rule’s clothes. Matching on the sender alone is not on the ladder at all.', 'pink'],
          ].map(([k, t, d, tint]) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-stat text-[11px]"
                style={{ background: TINT_VAR[tint as ExtendedTintName], color: 'var(--surface)' }}>{k}</span>
              <span>
                <strong>{t}.</strong> <span className="text-text-2">{d}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="pt-1">
          <strong>What the reply claims is typed, never parsed into a settlement</strong>:{' '}
          <code>named</code> (it names the items), <code>whole</code> (a plain yes, and only when one item is open),{' '}
          <code>declined</code>, <code>unclear</code>, <code>stop</code>. <strong>Named items win over a bare
          yes</strong>, and a bare yes to a message carrying several items claims <em>nothing</em>: it is the
          commonest one-word answer there is and it names none of them. That typed claim is the{' '}
          <Term w="contribution" d="one reply, as a typed claim plus whatever the owner later said about it — the row that makes the authority boundary durable" />{' '}
          which the chapter on the two levels judges.
        </p>
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] leading-[1.55]">
          <MessageSquareReply size={14} className="mt-0.5 shrink-0 text-text-3" />
          <span>
            <strong>One thing is acted on immediately and never waits for a desk: a stop word.</strong> It goes
            straight to the platform-wide opt-out list. An opt-in releases those suppressions but never re-opens a
            thread the person stopped.
          </span>
        </p>
      </Chapter>

      {/* ══ CHAPTER 6 — THE CENTREPIECE ═════════════════════════════════ */}
      <Chapter
        id="ch-levels" icon={<Scale size={17} />}
        title="The two levels of the answer"
        lede="What the machine may decide alone, and exactly where it stops. This is the idea the whole lane is built around — and the one a naive implementation quietly breaks."
      >
        <div className="rounded-lg border border-border bg-surface-2 p-4" style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
          <p className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: TINT_VAR.mint }} />
            <span className="font-display text-[15px] font-bold leading-6 text-text-1">
              &ldquo;Communication cannot close a business condition.&rdquo;
            </span>
          </p>
          <p className="mt-1 pl-[24px] font-mono text-[11px] text-text-3">app/comm_replies.py — the rule the reply reader opens with</p>
        </div>

        {/* ---- level one ---- */}
        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Level one — the machine, reading a reply against the estate's own record
        </p>
        <p>
          The qualifier is handed three things: the binding, the typed claim, and the obligation's state{' '}
          <strong>re-read now</strong> from <code>requirement_states</code>. It answers in one of three words —{' '}
          <code>agrees</code>, <code>disagrees</code>, <code>unknown</code> — across four branches. <strong>Only one
          of them settles anything.</strong>
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-text-3">
                <th className="pb-1.5 pr-3 font-semibold">The reply claims</th>
                <th className="pb-1.5 pr-3 font-semibold">The estate holds</th>
                <th className="pb-1.5 pr-3 font-semibold">Verdict</th>
                <th className="pb-1.5 font-semibold">Settles?</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['—', 'nothing for this item right now', 'unknown', 'No', 'slate', false],
                ['it is handled', 'ok or na — they agree', 'agrees', 'YES — the only one', 'mint', false],
                ['it is not done', 'still open — they agree', 'agrees', 'No', 'blue', false],
                ['it is handled', 'still open — they disagree', 'disagrees', 'No, deliberately', 'amber', true],
              ].map(([claim, estate, verdict, settles, tint, hot]) => (
                <tr
                  key={String(estate)}
                  className="border-t border-border align-top"
                  style={hot ? { background: `color-mix(in srgb, ${TINT_VAR.amber} 14%, transparent)` } : undefined}
                >
                  <td className="py-2 pr-3 text-text-2">{claim as string}</td>
                  <td className="py-2 pr-3 text-text-2">{estate as string}</td>
                  <td className="py-2 pr-3">
                    <Pill tint={tint as ExtendedTintName}>{verdict as string}</Pill>
                  </td>
                  <td className={cn('py-2 text-[12.5px]', hot ? 'font-semibold text-text-1' : 'text-text-2')}>{settles as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: TINT_VAR.amber }}>
            The interesting case — and the one a naive implementation closes
          </p>
          <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
            They said it is handled. The estate still reads <em>expired</em>. Everything about the sentence invites
            the software to believe the person and close the item — and it refuses, on purpose, because the person may
            be right and the record may be stale, or the record may be right and the person mistaken, and a message is
            not the authority that can tell the two apart. So it settles nothing and puts the disagreement in front of
            a human.
          </p>
          <p className="mt-2 rounded bg-surface px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] text-text-3">
            /* THE INTERESTING CASE, and the one a naive implementation closes. */<br />
            why: &apos;they said it is handled; the estate still reads &lt;state&gt; — worth a look, not a settlement&apos;
            <br /><span className="text-text-3/70">— app/comm_replies.py</span>
          </p>
        </div>

        <Powers
          can={[
            <>That a binding <strong>the estate already holds as met</strong> may close — and the qualifier written on it is <code>estate</code>, never the reply.</>,
            <>That a reply is a <strong>disagreement worth a human</strong>.</>,
            <>Which bindings the reply <strong>left untouched</strong> — returned out loud, so a reply that advanced two of three leaves the third exactly as open as it was.</>,
          ]}
          cannot={[
            <><strong>Whether an obligation is met.</strong> That is the compliance catalogue's answer and this lane only ever reads it.</>,
            <>Anything about a requirement that is not already a binding of that thread.</>,
            <>Anything about a binding that is already settled.</>,
          ]}
        />

        {/* ---- level two ---- */}
        <p className="pt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Level two — a person with authority says the word
        </p>
        <p>
          The desk is the <strong>Replies</strong> page of this app. One door (<code>commContributionVerdict</code>),
          three roles (<code>admin</code>, <code>director</code>, <code>manager</code>), and three words only.
          Its queue is everything in <code>awaiting_owner</code> and <code>needs_human</code>, newest first.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['settled', 'mint', 'Closes exactly the demands the reply claimed or left awaiting, on their own binding rows — with the person\'s own address as the qualifier. The thread moves to answered only when nothing is left open.'],
            ['not_settled', 'amber', 'The thread keeps asking. The reply is on the record; the obligation is not.'],
            ['dismissed', 'slate', 'The reply is filed as noise.'],
          ].map(([k, tint, d]) => (
            <div key={k} className="rounded-lg border border-border bg-surface-2 p-3">
              <Pill tint={tint as ExtendedTintName}>{k}</Pill>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-text-2">{d}</p>
            </div>
          ))}
        </div>
        <p>
          <strong>There is no fourth word.</strong> <code>waived</code> is deliberately absent from the desk's
          vocabulary, because <em>excusing an obligation is the compliance catalogue's decision, not a desk's</em>.
          And nothing on that screen sends anything.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5">
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Two sharp edges, said rather than smoothed over
          </p>
          <ul className="space-y-2 text-[12.5px] leading-[1.6] text-text-2">
            <li>
              <strong>In production the <code>unknown</code> branch is unreachable.</strong> The lookup substitutes a
              literal <code>{'{ state: \'unknown\' }'}</code> for a demand the matrix no longer holds, so the state is
              never empty and the result is <em>disagrees</em>. Harmless to the boundary — it still settles nothing —
              but the desk labels such a row a <em>disagreement</em>.
            </li>
            <li>
              <strong>An honest plain &ldquo;no&rdquo; is filed as ambiguous.</strong> A <code>declined</code> claim lands
              neither in the settled set nor in the awaiting set, so the row becomes <code>needs_human</code> with the
              reason <em>ambiguous</em>. A person still reads it; the label is simply wrong about why.
            </li>
          </ul>
        </div>
      </Chapter>

      {/* ══ CHAPTER 7 ═══════════════════════════════════════════════════ */}
      <Chapter
        id="ch-written" icon={<Landmark size={17} />}
        title="What is written down, and who owns it"
        lede="Eleven places a row is written, each one a house resolved by pointer and never by tab name. Three of them are records of the same events with three different owners and three different lifetimes."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-text-3">
                <th className="pb-1.5 pr-3 font-semibold">House</th>
                <th className="pb-1.5 pr-3 font-semibold">What it holds</th>
                <th className="pb-1.5 font-semibold">How it is written</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['comm_intents', 'one person\'s thread: state, verdict, reasons, channel, both attempt memories, escalation, reply token', 'upsert, column-preserving', 'blue'],
                ['comm_bindings', 'one obligation inside a thread, with its own state — open, settled, deferred, superseded', 'upsert', 'blue'],
                ['comm_attempts', 'one attempt: channel, masked number, provider receipt, error, doubt', 'append-only', 'mint'],
                ['comm_observations', 'the trail, indexed by thread — sent, redirected, held, escalated, replied, correlated, settled, stopped', 'append-only, best-effort, never throws', 'mint'],
                ['comm_contributions', 'what a reply proposed and what the owner said back', 'upsert, keyed by the message id', 'blue'],
                ['comm_routes', 'the cortex\'s proposal per person: phone, e-mail, and the reachable window it now computes from their sleep', 'upsert — whole-row overwrite', 'amber'],
                ['smart_comms_sent', 'the catalogue\'s ledger, shared with the older lanes; a rehearsal is never written here — test mode keeps its messages in app.comm_rehearsal', 'append', 'mint'],
                ['entity_opt_outs', 'who asked us to stop; released by an opt-in', 'append / release stamp', 'pink'],
                ['quoMessages', 'the phone\'s own mirror, written before the ear ever fires', 'append, deduped by message id', 'mint'],
                ['the mail log', 'what left through the platform mailbox', 'append', 'mint'],
                ['system_logs', 'the platform-wide log, for the refusals worth a shout', 'append', 'slate'],
              ].map(([k, v, how, tint]) => (
                <tr key={k as string} className="border-t border-border align-top">
                  <td className="py-2 pr-3 font-mono text-[12px] text-text-1">{k as string}</td>
                  <td className="py-2 pr-3 text-text-2">{v as string}</td>
                  <td className="py-2"><Pill tint={tint as ExtendedTintName}>{how as string}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12.5px] text-text-3">
          Three clocks ride in Postgres alongside them: <code>comm_record_last_run</code> and{' '}
          <code>comm_record_cursor</code> in <code>app.comm_record_state</code>, <code>comm_mail_last_run</code> in{' '}
          <code>app.comm_replies_state</code>.
        </p>

        <p>
          <strong>Six of those eleven are this lane&apos;s own houses</strong> — the first six in the table, the ones
          whose names begin <code>comm_</code>. Each is an <em>ASA Data — …</em> workbook declared by three facts in
          the platform&apos;s own settings book plus a registry row, and{' '}
          <strong>resolved by pointer, never by tab name</strong>: a tab somebody renames does not move a house, and a
          tab somebody creates with the right name does not become one. All six render inside the platform&apos;s Render
          Sheet app, as spreadsheets, without leaving the platform — and the mirror carries all six across to the
          cortex&apos;s side, which is the only way anything in this lane reaches the intelligence project at all.
        </p>

        <p className="pt-1">
          <strong>Why three records of what looks like one event.</strong> The{' '}
          <Term w="ledger" d="smart_comms_sent — the catalogue's own record of what really went out, shared with the older lanes" />{' '}
          is the catalogue's shared history. The{' '}
          <Term w="evidence house" d="comm_attempts — this lane's per-attempt receipt: channel, masked number, provider receipt, error" />{' '}
          is this lane's per-attempt receipt. The{' '}
          <Term w="trail" d="comm_observations — append-only, and only ever committed results; never intentions" />{' '}
          is what actually completed. Three owners, three lifetimes; folding them into one would make every one of them
          less trustworthy than it is.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">
            The trail&apos;s whole vocabulary — everything that COMPLETED, in the Asset Manager&apos;s own grammar
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['sent', 'redirected', 'doubt', 'held', 'escalated', 'unanswered', 'replied', 'correlated',
              'contribution', 'needs_human', 'settled', 'dismissed', 'stopped', 'consent_changed'].map((w) => (
              <span key={w} className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11.5px] text-text-2">
                {w}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-2">
            Indexed by the thread and <strong>never rewritten</strong> — only ever appended, and only ever for
            something that actually happened, never for something that was intended. That trail is what the cortex
            reads.
          </p>
        </div>

        <p>
          <strong>And two memories, kept apart on every thread.</strong> A test-mode send reaches a tester, not the
          person. Counted as production, three days of rehearsal would leave somebody &ldquo;exhausted&rdquo; —
          escalated, never asked — on the morning test mode came off. So each thread keeps its production memory and
          its test memory separately, and production never reads a test-era row.
        </p>

        {/* ---- the honest breakdown ---- */}
        <div className="rounded-lg border border-border bg-surface-2 p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Who actually closed an item — the only honest breakdown of <em>why</em> something closed
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Stat value={n((l) => l.closedBy.engine)} label="by the engine — the obligation simply stopped being open" tint="slate" />
            <Stat value={n((l) => l.closedBy.estate)} label="by the estate, on a reply that agreed with it" tint="mint" />
            <Stat value={n((l) => l.closedBy.person)} label="by a named person at the desk" tint="blue" />
            {live && live.closedBy.unsaid > 0 ? (
              <Stat value={live.closedBy.unsaid} label="settled with no qualifier on the row" tint="amber" />
            ) : null}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Stat value={n((l) => l.itemStates.open)} label="items still open" tint="amber" />
            <Stat value={n((l) => l.itemStates.deferred)} label="deferred" tint="lavender" />
            <Stat value={n((l) => l.itemStates.superseded)} label="superseded" tint="slate" />
          </div>
          <p className="mt-2.5 text-[12.5px] leading-[1.6] text-text-2">
            <Term w="supersede" d="to mark a row as no longer live without deleting it — a binding the thread no longer carries, or a whole old-generation thread" />{' '}
            is how this lane forgets: nothing is deleted, it is marked as no longer live and kept as history.
          </p>
        </div>

        <Wrong
          claim="A settled binding, or an answered thread, means the conversation worked."
          natural="“Settled” and “answered” are the vocabulary of a closed conversation, and they sit on the same rows as the reply."
        >
          <p>
            Most settled bindings were never answered by anybody. The sweep writes <code>binding_state: settled</code>{' '}
            with <code>qualified_by: engine</code> the moment the obligation stops being open in{' '}
            <code>requirement_states</code> — somebody filed a document through an entirely different door. Only{' '}
            <code>estate</code> or a person's e-mail address came out of the answer back. The numbers just above are
            the breakdown; read them before reading a settlement as a success.
          </p>
        </Wrong>
      </Chapter>

      {/* ══ THE CORTEX ══════════════════════════════════════════════════ */}
      <Chapter
        id="ch-cortex" icon={<Brain size={17} />}
        title="The cortex — both directions"
        lede="It reads the estate and proposes how to reach somebody; it suggests a name and decides nothing; and it learns back from what the lane recorded. Three verbs, and the boundary between them is the point."
      >
        <IllNote>
          Everything counted in this chapter is measured on the intelligence side, which has no door into this app.
          The numbers are the ones the written explanation was drawn against; the sentences around them are the
          part that stays true.
        </IllNote>

        {/* ---- reading ---- */}
        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Reading — what it is allowed to look at
        </p>
        <p>
          The reader takes <strong>only contact and shift facts</strong> — never an appraisal, never an incident,
          never anything about how somebody is doing their job. A route is a question about how to reach a person, and
          letting a judgement about them into it would make the answer a different kind of thing entirely.
        </p>
        <p>
          It drops the contacts marked synthetic, keeps only numbers marked active, and proposes one route and one
          awake window per person. The sweep then <strong>narrows</strong> each person&apos;s quiet hours with that
          window — narrowed, never widened, which is the arithmetic the chapter on waiting explains.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Ill v="533 of 2,235">contacts dropped as synthetic</Ill>
          <Ill v="200">routes proposed</Ill>
          <Ill v="157">with a phone</Ill>
          <Ill v="147">with a window</Ill>
        </div>

        {/* ---- suggesting ---- */}
        <p className="pt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Suggesting — a name on a row, and nothing else
        </p>
        <p>
          The graph holds a set of &ldquo;managed by&rdquo; edges, extracted by pattern from text and carrying visible
          artifacts. Almost all of them are thrown away. Only edges that clear a confidence floor, that were seen at
          least three times, and <strong>whose both ends resolve to somebody the routes already name</strong>, survive.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Ill v="226">edges held</Ill>
          <Ill v="0.72">mean confidence</Ill>
          <Ill v="0.80">the floor, plus three sightings</Ill>
          <Ill v="11">survive</Ill>
        </div>
        <p>
          The surviving name rides on the row with its confidence beside it, and the sweep copies it onto the thread
          when a budget runs out. <strong>Nothing messages that person.</strong> The graph suggests; the policy
          decides; and a lane that wrote to a name because a cell had been filled in would be the graph deciding, which
          is precisely the thing this arrangement exists to prevent.
        </p>

        {/* ---- learning ---- */}
        <p className="pt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Learning — the loop closes over the mirror, not over a new door
        </p>
        <p>
          The emitter that files a fact into the cortex is an in-process function of the intelligence project with no
          HTTP door, so <strong>nothing new crosses the boundary</strong> for this. The Hub writes its houses in
          Postgres; asa-hub-sheet-sync carries them to their sheets and the mirror carries those across; and a
          scheduled reader on the far side derives the events the design names —{' '}
          <code>comm.qualified</code>, <code>comm.unanswered</code>, <code>comm.route_corrected</code>,{' '}
          <code>comm.consent_changed</code> — and files each one exactly once.
        </p>
        <p>
          Its first live pass found <Ill v="11">route corrections</Ill> — people the platform reached on a number the
          graph had not proposed, which is exactly the evidence the design wanted for lifting a weak identity link off
          the floor it was stuck at.
        </p>
        <p className="text-[12.5px] text-text-3">
          <strong className="text-text-2">And one honest note about that first pass.</strong> The reader asks whether
          an engine is listening before it files. Its first run taught nothing and filed its rows anyway, because the
          emitter answers <em>success</em> whether or not an engine is wired behind it — and the ledger that records
          &ldquo;taught&rdquo; is exactly what stops an event ever being taught again. A success that is not a success
          is the most expensive kind of bug in a loop that only runs once per fact.
        </p>
      </Chapter>

      {/* ══ READING THE BOARD ═══════════════════════════════════════════ */}
      <Chapter
        id="ch-honest" icon={<Eye size={17} />}
        title="Reading the board honestly"
        lede="Six numbers on this board mean something narrower than their names suggest. A screen that prints them at face value over-claims — which is why this page does not."
      >
        <div className="space-y-2">
          {[
            ['“Asked” counts claims, not deliveries.',
             'attempts is bumped BEFORE the send and given back only on a definite non-send; on a transport doubt the claim is deliberately kept. So “asked” means “we committed to an ask”, which is one more than “a message provably left” whenever the transport was uncertain. What actually left lives in comm_attempts and in the ledger — and neither is reachable from this door.'],
            ['test_mode: yes means “written during a test-mode pass”, not “sent to a tester”.',
             'It is stamped from the verdict, whether or not anything was ever handed over. Over a record board, a screen that labels that count “sent to the testers only” is describing sends that never happened.'],
            ['open_count is not a second number.',
             'Every binding the planner builds starts open, so it always equals carried. Printing both reads as two measurements of one thing.'],
            ['escalate_to has never held a name.',
             'The platform hands the whole computed row over and the Hub\'s ingest builds its upsert without the three supervisor columns, then overwrites the declared header with blanks. The chapter on what is not built has the detail. No “supervisor suggested” count appears on this page because none could ever be true.'],
            ['channel changes meaning mid-life.',
             'On a held row it is the route consent would permit; on a sent row it is the channel that actually carried it. One column, two questions — never aggregate it.'],
            ['purpose is a constant and tenant is always blank.',
             'purpose is compliance.owed on every row today, so a breakdown of either is always one bar.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] font-semibold leading-[1.5] text-text-1">{t}</p>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-text-2">{d}</p>
            </div>
          ))}
        </div>
        <p>
          And one thing the door itself insists on saying rather than letting a screen guess:{' '}
          <strong>an empty board means two opposite things.</strong> Empty at <code>off</code> is correct; empty at{' '}
          <code>record</code> means the sweep has not come round yet. That is what the sentence under the hero is for.
        </p>
        <p className="text-[12.5px] text-text-3">
          Everything the board <em>can</em> honestly report is already above: threads by state, threads by policy
          verdict, obligations carried and deferred, the folded asks, the item states, and who closed each item.
          The rest is per-row evidence — reasons, route tried, reply token, last error — which the rehearsal board
          shows one row at a time, because it is evidence and not an aggregate.
        </p>
      </Chapter>

      {/* ══ THE DESIGN, MEASURED ════════════════════════════════════════ */}
      <Chapter
        id="ch-measured" icon={<ClipboardCheck size={17} />}
        title="The design, measured — and what the review found"
        lede="The lane was drawn before it was written. Held against its own diagrams afterwards, it comes out in three piles: built as designed, built differently with the reason in the code, and still open."
      >
        <div className="space-y-2.5">
          <div className="rounded-lg border border-border bg-surface-2 p-3.5"
            style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <Check size={14} className="shrink-0" style={{ color: TINT_VAR.mint }} />
              Built as designed
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.65] text-text-2">
              The reader fixes; the lane gate&apos;s whitelist; the spine — one intent per person, the cap said out
              loud, the evidence fold; the roster as law; the house protocol, now over six houses; the policy; consent
              folded to one truth; the transport as the only door; the clock; the evidence houses; the cortex&apos;s
              route and window in the plan; the answer back with its authority boundary; and the loop closing through
              the emitter.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5"
            style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <AlertTriangle size={14} className="shrink-0" style={{ color: TINT_VAR.amber }} />
              Built differently, with the reason in the code
            </p>
            <ul className="mt-1.5 space-y-2 text-[12.5px] leading-[1.6] text-text-2">
              <li>
                <em>&ldquo;The dispatcher is the only effect.&rdquo;</em> The platform already has one door out, so the
                lane translates and hands over — and the guarantee that actually matters, one voice per person, is kept
                by leaving owned credentials to the reminder lane rather than by making anybody unable to send.
              </li>
              <li>
                <em>&ldquo;A changed payload is a conflict.&rdquo;</em> The key is the thread. A changed open set
                supersedes items and keeps the memory, because that set changes on every sweep by nature — treating
                it as a conflict would restart the conversation with every document somebody files.
              </li>
              <li>
                <em>&ldquo;A confidence floor.&rdquo;</em> The contacts table has no confidence column. The floor is
                the truth state instead, plus a filter for synthetic sources that the diagram did not foresee.
              </li>
              <li>
                <em>&ldquo;Reuse the emitter.&rdquo;</em> Reused — but from <em>this</em> side of the boundary, over
                the mirror, because the emitter has no door to call.
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5"
            style={{ borderLeft: `3px solid ${TINT_VAR.pink}` }}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <X size={14} className="shrink-0" style={{ color: TINT_VAR.pink }} />
              Still open
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.65] text-text-2">
              The inbound path is wired to the <strong>SMS</strong> door; a reply by <em>e-mail</em> is not read yet —
              the mailbox&apos;s other doors were only routed recently. Escalation is a suggestion on a row and on a
              board: no policy acts on it, by choice. The phone provider&apos;s webhooks now post to the platform&apos;s
              own door, which checks the key before it believes an event.
            </p>
          </div>
        </div>

        <p className="pt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-3">
          What the review found
        </p>
        <p>
          Sixteen readers mapped the lane and its neighbours and returned a pile of findings; a second swarm then held
          the code against the two design diagrams, phase by phase.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Ill v="122">files mapped</Ill>
          <Ill v="43">sound</Ill>
          <Ill v="42">worn</Ill>
          <Ill v="30">defective</Ill>
          <Ill v="7">dead</Ill>
          <Ill v="230">findings returned</Ill>
        </div>
        <p className="text-[12.5px] text-text-3">
          <strong className="text-text-2">And the caveat that goes with them.</strong> The adversarial verification of
          the long tail did not finish. So beyond the items below, a finding is{' '}
          <strong>a reader&apos;s claim and not a confirmed defect</strong> — which is a different thing, and this page
          will not print it as the same thing.
        </p>

        <div className="rounded-lg border border-border bg-surface-2 p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Verified by hand and closed
          </p>
          <ul className="mt-2 space-y-2 text-[12.5px] leading-[1.6] text-text-2">
            <li>Google&apos;s own &ldquo;shared with you&rdquo; mail going out on every screening report and upload, outside every sink we control.</li>
            <li>A redirected receipt cached as a real one, disarming the real ask for six hours afterwards.</li>
            <li>The mail door not saying it had redirected — so a tester&apos;s copy was recorded as the directors&apos; letter, and a rehearsal spent an announcement&apos;s once-per-app stamp.</li>
            <li>The public referral door trusting a caller-supplied résumé link.</li>
            <li>The inbox addressed by position rather than by identity — a position that is reused the moment the inbox is filed — in the listing, then in the locator, the flagging and the filing. Every address is a stable id now.</li>
            <li>The weekly digest with no weekly memory; a deduplicated receipt filed as a failure with no reason; the attendance sweep with no lock; a report the reader refuses being filed away with nobody alerted.</li>
            <li>The app losing the server&apos;s refusal sentence when it arrives in the error field, and four screens writing a shared config nobody invalidated.</li>
            <li>The routes hand-off hashing five fields, so a new column could never reach the house.</li>
          </ul>
        </div>
      </Chapter>

      {/* ══ WHAT IS NOT BUILT ═══════════════════════════════════════════ */}
      <Chapter
        id="ch-notbuilt" icon={<Hammer size={17} />}
        title="What is not built"
        lede="A guide that only lists triumphs teaches a false platform. The honest gaps, and one correction to what this page itself used to say."
      >
        <div className="space-y-2.5">
          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.pink}` }}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <AlertTriangle size={14} className="shrink-0" style={{ color: TINT_VAR.pink }} />
              Nothing stores what a message <em>said</em> — so nobody can be told they got the wrong words
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              The evidence row answers <em>who, when and how</em>: <code>comm_attempts</code> carries the intent, the
              person, the attempt number, the channel, the masked address, the provider receipt and the time. It
              carries <strong>no body, no digest, no situation, no sender and no code build</strong>. The rendered text
              lives for the length of one call and is then gone. So when the platform learns that a sentence it sent
              was wrong — the incident behind this was a <em>publish</em>, where the wrong company name came from a
              code constant and no send record carries the build — it cannot work out which people are holding the old
              words.
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              The detector is written against three columns that do not exist yet — <code>words_sha</code>,{' '}
              <code>situation</code>, <code>sender_used</code> — and answers <code>computable: false</code> rather than
              guessing. It deliberately does <strong>not</strong> re-render the template to reconstruct what somebody
              was sent: re-rendering produces the <em>corrected</em> words and would quote back to a person something
              they were never sent, which is worse than silence. Those columns are being added; until they land, this
              page says so.
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              <strong>What is already computable is the audience.</strong> Given a situation and a window, the
              catalogue&apos;s own ledger — <code>smart_comms_sent</code>, the one house in the platform that records
              which situation a person was told under — names exactly who holds a message from it, minus rehearsals and
              minus anything our own evidence recorded as redirected or test-mode. That turns &ldquo;a human types a
              list of names&rdquo; into &ldquo;a human confirms a list the platform already has&rdquo;. And a person
              still declares that the words were wrong: the machine detects that words <em>changed</em>, never that
              they were <em>wrong</em>, because a better-worded sentence is not an apology.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.pink}` }}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <AlertTriangle size={14} className="shrink-0" style={{ color: TINT_VAR.pink }} />
              Escalation is a suggestion nobody acts on — and nothing <em>can</em> act on it
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              The policy sets <code>escalate</code> when a thread crosses the attempt budget, records it once, and emits{' '}
              <em>escalated</em> / <em>unanswered</em> into the trail.{' '}
              {live ? <><strong>{live.escalated}</strong> thread{live.escalated === 1 ? ' is' : 's are'} past that budget right now.</> : <>The board has not said how many threads are past that budget.</>}{' '}
              Nothing reads the flag afterwards: no send, no route, no notification.
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              And the name it would escalate <em>to</em> is structurally empty. The graph computes a supervisor, the
              platform faithfully hands the whole row over — the digest was widened precisely so the new column would travel — and
              the Hub's ingest builds its upsert <strong>without</strong> the three supervisor columns while the writer
              overwrites the whole declared header. So the columns arrive blank on every hand-off and{' '}
              <code>escalate_to</code> has never held a name. That is why no such number appears anywhere on this page.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.pink}` }}>
            <p className="text-[12.5px] font-semibold text-text-1">In test mode the end-to-end answer back is not exercisable</p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              With test mode on, no message reaches anybody, so <strong>no real reply comes back at all</strong> — the
              answer back can only be exercised with test mode off. A reply that does come from one of our own lines
              is recorded as <code>own_line</code> and goes no further.{' '}
              <strong>One caveat that matters: that guard covers SMS only.</strong> An e-mail reply from a tester who is
              himself in the People house is matched as himself, and if he has exactly one open thread the sole-open rung
              will correlate it — against his own obligations.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
            <p className="text-[12.5px] font-semibold text-text-1">The lease desk has no caller</p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              The desk&apos;s claim-and-lease model (<code>app/comm_replies.py</code>) — claim a row, act on it, let the lease lapse — is written
              and proven, and nothing in production calls it. Only its reason-labelling helper is used. The Replies screen
              answers the same need without it. Two other functions in the lane are likewise callerless.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
            <p className="text-[12.5px] font-semibold text-text-1">Two houses are not yet on the Render Sheet app's list</p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              <code>comm_contributions</code> and <code>comm_observations</code> exist and are being written; they are read
              today through the Replies screen and through the trail respectively, and not yet as sheets in that app.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-text-1">
              <Check size={14} className="shrink-0" style={{ color: TINT_VAR.mint }} />
              A correction: the loop's reader exists now, and is scheduled
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              This page used to say the loop cannot close because <code>ce_emit</code> has no HTTP door, and that the honest
              path remained a reader on the Python side. <strong>That reader now exists.</strong>{' '}
              <code>app/analytics/comm_events.py</code> reads all six houses out of the sheets-to-Postgres mirror and derives
              six event types — <code>comm.qualified</code>, <code>comm.unanswered</code>,{' '}
              <code>comm.route_corrected</code>, <code>comm.consent_changed</code>, <code>comm.reply_unplaced</code>,{' '}
              <code>comm.reply_unclear</code> — filing each exactly once. It refuses a mirror older than an hour, refuses to
              file at all when no cognition engine is wired, and suppresses unplaced-reply events entirely while the lane is
              rehearsing. It runs as the scheduler job <code>comm_events</code>. Note that{' '}
              <code>comm.unanswered</code> needs only the escalate flag — it does not depend on the missing supervisor name.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 p-3.5" style={{ borderLeft: `3px solid ${TINT_VAR.slate}` }}>
            <p className="text-[12.5px] font-semibold text-text-1">And the plainest one: the compliance situation ships OFF</p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
              Whether any of this speaks at all is still one switch on the Desk plus <code>HUB_RPC_SEND</code>.
            </p>
          </div>
        </div>
      </Chapter>

      {/* ══ CHAPTER 10 ═══════════════════════════════════════════════════ */}
      <Chapter
        id="ch-before" icon={<Rocket size={17} />}
        title="Before anybody real hears anything"
        lede="Turning test mode off is one cell. Everything else on this list is a decision, not a deploy."
      >
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Set <code>test_mode</code> off in <em>Settings → Test mode</em>. The sinks pass letters through, the ledger
            stops writing <em>rehearsal</em>, and the lane paces on the production memory rather than the test one.
          </li>
          <li>
            <strong>Decide the words, and switch the situation on.</strong> <code>compliance_bundle</code> ships{' '}
            <code>enabled:&apos;no&apos;</code>, and a publish can never change that — the Desk does, by id.
          </li>
          <li>
            Decide the pace: the gap per band and the attempt cap, in the words book&apos;s Digest Settings (the
            Catalogue prints what each one says now).
          </li>
          <li>
            <strong>Decide what, if anything, may be paced above an ordinary ask.</strong> The ladder in the chapter on waiting is
            built and its membership is empty on purpose — <code>comm_priority_repair</code> is a cell, and nothing is
            filed under it until a correction purpose and a correction situation exist. Leaving it empty is a valid
            answer; filling it without reading that chapter is not.
          </li>
          <li>
            Turn on <code>HUB_RPC_SEND</code>. Settings can pause it afterwards; nothing in Settings can start it.
          </li>
          <li>
            <strong>Agree who watches the Replies desk.</strong> A reply the estate cannot confirm waits there, visibly —
            and waits forever if nobody looks.{' '}
            {live ? <>Right now the board is holding <strong>{live.threads}</strong> thread{live.threads === 1 ? '' : 's'}.</> : null}
          </li>
          <li>
            Decide who owns escalation — and note that until the route ingest carries the supervisor columns, there is no
            name on the row to route to. That is a code fix, not a cell.
          </li>
          <li>
            <strong>Done: the phone provider&apos;s webhooks post to the platform&apos;s own door</strong>, which checks
            the key before it believes an event — no longer straight to a script that believed an event because it
            arrived.
          </li>
          <li>
            <strong>Wire the e-mail half of the answer back — or say plainly that replies are read from SMS only.</strong>{' '}
            Either answer is fine and silence is not: a person who replies to an e-mail and hears nothing has been
            ignored by a machine that told them to reply.
          </li>
        </ol>
        <p className="pt-1 text-[12.5px] text-text-3">
          Everything on this page was read out of the platform&apos;s own sources — <code>app/comm_*.py</code> and{' '}
          <code>app/smart_comms*.py</code> in asa-hub-app — and the intelligence project&apos;s analytics. Where a
          claim could not be found in code, it is not here — and where a
          figure could not be asked of a live door, it is marked as an illustration and not as a count.
        </p>
      </Chapter>

      {/* ══ WHERE TO LOOK ═══════════════════════════════════════════════ */}
      <Chapter
        id="ch-where" icon={<Compass size={17} />}
        title="Where to look"
        lede="Every part of this explanation has a screen or a book behind it. This is which one, so the guide is a map and not only a story."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[12.5px]">
            <tbody>
              {[
                ['Smart Comms → Desk', 'the situations: on or off, the words, the recipients'],
                ['Smart Comms → Activity', 'the ledger — what really went out'],
                ['Smart Comms → Rehearsal', 'the lane’s board: who, about what, the verdict and every reason, both memories, the reply reference, the escalate chip'],
                ['Smart Comms → Replies', 'what people answered, and what waits for your word'],
                ['Smart Comms → How it works', 'this explanation, inside the app, with the live mode on top'],
                ['Render Sheet', 'the lane’s six houses as spreadsheets, inside the platform'],
                ['Settings → Test mode', 'test mode and the testers'],
                ['Smart Comms › Desk', 'the situations — their words and their switches, kept in Postgres'],
                ['The words book', 'the bindings and the lane’s policy cells (Digest Settings); the dial follows test mode'],
              ].map(([where, what]) => (
                <tr key={where} className="border-t border-border align-top first:border-t-0">
                  <td className="py-2 pr-3 text-[12.5px] font-semibold text-text-1">{where}</td>
                  <td className="py-2 text-text-2">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12.5px] text-text-3">
          The source of record for this explanation is the Smart Comms handoff under <code>docs/asa-hub/</code>.
          Everything it describes is carried by commits on the Hub and on the intelligence side — the document names
          them; this page carries the reasoning.
        </p>
      </Chapter>
    </div>
  )
}
