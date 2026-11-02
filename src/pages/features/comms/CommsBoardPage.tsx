// THE COMMS REHEARSAL — who this platform would contact, about what, and why.
// It follows Behavior Support's layout — the header at least — and brings all of this into one view.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Ban, CalendarOff, Check, ChevronDown, ChevronUp,
  Clock, Moon, PhoneOff, RefreshCw, Search, Timer, type LucideIcon,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { TINT_BG, TINT_FG, heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'

type Binding = {
  demand_id: string; req_id: string; state: string
  expires: string; days_left: string; band: string; binding_state: string
}
type Intent = {
  intent_key: string; person_key: string; person_name: string
  purpose: string; state: string; worst: string
  dial: string; verdict: string; reasons: string
  carried: string; deferred: string; open_count: string
  planned_at: string
  // what the sweep remembers and what it did: two memories, because a test send must never count against the person…
  attempts?: string; last_asked_at?: string
  test_attempts?: string; test_last_asked_at?: string; test_mode?: string
  channel?: string; reply_token?: string; last_error?: string
  escalate?: string; escalate_why?: string
  items?: Binding[]
}

/* a date the way a person reads one; the ISO stamp stays in the title */
function when(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ------------------------------------------------------------------ WHY THIS PERSON CAN OR CANNOT BE SPOKEN TO…
const REASON_LABELS: Record<string, string> = {
  priority: 'Priority', attempts: 'Attempts', gap: 'Pace', pace: 'Pace',
  window: 'Hour', moment: 'Hour', skipped: 'Queue jumped', route: 'Route',
  reach: 'Route', words: 'Words', dial: 'Dial',
}
type Clause = { key: string; label: string; text: string }

function readReasons(raw?: string): Clause[] {
  const out: Clause[] = []
  for (const piece of String(raw || '').split(' · ')) {
    const s = piece.trim()
    if (!s) continue
    const m = /^([a-z]+):\s*/.exec(s)
    const key = m ? m[1] : ''
    if (m && REASON_LABELS[key]) out.push({ key, label: REASON_LABELS[key], text: s.slice(m[0].length) })
    else if (out.length) out[out.length - 1].text += ' · ' + s
    else out.push({ key: 'other', label: 'Reason', text: s })
  }
  return out
}

// THE THREE DIFFERENT "NOT NOW"S.
type HoldKind = 'none' | 'pace' | 'hour' | 'weekend' | 'calloff' | 'spent'

const HOLD: Record<HoldKind, { tint: ExtendedTintName; label: string }> = {
  none: { tint: 'blue', label: 'Clear' },
  pace: { tint: 'amber', label: 'Held — the pace' },
  hour: { tint: 'lavender', label: 'Held — the hour' },
  weekend: { tint: 'lavender', label: 'Held — the weekend' },
  calloff: { tint: 'lavender', label: 'Held — not at work' },
  spent: { tint: 'pink', label: 'Spent — a person\'s job' },
}

type Reading = {
  clauses: Clause[]
  hold: HoldKind
  /** false when the rule fired and was RECORDED rather than obeyed (test mode) */
  enforced: boolean
  priority: string
  jumped: string
  /** the clock hour the planner read. The SERVER's, never the recipient's. */
  hour: number | null
  clockKnown: boolean
  /** what set this person's quiet hours — the platform's own, or their shifts */
  quietWhy: string
  narrowed: boolean
  sleeps: string
  reachable: string
  heldUntil: string
  noRoute: boolean
  gap: string
  window: string
  route: string
}

const soft = (t: string) => /not enforced in test mode/.test(t)

function readRow(r: Intent): Reading {
  const clauses = readReasons(r.reasons)
  const of_ = (...keys: string[]) =>
    clauses.filter((c) => keys.indexOf(c.key) !== -1).map((c) => c.text).join(' · ')
  const attempts = of_('attempts')
  const gap = of_('gap', 'pace')
  const win = of_('window', 'moment')
  const route = of_('route', 'reach')

  // THE PLANNER STOPS AT THE FIRST RULE THAT REFUSES — except in test mode, where a refusal it will not obey is…
  const refusals: { kind: HoldKind; text: string }[] = []
  if (/with no answer|is spent/.test(attempts)) refusals.push({ kind: 'spent', text: attempts })
  if (/the floor is|the test pace is/.test(gap)) refusals.push({ kind: 'pace', text: gap })
  if (/not at work today/.test(win)) refusals.push({ kind: 'calloff', text: win })
  else if (/^quiet hours/.test(win)) refusals.push({ kind: 'hour', text: win })
  else if (/^a weekend/.test(win)) refusals.push({ kind: 'weekend', text: win })
  const decided = refusals.filter((x) => !soft(x.text))[0] ?? refusals[0] ?? null

  // "(2:00 local; narrowed by their own shifts: …)".
  const parens = /\((\d{1,2}):00 local(?:;\s*(.*))?\)/.exec(win)
  const quietWhy = (parens && parens[2] ? parens[2] : '').trim()
  const sleeps = /so (\d{1,2}:00-\d{1,2}:00) is when they sleep/.exec(quietWhy)
  const reachable = /reachable (\d{1,2}:00-\d{1,2}:00)/.exec(quietWhy)
  const until = /held until ([^—]+)/.exec(win)
  const pri = /^([a-z]+)\s*\(/.exec(of_('priority'))

  return {
    clauses,
    hold: decided ? decided.kind : 'none',
    enforced: decided ? !soft(decided.text) : true,
    priority: pri ? pri[1] : '',
    jumped: of_('skipped'),
    hour: parens ? Number(parens[1]) : null,
    clockKnown: !/no local clock/.test(win),
    quietWhy,
    narrowed: /narrowed by their own shifts/.test(quietWhy),
    sleeps: sleeps ? sleeps[1] : '',
    reachable: reachable ? reachable[1] : '',
    heldUntil: until ? until[1].trim() : '',
    noRoute: /no permitted route/.test(route),
    gap, window: win, route,
  }
}

// THE ONE SENTENCE A READER SHOULD NOT HAVE TO ASSEMBLE.
function saySo(r: Intent, d: Reading): string {
  if (r.state === 'stopped') {
    return 'This person asked us to stop. Nothing on this thread may be sent at all, and only a person can release it.'
  }
  // A ROW WITH NO REASONING GETS NO SENTENCE.
  if (!d.clauses.length) {
    return 'This row carries no reasoning, so why it stands where it does cannot be read here.'
  }
  const tail = d.enforced ? '' : ' — recorded, not enforced in test mode'
  switch (d.hold) {
    case 'spent':
      return 'The attempt budget is spent. Silence is the answer now, and this is a person\'s job rather than a reminder\'s' + tail + '.'
    case 'calloff':
      return 'They are not at work today, so the whole day is quiet for them' +
        (d.heldUntil ? ` — held until ${d.heldUntil}` : '') + tail + '.'
    case 'hour':
      return `Held by the hour: ${d.hour}:00 on the server's clock falls inside their quiet hours` +
        (d.narrowed
          ? (d.sleeps
            ? ` — narrowed by their own shifts, which put them asleep ${d.sleeps}`
            : ' — narrowed by their own shifts')
          : ' — the platform\'s own, which is all the cortex knows for them') + tail + '.'
    case 'weekend':
      return 'Held by the day: it is the weekend, and compliance is not urgent enough to cost one' + tail + '.'
    case 'pace':
      return `Held by the pace: ${d.gap}${tail}.`
    default:
      break
  }
  if (d.noRoute) {
    return 'The policy would speak, but there is no permitted channel — consent grants none of the routes this purpose may use, so nobody can be reached at all.'
  }
  // The verdict says it did not clear and no clause here says which rule did it: the honest answer is that this…
  if (r.verdict !== 'would send') {
    return 'The planner did not clear this thread, and its reasons name no rule this screen can read — what it wrote is listed below, whole.'
  }
  return 'Every rule the planner consulted said yes' +
    (d.clockKnown && d.hour !== null ? `; ${d.hour}:00 on the server's clock is inside the window` : '') + '.'
}

// the grammar, borrowed from Behavior Support so one platform speaks once: mint is settled, amber is coming, pink…
const BAND: Record<string, { tint: ExtendedTintName; label: string }> = {
  overdue: { tint: 'pink', label: 'Overdue' },
  soon: { tint: 'amber', label: 'Due soon' },
  open: { tint: 'slate', label: 'Outstanding' },
}
const VERDICT: Record<string, { tint: ExtendedTintName; label: string }> = {
  'would send': { tint: 'blue', label: 'Would send' },
  held: { tint: 'amber', label: 'Held' },
  blocked: { tint: 'slate', label: 'Blocked' },
  unplanned: { tint: 'slate', label: 'Unplanned' },
}

// THE LIFE OF ONE THREAD, in the order it is lived.
const STATE_BANDS: { key: string; tint: ExtendedTintName; label: string }[] = [
  { key: 'planned', tint: 'blue', label: 'Planned' },
  { key: 'asking', tint: 'amber', label: 'Asking' },
  { key: 'answered', tint: 'mint', label: 'Answered' },
  { key: 'stopped', tint: 'slate', label: 'Stopped' },
]

function Chip({ map, v }: { map: Record<string, { tint: ExtendedTintName; label: string }>; v: string }) {
  const d = map[v] ?? { tint: 'slate' as ExtendedTintName, label: v || '—' }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
      TINT_BG[d.tint], TINT_FG[d.tint])}>{d.label}</span>
  )
}

// the strip under the hero — the Behavior Support pattern, so the two screens of the same platform count things in…
function StatChip({ label, value, tint = 'slate' }: { label: string; value: string | number; tint?: ExtendedTintName }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
      TINT_BG[tint], TINT_FG[tint])}>
      <span className="font-stat">{value}</span>
      <span className="font-normal opacity-80">{label}</span>
    </span>
  )
}

// ONE GATE, AS THE PLANNER LEFT IT.
function Gate({ icon: Icon, label, value, tint, title }: {
  icon: LucideIcon; label: string; value: string; tint: ExtendedTintName; title?: string
}) {
  return (
    <span title={title || value}
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]',
        TINT_BG[tint], TINT_FG[tint])}>
      <Icon size={11} className="shrink-0" />
      <span className="shrink-0 font-semibold">{label}</span>
      <span className="truncate opacity-80">{value}</span>
    </span>
  )
}

export default function CommsBoardPage() {
  const [rows, setRows] = useState<Intent[] | null>(null)
  const [dial, setDial] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  /* kept apart from `open`: one expands the obligations, the other the rules */
  const [detail, setDetail] = useState<string | null>(null)
  const [howHour, setHowHour] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await gasAction<{ rows?: Intent[]; dial?: string; note?: string }>(
        'commBoard', {}, { timeoutMs: 120_000 })
      setRows(r.rows ?? [])
      setDial(r.dial ?? '')
      setNote(r.note ?? '')
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  // THE OLD GENERATION STAYS OUT OF THE WAY.
  const every = rows ?? []
  const superseded = every.filter((r) => r.state === 'superseded').length
  const all = useMemo(() => every.filter((r) => r.state !== 'superseded'), [every])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? all.filter((r) => r.person_name.toLowerCase().includes(needle) ||
                          (r.items ?? []).some((b) => b.req_id.toLowerCase().includes(needle)))
      : all
    // worst first, then the longest list — the same ordering the planner itself uses, so the screen does not…
    const rank = (w: string) => (w === 'expired' ? 0 : w === 'expiring' ? 1 : 2)
    return [...list].sort((a, b) => {
      const d = rank(a.worst) - rank(b.worst)
      return d !== 0 ? d : Number(b.carried || 0) - Number(a.carried || 0)
    })
  }, [all, q])

  // THE ROW'S SENTENCE, READ ONCE.
  const readings = useMemo(() => {
    const m = new Map<string, Reading>()
    for (const r of all) m.set(r.intent_key, readRow(r))
    return m
  }, [all])

  // DUPLICATION, NAMED SO SOMEBODY CAN END IT (audit).
  const totals = useMemo(() => {
    let carried = 0, deferred = 0, asked = 0, escalated = 0, testRows = 0
    let noRoute = 0, stopped = 0, narrowed = 0, noClock = 0
    const bands: Record<string, number> = {}
    const states: Record<string, number> = {}
    const holds: Record<HoldKind, number> = {
      none: 0, pace: 0, hour: 0, weekend: 0, calloff: 0, spent: 0,
    }
    for (const r of all) {
      carried += Number(r.carried || 0)
      deferred += Number(r.deferred || 0)
      if (Number(r.attempts || 0) > 0 || Number(r.test_attempts || 0) > 0) asked++
      if (r.escalate === 'yes') escalated++
      if (r.test_mode === 'yes') testRows++
      /* a blank state is the planner's own default, not an unknown one */
      const st = r.state || 'planned'
      states[st] = (states[st] ?? 0) + 1
      for (const b of r.items ?? []) bands[b.band] = (bands[b.band] ?? 0) + 1
      // WHY THEY ARE WAITING, counted apart from WHETHER they are waiting.
      const d = readings.get(r.intent_key)
      if (d) {
        if (d.enforced) holds[d.hold]++
        if (d.noRoute) noRoute++
        if (d.narrowed) narrowed++
        if (!d.clockKnown) noClock++
      }
      if (r.state === 'stopped') stopped++
    }
    // anything the house wrote that this screen has no word for is COUNTED, never folded into a band it does not…
    const other = all.length - STATE_BANDS.reduce((n, s) => n + (states[s.key] ?? 0), 0)
    return { carried, deferred, bands, states, other, asked, escalated, testRows,
             holds, noRoute, stopped, narrowed, noClock }
  }, [all, readings])

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Comms Rehearsal"
          subtitle="Who this platform would contact about an unmet obligation — worked out, written down, and not sent."
          actions={
            <button type="button" onClick={() => void load()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          }
        />
      </motion.div>

      {/* the headline, on the one dark surface this design system keeps */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            {/* NOT "Threads planned". `Planned` is the FIRST BAND
                of the bar beside it — the threads nobody has asked yet — and a
                headline by the same name read as that band's total while being
                every live thread in any state, the band included. The count did
                not change; the caption stopped claiming to be the band. */}
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Threads on the board
            </p>
            {/* A COUNT BEFORE THE BOARD ARRIVES WOULD BE A ZERO THAT MEANS
                "not read yet" — the one confusion this screen exists to avoid. */}
            <p className="font-stat text-[60px] leading-none text-white">{rows ? all.length : '…'}</p>
            <p className="mt-1 text-[12px] text-white/60">
              {!rows ? 'reading the board…' : (
                <>
                  {totals.carried} obligation{totals.carried === 1 ? '' : 's'} carried
                  {totals.deferred ? ` · ${totals.deferred} held for a later message` : ''}
                  {superseded ? ` · ${superseded} superseded thread${superseded === 1 ? '' : 's'} hidden` : ''}
                </>
              )}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Where this generation stands
            </p>
            {/* A ZERO BAND IS NOT A BAND. It draws nothing here — a zero-width
                sliver would read as a hairline of colour — but it still appears
                in the legend below with its 0, so "none" and "not measured"
                never look the same.

                THE COLOUR COMES FROM heroBand, NOT FROM THE TINT TOKEN
               : this bar is painted on `--detail-hero`, deep navy
                in BOTH themes, while the tint vars flip with the theme — in the
                light theme `amber` resolves to #8a6410 ink and `slate` to
                var(--text-2), so the bar and the Stopped dot went dark-on-dark
                and vanished for half the estate. heroBand is a fixed map that
                does not move with the theme, because the surface does not. */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {STATE_BANDS.map((s) => (
                totals.states[s.key] ? (
                  <span
                    key={s.key}
                    title={`${totals.states[s.key]} ${s.label.toLowerCase()}`}
                    style={{ width: `${(totals.states[s.key] / Math.max(1, all.length)) * 100}%`,
                             background: heroBand(s.tint) }}
                  />
                ) : null
              ))}
              {totals.other > 0 && (
                <span
                  title={`${totals.other} in a state this screen has no word for`}
                  style={{ width: `${(totals.other / Math.max(1, all.length)) * 100}%`,
                           background: 'rgba(255,255,255,0.3)' }}
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/70">
              {STATE_BANDS.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(s.tint) }} />
                  {s.label} <span className="font-stat text-white">{totals.states[s.key] ?? 0}</span>
                </span>
              ))}
              {totals.other > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-white/30" />
                  Other <span className="font-stat text-white">{totals.other}</span>
                </span>
              )}
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.5] text-white/80">
              {/* THE SENTENCE THAT KEEPS THIS SCREEN HONEST. */}
              The dial reads <strong className="text-white">{dial || '—'}</strong>.
              {dial === 'send'
                ? <> Messages are handed to the transport — <span className="font-stat text-white">{totals.asked}</span> of <span className="font-stat text-white">{all.length}</span> asked so far.</>
                : ' Nothing here has been sent, and no code in this lane can send it.'}
              {/* the one warm word in this paragraph takes its amber from the
                  same hero map as the bands above it — a raw palette class here
                  would be a fourth way of spelling amber on this one surface */}
              {totals.testRows > 0 && (
                <> <strong style={{ color: heroBand('amber') }}>Test mode:</strong> a thread marked test mode reached no person it names — it was held and written to the mock outbox (or, before test mode became the one switch, sent to the testers only).</>
              )}
              {totals.escalated > 0 && (
                <> <span className="font-stat text-white">{totals.escalated}</span> {totals.escalated === 1 ? 'person is' : 'people are'} past the attempt budget — a person's job now, not a reminder's.</>
              )}
            </p>
            {/* THE HOUR, SAID ONCE AT THE TOP so the per-thread lines below are
                read against the right clock. The overstatement this replaces
                was silence: a board that never mentioned the hour let a reader
                assume the platform knew the recipient's. It does not. */}
            {rows && (
              <p className="mt-2 text-[12px] leading-[1.5] text-white/60">
                The hour every row was judged against is the <strong className="font-semibold text-white/80">server's</strong> clock,
                the same for everybody in a pass, narrowed per person only where the cortex holds a shift.
                A row names the window it used ONLY when the hour actually held somebody
                {totals.narrowed > 0
                  ? <> — <span className="font-stat text-white">{totals.narrowed}</span> here {totals.narrowed === 1 ? 'does' : 'do'}, and {totals.narrowed === 1 ? 'it was' : 'they were'} closed by the person's own shifts.</>
                  : ', and none here does.'}
                {totals.noClock > 0 && (
                  <> <span className="font-stat text-white">{totals.noClock}</span> reached the hour with no clock at all, and the platform default stood.</>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* WHAT THEY ARE BEING ASKED ABOUT. The obligations behind the threads,
          counted per binding rather than per person — one thread can carry
          several, so these do not add up to the headline and are not meant to. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* ONE VOCABULARY, ONE PLACE. These three chips said "overdue / due soon
            / outstanding" in their own words while BAND said the same three
            things for the row chips — two copies that drift the day somebody
            renames a band in one of them. They are read off BAND now, so a
            rename there moves the strip and the rows together. */}
        {Object.entries(BAND).map(([key, d]) => (
          <StatChip key={key} label={d.label.toLowerCase()} value={totals.bands[key] ?? 0} tint={d.tint} />
        ))}
        <StatChip label="threads asked at least once" value={totals.asked} tint="blue" />
        {totals.escalated > 0 && (
          <StatChip label="past the attempt budget" value={totals.escalated} tint="pink" />
        )}
        {totals.testRows > 0 && (
          <StatChip label="threads under test mode — no real person reached" value={totals.testRows} tint="amber" />
        )}
      </div>

      {/* WHY THEY ARE WAITING — not the same question as whether they are.
          Every chip here is a different FUTURE: the pace lets go by itself, the
          hour lets go this morning, a refused route and a stop never let go
          until somebody acts. A zero chip is drawn anyway when the board has
          been read, so "nobody is held by the hour" and "we did not look" stop
          reading the same. */}
      {rows && all.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatChip label="held by the pace" value={totals.holds.pace} tint="amber" />
          <StatChip label="held by the hour" value={totals.holds.hour} tint="lavender" />
          {totals.holds.weekend > 0 && (
            <StatChip label="held for the weekend" value={totals.holds.weekend} tint="lavender" />
          )}
          {totals.holds.calloff > 0 && (
            <StatChip label="not at work today" value={totals.holds.calloff} tint="lavender" />
          )}
          <StatChip label="nobody may be reached: no permitted route"
            value={totals.noRoute} tint={totals.noRoute ? 'pink' : 'slate'} />
          {totals.stopped > 0 && (
            <StatChip label="asked us to stop" value={totals.stopped} tint="pink" />
          )}
          <button type="button" onClick={() => setHowHour((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
            <Moon size={12} /> What the hour means
            {howHour ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      )}

      {howHour && (
        <Card className="mb-4">
          <p className="text-[12.5px] font-semibold text-text-1">The window says when somebody is ASLEEP, not when they are awake.</p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-[1.55] text-text-2">
            <li>
              The Hub may only ever <strong className="font-semibold text-text-1">narrow</strong> its quiet hours.
              Saying "awake at 02:00" buys nothing, because 02:00 is already shut — so the only useful
              thing the cortex can say is which hour to close.
            </li>
            <li>
              It is read off real clock-in and clock-out rows, never off prose: a day worked past
              midnight and finished in the morning buys the hours after it as sleep, and an hour counts
              as sleep only when those days outnumber the days the person was working in that same hour.
            </li>
            <li>
              The clock the rules were judged against is the <strong className="font-semibold text-text-1">server's</strong>,
              the same for everybody in a pass. Only a person the cortex holds a shift for is narrowed
              beyond it. "The person's own clock" would be an overstatement and this board does not make it.
            </li>
            <li className="text-text-3">
              Measured off the roster when the window was last rebuilt from the time clock — not a count
              of this board: 459 people carry a window, 312 of whom had none before, and 58 finish an
              overnight shift at 08:00 with 39 more at 07:00 — the hour the quiet floor lifts.
            </li>
          </ul>
        </Card>
      )}

      {err && (
        <Card className="mb-4 flex items-start gap-2.5 border-danger/30">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[12.5px] text-text-2">{err}</p>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-2">
        <span className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search a person or a requirement…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none focus:border-primary" />
        </span>
      </div>

      {loading && !rows ? <Skeleton className="h-64 w-full" /> : shown.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={note ? 'Nothing planned yet' : 'Nobody is owed a word'}
            body={note || 'Every active person is up to date, or nothing reached the roster filter.'} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((r) => {
            const items = r.items ?? []
            const isOpen = open === r.intent_key
            const d = readings.get(r.intent_key) ?? readRow(r)
            // THE ONE WORD BECOMES THE RIGHT WORD.
            const hold = (r.verdict === 'held' || r.verdict === 'blocked') && d.hold !== 'none' && d.enforced
              ? HOLD[d.hold] : null
            return (
              <Card key={r.intent_key} hover>
                <div className="flex items-start gap-3">
                  <DragPerson name={r.person_name} id={r.person_key} type="staff" subtitle={r.purpose}>
                    <Avatar name={r.person_name} size="md" />
                  </DragPerson>
                  <div className="min-w-0 flex-1">
                    <DragPerson name={r.person_name} id={r.person_key} type="staff"
                      className="block truncate text-[14px] font-semibold text-text-1"
                      title="Drag this name onto the tracker, top left">
                      {r.person_name || r.person_key}
                    </DragPerson>
                    <p className="mt-0.5 text-[11.5px] text-text-3">
                      {r.carried} carried
                      {Number(r.deferred || 0) > 0 ? ` · ${r.deferred} for later` : ''}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {hold ? (
                      <span title={r.verdict}
                        className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          TINT_BG[hold.tint], TINT_FG[hold.tint])}>{hold.label}</span>
                    ) : <Chip map={VERDICT} v={r.verdict} />}
                    {/* NOBODY MAY BE REACHED AT ALL — its own chip, because it
                        is NOT what the verdict beside it means. The route is
                        worked out after the policy has already spoken, so a
                        thread can read `would send` with no channel to send it
                        on, and the board used to show only the first half. */}
                    {r.state === 'stopped' ? (
                      <span title="released only by a person (OptOut)"
                        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG.pink, TINT_FG.pink)}>
                        <Ban size={11} /> Asked us to stop
                      </span>
                    ) : d.noRoute && (
                      <span title={d.route}
                        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG.pink, TINT_FG.pink)}>
                        <PhoneOff size={11} /> No route
                      </span>
                    )}
                    <Chip map={BAND} v={r.worst === 'expired' ? 'overdue'
                      : r.worst === 'expiring' ? 'soon' : 'open'} />
                    {r.escalate === 'yes' && (
                      <span title={r.escalate_why}
                        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG.pink, TINT_FG.pink)}>
                        <AlertTriangle size={11} /> Escalate
                      </span>
                    )}
                  </span>
                </div>

                {/* WHAT THE SWEEP REMEMBERS. Two memories on purpose: a test send
                    paces the test columns and never counts against the person. */}
                {(Number(r.attempts || 0) > 0 || Number(r.test_attempts || 0) > 0 || r.reply_token) && (
                  <p className="mt-2 text-[11.5px] text-text-3">
                    {Number(r.attempts || 0) > 0 && (
                      <span title={r.last_asked_at}>asked {r.attempts}× · last {when(r.last_asked_at)}</span>
                    )}
                    {Number(r.test_attempts || 0) > 0 && (
                      <span title={r.test_last_asked_at} className={cn(Number(r.attempts || 0) > 0 && 'ml-2')}>
                        test {r.test_attempts}× · last {when(r.test_last_asked_at)}
                      </span>
                    )}
                    {r.channel && <span className="ml-2">via {r.channel}</span>}
                    {r.reply_token && <span className="ml-2 font-mono text-[11px]">ref {r.reply_token}</span>}
                    {r.last_error && <span className="ml-2 text-danger">last: {r.last_error}</span>}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {items.slice(0, isOpen ? items.length : 4).map((b) => (
                    <span key={b.demand_id}
                      className={cn('inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-[11px]',
                        TINT_BG[BAND[b.band]?.tint ?? 'slate'], TINT_FG[BAND[b.band]?.tint ?? 'slate'])}>
                      {b.req_id}
                      {b.expires ? <span className="opacity-70">{b.expires}</span> : null}
                    </span>
                  ))}
                  {!isOpen && items.length > 4 && (
                    <button onClick={() => setOpen(r.intent_key)}
                      className="text-[11px] font-semibold text-primary hover:underline">
                      +{items.length - 4} more
                    </button>
                  )}
                </div>

                {/* THE REASONS ARE THE PRODUCT OF A REHEARSAL. A verdict with
                    no reasoning behind it is a switch somebody has to trust.
                    They used to be printed as the planner's raw join, which is
                    a reason nobody reads twice; the gates below are the same
                    sentence, split at its own labels and led by the one line
                    that says what is actually holding this person. */}
                <div className="mt-3 border-t border-border pt-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.priority && d.priority !== 'ask' && (
                      <Gate icon={AlertTriangle} label="Priority" value={d.priority} tint="violet"
                        title={d.clauses.filter((c) => c.key === 'priority').map((c) => c.text).join(' · ')} />
                    )}
                    {/* A GATE WITH NO CLAUSE WAS NEVER ASKED. The planner stops
                        at the first rule that refuses, so a missing pace or a
                        missing hour is not a pass — it is a question nobody
                        got to. Drawn in slate and said in words, because an
                        absent chip would have read as "fine". */}
                    <Gate icon={Timer} label="Pace"
                      value={d.gap || 'not reached — an earlier rule decided'}
                      tint={!d.gap ? 'slate' : d.hold === 'pace' ? 'amber' : 'mint'}
                      title={d.gap || 'the planner stopped before the pace'} />
                    <Gate
                      icon={d.hold === 'weekend' ? CalendarOff : (d.hold === 'hour' || d.hold === 'calloff') ? Moon : Clock}
                      label="Hour"
                      value={
                        !d.window ? 'not reached — an earlier rule decided'
                          : !d.clockKnown ? 'no clock for them — the default stood'
                            : d.hold === 'calloff' ? 'not at work today'
                              : d.hold === 'weekend' ? 'the weekend'
                                : d.hour === null ? d.window
                                  : `${d.hour}:00 · ${d.hold === 'hour' ? 'asleep' : 'inside the window'}`
                      }
                      tint={!d.window ? 'slate'
                        : d.hold === 'hour' || d.hold === 'weekend' || d.hold === 'calloff' ? 'lavender'
                          : !d.clockKnown ? 'slate' : 'mint'}
                      title={d.window || 'the planner stopped before the hour'} />
                    {d.route && (
                      <Gate icon={d.noRoute ? PhoneOff : Check} label="Route"
                        value={d.noRoute ? d.route : (r.channel || d.route)}
                        tint={d.noRoute ? 'pink' : 'mint'} title={d.route} />
                    )}
                    {d.jumped && (
                      <Gate icon={AlertTriangle} label="Queue jumped" value={d.jumped} tint="peach" />
                    )}
                  </div>

                  <p className="mt-2 text-[11.5px] leading-[1.5] text-text-2">{saySo(r, d)}</p>

                  {/* THE WINDOW IN ITS OWN WORDS. Only the rows the hour
                      actually held carry it — CommPolicy writes `inside the
                      window` and nothing else when it lets somebody through,
                      so a quiet blank here is "the row does not say", never
                      "this person has no window". */}
                  {d.narrowed && (
                    <p className="mt-1 text-[11px] leading-[1.5] text-text-3" title={d.quietWhy}>
                      Their own shifts narrowed it
                      {d.sleeps ? <> — asleep <strong className="font-semibold text-text-2">{d.sleeps}</strong></> : ''}
                      {d.reachable ? <>, reachable <strong className="font-semibold text-text-2">{d.reachable}</strong></> : ''}.
                    </p>
                  )}

                  <button type="button"
                    onClick={() => setDetail(detail === r.intent_key ? null : r.intent_key)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                    {detail === r.intent_key ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    every rule the planner consulted
                  </button>
                  {detail === r.intent_key && (
                    <dl className="mt-1.5 space-y-1">
                      {d.clauses.map((c, i) => (
                        <div key={`${c.key}-${i}`} className="flex gap-2 text-[11px] leading-[1.5]">
                          <dt className="w-[5.5rem] shrink-0 font-semibold text-text-3">{c.label}</dt>
                          <dd className="min-w-0 flex-1 break-words text-text-2">{c.text}</dd>
                        </div>
                      ))}
                      {/* WHEN THE ROW DECIDED, not when it is being read. A
                          rehearsal runs every six hours; the hour above is the
                          hour of the sweep, and a reader looking at a stale
                          board must be able to tell. */}
                      <div className="flex gap-2 text-[11px] leading-[1.5]">
                        <dt className="w-[5.5rem] shrink-0 font-semibold text-text-3">Decided</dt>
                        <dd className="min-w-0 flex-1 text-text-2" title={r.planned_at}>
                          {when(r.planned_at) || '—'}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
