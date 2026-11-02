// THE CATALOGUE — what this platform is able to say, and what somebody has to do to switch one of them on and try…
// The explanation is not enough on its own: the list of the Smart Comms this platform has must stand somewhere in…
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router'
import {
  Bell, BrainCircuit, CalendarClock, Check, Compass, Hand, Inbox, Layers, Loader2, Mail, Megaphone, PhoneOff,
  Radio, RefreshCw, ShieldAlert, SlidersHorizontal, Zap, X, type LucideIcon,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { Badge } from '@/components/shared/Badge'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

type Sit = Record<string, string> & { id: string }
/** A book as the read names it; `record` is Postgres keeping its record, the Google sheet then a copy. */
type BookRead = { id: string; name: string; record: boolean }
/** The lane's knobs as written ('' leaves the code's floor) and each situation's rung; null when unread. */
type LaneRead = {
  settings: Record<string, string> | null; priorities: Record<string, string> | null; why: string; book?: BookRead
}
type TestModeRead = { on: boolean; unrecognized: string; sms: string[]; emails: string[] }

/** A row's species, normalised once — a blank cell is the oldest species. */
const kindOf = (s: Sit): string => String(s.kind || 'reminder').trim().toLowerCase()

// THE SPECIES, IN THE READING ORDER THE CATALOGUE USES — which is not the Desk's.
type Species = {
  id: string; title: string; icon: LucideIcon; tint: TintName
  /** the species in four or five words, printed on the header line itself */
  caption: string
  /** what the whole species is, in one line, above its rows */
  lede: string
}
const SPECIES: Species[] = [
  { id: 'reminder', title: 'Reminders', icon: Bell, tint: 'blue',
    caption: 'a credential is expiring',
    lede: 'A credential is running out, so the person who holds it is told before it does.' },
  { id: 'bundle', title: 'Obligation bundles', icon: Layers, tint: 'peach',
    caption: 'everything owed, in one message',
    lede: 'One message per person carrying everything they still owe, gathered and paced by the obligations lane.' },
  { id: 'mailbox', title: 'Mailbox watchers', icon: Inbox, tint: 'lavender',
    caption: 'derived from what lands in the inbox',
    lede: 'Nothing counts down: the platform mailbox hears a subject line and the platform’s mail sweep files it.' },
  { id: 'digest', title: 'Digests', icon: Radio, tint: 'mint',
    caption: 'a weekly report to a list',
    lede: 'A weekly report to a list of people, rather than a message to the person it is about.' },
  { id: 'event', title: 'Events', icon: Zap, tint: 'amber',
    caption: 'something happened in a flow',
    lede: 'Something happened in a flow — a stage moved, a contact failed, a deadline ran out.' },
  { id: 'letter', title: 'Letters', icon: Mail, tint: 'blue',
    caption: 'one person, one moment',
    lede: 'A door hands one person one message at one moment — a reset link, an invitation, an ask in a hiring flow, a company notice on their own screen.' },
  { id: 'shift_clock', title: 'Shift clock', icon: CalendarClock, tint: 'mint',
    caption: 'the schedule speaking',
    lede: 'The schedule’s own messages: clocking in, confirming a shift, handing one over, asking for and answering time off.' },
  { id: 'call_off', title: 'Call-offs', icon: PhoneOff, tint: 'peach',
    caption: 'a shift lost its person',
    lede: 'Somebody called off: the call is acknowledged, the house manager is told, and the open shift is offered.' },
  { id: 'window_ask', title: 'Window asks', icon: Hand, tint: 'lavender',
    caption: 'when may we reach you',
    lede: 'Asks a person which hours they can be reached in, so the lane stops guessing.' },
  { id: 'gate', title: 'Gates', icon: ShieldAlert, tint: 'amber',
    caption: 'brakes, not messages',
    lede: 'NOT messages. Each gate is a brake on a door that reaches the world without a word: armed, it holds that door while test mode holds. They are switched on the Desk.' },
  { id: 'ai', title: 'AI requests', icon: BrainCircuit, tint: 'pink',
    caption: 'not messages — which model answers a question',
    lede: 'NOT messages. Each row says which model answers one question. They reach nobody.' },
]

// THE PRIORITY LADDER, AS THE FILE THAT OWNS IT WROTE IT (app/comm_repair.py, PRIORITIES).
type Priority = 'safety' | 'repair' | 'ask' | 'notice'
type Rung = {
  id: Priority; why: string
  gap: boolean; sleep: boolean; weekend: boolean
  cap: string; carries: string; tint: TintName
}
const LADDER: Rung[] = [
  { id: 'safety', why: 'somebody could be hurt',
    gap: true, sleep: true, weekend: true,
    cap: 'tried until it lands',
    carries: 'Declared and carried empty — nothing is filed under it, so the top of the ladder is not already spoken for the day something real needs it.',
    tint: 'pink' },
  { id: 'repair', why: 'we owe them a word',
    gap: true, sleep: false, weekend: true,
    cap: 'said once, then a person',
    carries: 'A correction, or an answer somebody is waiting on. It asks for nothing, so it does not spend the weekend — and it waits the quiet hours out rather than waking anybody, because a correction at 3am is the second insult.',
    tint: 'amber' },
  { id: 'ask', why: 'they owe us something',
    gap: false, sleep: false, weekend: false,
    cap: 'the lane’s cap (comm_max_attempts), then a person',
    carries: 'Everything this lane does, and the floor anything unresolved lands in.',
    tint: 'blue' },
  { id: 'notice', why: 'worth knowing, never urgent',
    gap: false, sleep: false, weekend: false,
    cap: 'the lane’s cap (comm_max_attempts), then a person',
    carries: 'Digests and informational sends. The only rung that may be dropped outright when a pass runs out of budget — which is why nothing has to be promoted to an ask merely to be delivered.',
    tint: 'lavender' },
]
const RUNG: Record<string, Rung> = Object.fromEntries(LADDER.map((r) => [r.id, r]))

/** The rung this row declares, or null — which is the honest answer. */
const priorityOf = (s: Sit): Rung | null => RUNG[String(s.priority ?? '').trim().toLowerCase()] ?? null

// WHY THE ROW EXISTS, IN ONE SENTENCE, BUILT ONLY OUT OF THE ROW'S OWN CELLS.
function describe(s: Sit): string {
  const kind = kindOf(s)
  const days = String(s.days_before ?? '').trim()
  const words = (v: string) => v.replace(/_/g, ' ').trim()

  if (kind === 'bundle') {
    const what = String(s.label ?? '').trim()
    return what
      ? `One message per person carrying everything still owed — ${what}. The obligations lane picks who and when.`
      : 'One message per person carrying everything still owed. The obligations lane picks who and when.'
  }
  if (kind === 'digest') {
    return days
      ? `A weekly report to a list — everything past ${days} days.`
      : 'A weekly report to a list.'
  }
  if (kind === 'mailbox') {
    const heard = String(s.event ?? '').trim()
    return heard
      ? `When the platform mailbox hears “${words(heard)}” about somebody.`
      : ''
  }
  if (kind === 'ai') {
    const model = String(s.ai_model ?? '').trim()
    const only = String(s.ai_providers ?? '').trim()
    return `Which model answers this question — ${model || 'the one the code ships'}` +
      (only ? `, asked only of ${only}` : '') + '. It sends nothing; the prompt stays in the code.'
  }
  if (kind === 'event') {
    const name = String(s.event ?? '').trim()
    if (!name) return ''
    return days && days !== '0' ? `${days} day(s) after ${words(name)}.` : `When ${words(name)} happens.`
  }
  if (kind === 'gate') {
    const what = String(s.label ?? '').trim()
    return what ? `Holds ${what} while test mode holds.` : ''
  }
  if (kind === 'letter' || kind === 'shift_clock' || kind === 'call_off' || kind === 'window_ask') {
    const what = String(s.label ?? '').trim()
    return what ? what.charAt(0).toUpperCase() + what.slice(1) + '.' : ''
  }
  const what = String(s.credential ?? '').trim()
  if (!what) return ''
  return `${days || '?'} days before ${words(what)} expires.`
}

// HOW MANY ROWS OF A SPECIES STAND BEFORE THE READER ASKS FOR MORE.
const PREVIEW_ROWS = 8

// The words the rehearsal position answers to (app/smart_comms_desk.py REHEARSAL_WORDS) — three spellings of one…
const REHEARSAL_WORDS = 'sheet · rehearsal · paper'

// ------------------------------------------------------------------ small parts…

/** One permission, said yes or no — never folded into the one beside it. */
function Permission({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <li className={cn('flex items-start gap-1.5 text-[11.5px] leading-[16px]', ok ? 'font-semibold text-text-1' : 'text-text-3')}>
      {ok ? <Check size={12} className="mt-0.5 shrink-0" /> : <X size={12} className="mt-0.5 shrink-0" />}
      <span>{ok ? yes : no}</span>
    </li>
  )
}

/** The rung chip. Unanswered is drawn as unanswered, with the reason attached. */
function PriorityChip({ sit }: { sit: Sit }) {
  const r = priorityOf(sit)
  if (!r) {
    return (
      <span
        title="Unknown, not ask: the ladder could not be read just now, because the words book's Digest Settings (comm_priority_*) did not answer. Nothing here claims the floor as a reading."
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3"
      >
        priority —
      </span>
    )
  }
  return (
    <span
      title={`${r.why} · ${r.gap ? 'skips the pacing gap' : 'waits for the pacing gap'} · ` +
        `${r.sleep ? 'may wake somebody' : 'never wakes anybody'} · ` +
        `${r.weekend ? 'may be said on a weekend' : 'holds over a weekend'} · ${r.cap}`}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG[r.tint], TINT_FG[r.tint])}
    >
      {r.id}
    </span>
  )
}

// A step of the three, numbered, with its own eyebrow, its own colour and its own honesty.
function Step({ n, eyebrow, title, tint, children }: {
  n: number; eyebrow: string; title: string; tint: TintName; children: ReactNode
}) {
  return (
    <Card padded={false} className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-start gap-2">
        <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full font-stat text-[12px]', TINT_BG[tint], TINT_FG[tint])}>
          {n}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{eyebrow}</p>
          <h3 className="font-display text-[14px] font-bold leading-5 text-text-1">{title}</h3>
        </div>
      </div>
      <div className="space-y-2 text-[12px] leading-[18px] text-text-2">{children}</div>
    </Card>
  )
}

/** A word taken literally from a book cell or a file — never prose. */
function Cell({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] border border-border bg-surface-2 px-1 py-px font-mono text-[11px] text-text-1">
      {children}
    </code>
  )
}

/** A live switch position, or an em-dash when nobody could read it. */
function Position({ label, value, on, unknownWhy }: {
  label: string; value: string; on: boolean; unknownWhy?: string
}) {
  const known = !!value
  return (
    <span
      title={known ? undefined : unknownWhy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold leading-4',
        known && on ? 'bg-surface text-text-1' : 'bg-surface-2 text-text-3',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', known && on ? 'bg-primary' : 'bg-text-3')} />
      {label} {known ? value : '—'}
    </span>
  )
}

// WHAT THE PAGE CAN SAY ABOUT ONE KNOB RIGHT NOW — a reading, never a verdict.
function Reading({ value, why }: { value: string; why?: string }) {
  const known = !!value
  return (
    <span
      title={known ? undefined : why}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] leading-4',
        known ? 'bg-surface text-text-1' : 'bg-surface-2 text-text-3',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', known ? 'bg-primary' : 'bg-text-3')} />
      {known ? value : 'not read here'}
    </span>
  )
}

// ONE KNOB OF THE LANE — the cell's own name, the room it is edited in, what turning it does, and every word it…
type Knob = {
  cell: string
  /** the room somebody opens to change it */
  where: string
  /** what the knob decides, in one sentence */
  does: string
  /** every word it takes, and what that word means */
  words?: { w: string; m: string }[]
  /** the value the CODE uses when the cell is empty — a floor, not a reading */
  floor?: string
  /** what this page can say about the position, or nothing */
  now?: ReactNode
  /** why the position is not on this screen, when it is not */
  blind?: string
}

function KnobCard({ k }: { k: Knob }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <code className="min-w-0 break-words font-mono text-[12px] font-semibold text-text-1">{k.cell}</code>
        {k.now ?? <Reading value="" why={k.blind} />}
      </div>
      <p className="mt-1 text-[11px] leading-[15px] text-text-3">{k.where}</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-text-2">{k.does}</p>
      {k.words && (
        <ul className="mt-2 space-y-1">
          {k.words.map((p) => (
            <li key={p.w} className="text-[11.5px] leading-[16px] text-text-2">
              <code className="rounded-[4px] border border-border bg-surface px-1 py-px font-mono text-[10.5px] text-text-1">
                {p.w}
              </code>{' '}
              — {p.m}
            </li>
          ))}
        </ul>
      )}
      {k.floor && <p className="mt-2 text-[11px] leading-[15px] text-text-3">{k.floor}</p>}
      {/* THE REASON IS PRINTED, NOT HIDDEN IN A TOOLTIP. A knob whose position
          this screen cannot see has to say WHY on the card — a hover nobody
          performs is the same as not having written it. */}
      {k.blind && <p className="mt-1.5 text-[11px] leading-[15px] text-text-3">{k.blind}</p>}
    </div>
  )
}

/** A block of the map, with the sentence that says why these knobs belong together. */
function KnobBlock({ title, lede, knobs }: { title: string; lede: string; knobs: Knob[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-[12.5px] font-semibold text-text-1">{title}</h3>
      <p className="mb-2 mt-0.5 text-[12px] leading-[17px] text-text-3">{lede}</p>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
        {knobs.map((k) => <KnobCard key={k.cell} k={k} />)}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the page…

export default function SmartCommsCataloguePage() {
  const [situations, setSituations] = useState<Sit[]>([])
  const [sending, setSending] = useState('')
  const [book, setBook] = useState<BookRead | null>(null)
  const [lane, setLane] = useState<LaneRead | null>(null)
  const [testMode, setTestMode] = useState<TestModeRead | null>(null)
  const [loading, setLoading] = useState(true)
  // A FAILED READ IS NOT AN ANSWER.
  const [loadError, setLoadError] = useState('')
  // The dial comes with the situations: it follows test mode, so it is read whenever they are.
  const [dial, setDial] = useState('')

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  /** The AI rows arrive folded: they are not messages and they reach nobody. */
  const [showAi, setShowAi] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await gasAction<{
        situations?: Sit[]; sending?: string; book?: BookRead; lane?: LaneRead; dial?: string
        test_mode?: TestModeRead
      }>('smartCommsGet', {})
      // each row's rung, as the lane resolves it from comm_priority_* — '' when the ladder was not read
      const rungs = res.lane?.priorities ?? null
      setSituations((res.situations ?? []).map((s) => ({ ...s, priority: rungs?.[s.id] ?? '' })))
      setSending(res.sending ?? '')
      setBook(res.book ?? null)
      setLane(res.lane ?? null)
      setTestMode(res.test_mode ?? null)
      setDial(String(res.dial ?? ''))
      setLoadError('')
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      setLoadError(why || 'the read did not come back')
      toast({ type: 'danger', title: 'Could not read the catalogue', body: why })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(
    () => SPECIES.map((sp) => {
      const items = situations.filter((s) => kindOf(s) === sp.id)
      return { ...sp, items, live: items.filter((s) => s.enabled === 'yes').length }
    }),
    [situations],
  )

  const stats = useMemo(() => {
    const live = situations.filter((s) => s.enabled === 'yes').length
    const off = situations.length - live
    const offMessages = situations.filter((s) => s.enabled !== 'yes' && kindOf(s) !== 'ai' && kindOf(s) !== 'gate').length
    const aboveAsk = situations.filter((s) => { const r = priorityOf(s); return !!r && r.id !== 'ask' }).length
    return { live, off, offMessages, priorityKnown: situations.filter((s) => !!priorityOf(s)).length, aboveAsk }
  }, [situations])

  // THE HERO BAR.
  const bands = useMemo(() => {
    const counted = groups.map((g) => ({
      id: g.id, title: g.title, tint: g.tint, count: g.items.length, live: g.live,
    }))
    const known = counted.reduce((n, b) => n + b.count, 0)
    return { counted, other: Math.max(0, situations.length - known) }
  }, [groups, situations.length])

  const total = Math.max(1, situations.length)
  /** "…" while the read is in flight, "—" when it came back empty-handed. */
  const gap = loading ? '…' : '—'
  const countsKnown = !loading && !loadError
  const sendingOn = sending.trim().toLowerCase() === 'on'
  const dialRead = !!dial
  const deskHref = '/app/smartcomms/overview'
  const wordsBook = lane?.book?.name || 'the words book'
  const SETTINGS_WHERE = `${wordsBook} · Digest Settings · one row per key`
  /** The knobs' cells as written: a value, or empty (the code's floor), or unread with the reason. */
  const knob = (...keys: string[]): ReactNode => {
    const set = lane?.settings
    if (!set) {
      return <Reading value="" why={lane?.why || 'The Digest Settings did not come back with the situations.'} />
    }
    const got = keys.map((k) => set[k] ?? '')
    if (got.every((v) => !v)) return <Reading value={keys.length > 1 ? 'all empty — the floors' : 'empty — the floor'} />
    return <Reading value={got.map((v) => v || 'floor').join(' · ')} />
  }
  /** How many species actually carry rows — the Desk's density, measured. */
  const speciesWithRows = groups.filter((g) => g.items.length).length

  // THE PARAMETER MAP.
  const rowKnobs: Knob[] = [
    {
      cell: 'enabled',
      where: 'Smart Comms › Desk · the row’s switch · kept in Postgres',
      does: 'Whether this one situation may speak at all — or, on a gate, whether the gate is armed. It is the switch the whole page is about, and the only one that is per-situation rather than per-lane.',
      words: [
        { w: 'yes', m: 'it may speak, once every other gate agrees' },
        { w: 'no · blank', m: 'written, tested and silent — nothing about it runs' },
      ],
      now: countsKnown
        ? <Reading value={`${stats.live} of ${situations.length} read yes`} />
        : <Reading value="" why="The situations did not come back, so this page has counted nothing." />,
      blind: 'A publish can never change it. The Desk writes it into Postgres, which keeps the record of the situations; this page only reads it.',
    },
    {
      cell: 'channels',
      where: 'Smart Comms › Desk · the row’s own cell',
      does: 'Which doors this situation may leave by. More than one word may sit in one cell.',
      words: [
        { w: 'sms', m: 'the transport’s text door' },
        { w: 'email', m: 'the platform mailbox' },
        { w: 'web', m: 'a notice on the person’s own screen in the Hub' },
        { w: 'blank', m: 'no door at all — the row can never leave, whatever else is on' },
      ],
      now: <Reading value="on every row below" />,
      blind: 'Each card in the list prints the channels that row names, or says it names none.',
    },
    {
      cell: 'days_before',
      where: 'Smart Comms › Desk · the row’s own cell',
      does: 'How far ahead of a date a reminder speaks — and, on an event row, how long after the event it waits.',
      words: [
        { w: 'a number', m: 'that many days before the credential lapses' },
        { w: '0 · blank', m: 'on the event itself, with no wait' },
      ],
      now: <Reading value="on every row below" />,
      blind: 'It is the number inside each row’s sentence: “45 days before CPR expires”.',
    },
    {
      cell: 'credential · event · label',
      where: 'Smart Comms › Desk · the row’s own cells',
      does: 'What the row is counting down to, which thing in a flow fires it, or — for a bundle — what the gathered message is called. One of the three is what makes the row about something.',
      now: <Reading value="on every row below" />,
      blind: 'A row that names none of them gets no sentence on its card: an invented one would read exactly like a read one.',
    },
    {
      cell: 'ai_model · ai_providers',
      where: 'Smart Comms › Desk · the AI rows only',
      does: 'Which model answers one question, and which providers may be asked it. These rows send nothing and reach nobody — the prompt stays in the code.',
      now: <Reading value="on every AI row below" />,
    },
    {
      cell: 'correct_audience · what_was_wrong',
      where: 'The Desk · the drawer, when the words are saved',
      does: 'Two fields that ride a save and are never columns: they declare that the previous words were WRONG, which is what makes the platform find everybody holding the old version and apologise to them. Words that move without them are an improvement and owe nobody an apology.',
      blind: 'Not a cell of the situation, so nothing on this page can read a position for it. The Desk is where it is said.',
    },
  ]

  const doorKnobs: Knob[] = [
    {
      cell: 'the sending dial (follows test_mode)',
      where: 'No cell of its own — it follows test_mode in Settings → Test mode',
      does: 'Whether the lane hands anything to the transport. It FOLLOWS test mode, so test mode is the one switch: on is record, off is send. There is no dial cell to set.',
      words: [
        { w: 'record', m: 'test mode on — works everything out and writes it down, hands nothing over' },
        { w: 'send', m: 'test mode off — hands cleared threads to the transport' },
        { w: 'off', m: 'only when test mode could not be read — refuses to run' },
      ],
      now: (
        <Reading
          value={dialRead ? (dial || 'off') : ''}
          why="The dial comes with the situations, and that read did not land — unknown, not off."
        />
      ),
    },
    {
      cell: 'test_mode',
      where: 'Settings → Test mode · the test group',
      does: 'THE ONE SWITCH. On, nothing leaves the platform to anybody, testers included, and the sending dial follows at record; off, everything flows and the dial follows at send. Turning it on is never refused — it is the emergency stop.',
      words: [
        { w: 'off', m: 'messages reach the person they are about' },
        { w: 'on', m: 'nothing is sent: every message is kept in Postgres instead — the mock outbox (app.comm_mock) and the rehearsal log (app.comm_rehearsal); no sheet is written' },
        { w: REHEARSAL_WORDS, m: 'the same as on' },
      ],
      now: testMode
        ? <Reading value={testMode.unrecognized ? `“${testMode.unrecognized}” — unread, so it holds` : testMode.on ? 'on' : 'off'} />
        : <Reading value="" why="Test mode comes with the situations, and that read did not land." />,
    },
    {
      cell: 'test_redirect_sms · test_redirect_email',
      where: 'Settings → Test mode · the test group',
      does: 'Who the testers are. Nothing is redirected to them any more — test mode on sends nothing to anybody — so the lists only name them for the screens that show them.',
      now: testMode
        ? <Reading value={`${testMode.sms.length} phone(s) · ${testMode.emails.length} e-mail(s)`} />
        : <Reading value="" why="The testers come with the situations, and that read did not land." />,
    },
    {
      cell: 'HUB_RPC_SEND',
      where: 'A platform property — the Essencial’s props, or HUB_APP_PROP_HUB_RPC_SEND in asa-hub-app’s environment; not a cell anybody types',
      does: 'The transport door itself. Settings may pause it (messages_paused); nothing in Settings can start it.',
      words: [
        { w: 'on', m: 'the door is open — everything else still has to agree' },
        { w: 'off', m: 'nothing leaves, whatever the dial says' },
      ],
      now: (
        <Reading
          value={loading || loadError ? '' : (sendingOn ? 'open' : 'shut')}
          why="The door’s position comes with the situations, and that read did not land."
        />
      ),
    },
    {
      cell: 'comm_silence',
      where: SETTINGS_WHERE,
      does: 'Which relationship the platform treats as permission to speak at all — employment by default. Consent and the opt-out list sit underneath every rung of the ladder, including safety.',
      floor: 'Floor in code: employment.',
      now: knob('comm_silence'),
    },
  ]

  const paceKnobs: Knob[] = [
    {
      cell: 'comm_min_gap_hours',
      where: SETTINGS_WHERE,
      now: knob('comm_min_gap_hours'),
      does: 'The resting pace: how long the same person is left alone about the same thing. The obligations sweep runs every six hours, so without a gap somebody is asked four times a day — which teaches people to ignore us.',
      floor: 'Floor in code: 72 hours.',
    },
    {
      cell: 'comm_gap_overdue_hours · comm_gap_soon_hours · comm_gap_open_hours',
      where: SETTINGS_WHERE,
      now: knob('comm_gap_overdue_hours', 'comm_gap_soon_hours', 'comm_gap_open_hours'),
      does: 'The gap follows the band, because patience is not one number: something already lapsed is chased sooner than something merely outstanding, and the slowest case stops being decided by the calmest item on the list.',
      floor: 'Floors in code: 36 · 72 · 168 hours.',
    },
    {
      cell: 'comm_max_attempts · comm_escalate_after',
      where: SETTINGS_WHERE,
      now: knob('comm_max_attempts', 'comm_escalate_after'),
      does: 'How many times a reminder may ask before it stops being a reminder’s job and becomes a person’s — and after how many attempts a supervisor is told.',
      floor: 'Floors in code: 3 attempts · escalate after 2.',
    },
    {
      cell: 'comm_quiet_from · comm_quiet_to · comm_weekend_ok',
      where: SETTINGS_WHERE,
      now: knob('comm_quiet_from', 'comm_quiet_to', 'comm_weekend_ok'),
      does: 'The hours the lane will not speak in, platform-wide, and whether a weekend may be spent. The When page argues the narrow exception to this pair: fifteen minutes before a shift, a person is up and can take a message.',
      floor: 'Floors in code: 21:00 · 08:00 · weekends refused.',
    },
    {
      cell: 'comm_test_gap_hours',
      where: SETTINGS_WHERE,
      now: knob('comm_test_gap_hours'),
      does: 'The one pace that survives a test pass. Every recipient is a tester, so the quiet hours, the attempt cap and consent are recorded and not enforced — this exists only so four inboxes are not asked the same sixty-four things every six hours.',
      floor: 'Floor in code: 24 hours. 0 switches it off.',
    },
    {
      cell: 'comm_window_ask_max_asks · comm_window_ask_gap_hours',
      where: SETTINGS_WHERE,
      now: knob('comm_window_ask_max_asks', 'comm_window_ask_gap_hours'),
      does: 'The patience of the service question specifically, kept separate so it can change without changing how hard a lapsed credential is chased. The ceiling is the important one: a daily message for ever to somebody who will never answer is harassment sent on purpose.',
      floor: 'Floors in code: 3 asks · gap off (0), because the calendar day is the pace.',
    },
    {
      cell: 'comm_priority_safety · comm_priority_repair · comm_priority_notice',
      where: `${SETTINGS_WHERE} · a comma-separated list of ids`,
      does: 'Which situations sit on which rung of the ladder below. Everything not listed is an ask, which is the floor rather than a decision anybody made.',
      floor: 'Floors in code: safety empty on purpose · repair carries correction.owed and correction_notice · notice carries call_off_acknowledged.',
      now: knob('comm_priority_safety', 'comm_priority_repair', 'comm_priority_notice'),
      blind: 'Each row below prints the rung the lane resolves for it from these three lists.',
    },
  ]

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Catalogue"
          subtitle="Everything this platform is able to say — and, on the same screen, how you switch one on and how you test it without reaching a single person."
          actions={
            <>
              <PageSwitch />
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </>
          }
        />
      </motion.div>

      {/* THE HEADLINE. The big number is what the platform CAN say; the bar is
          what kind of thing each one is; the qualifier is the number the page
          was built for — how much of it is written, reviewed and silent. Every
          count here is read from the live catalogue. */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Things it can say
            </p>
            <p className="font-stat text-[60px] leading-none text-white">
              {countsKnown ? situations.length : gap}
            </p>
            <p className="mt-1 text-[12px] text-white/60">
              {countsKnown
                ? <>
                    <span className="font-stat text-white">{stats.live}</span> switched on ·{' '}
                    <span className="font-stat text-white">{stats.off}</span> written but silent
                  </>
                : loading
                  ? <>reading the situations…</>
                  : <>the situations did not come back — nothing here is a measured zero</>}
            </p>
            {countsKnown && stats.off > 0 && (
              <p className="mt-4 text-[12.5px] leading-[1.55] text-white/80">
                <span className="font-stat text-[17px] text-white">{stats.off}</span> are written, tested
                and silent — composed, reviewed, and saying nothing until somebody sets one cell.
                {stats.offMessages !== stats.off && (
                  <span className="text-white/55">
                    {' '}<span className="font-stat text-white/80">{stats.offMessages}</span> of those are
                    messages; the rest are AI requests and gates, which reach nobody either way.
                  </span>
                )}
              </p>
            )}
            {loadError && !loading && (
              <p className="mt-4 text-[12px] leading-[17px] text-white/70">
                The situations did not come back — the numbers above are unread, not zero.
              </p>
            )}
          </div>

          <div className="min-w-0 sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              By species
            </p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {bands.counted.map((b) => (
                b.count ? (
                  <span
                    key={b.id}
                    title={`${b.count} ${b.title.toLowerCase()} · ${b.live} on`}
                    style={{ width: `${(b.count / total) * 100}%`, background: heroBand(b.tint) }}
                  />
                ) : null
              ))}
              {bands.other ? (
                <span
                  title={`${bands.other} of a species this page has no section for yet`}
                  style={{ width: `${(bands.other / total) * 100}%`, background: 'rgba(255,255,255,0.32)' }}
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-white/70">
              {bands.counted.map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: heroBand(b.tint) }} />
                  {b.title} <span className="font-stat text-white">{countsKnown ? b.count : gap}</span>
                  <span className="text-white/45">·</span>
                  <span className="font-stat text-white/80">{countsKnown ? `${b.live} on` : `${gap} on`}</span>
                </span>
              ))}
              {bands.other ? (
                <span className="inline-flex items-center gap-1.5" title="A species this page has no section for yet.">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'rgba(255,255,255,0.32)' }} />
                  Other <span className="font-stat text-white">{bands.other}</span>
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.55] text-white/80">
              {SPECIES.length} species, one lane. A reminder counts down to a date, a bundle gathers
              everything one person owes, a watcher waits on the inbox, a digest reports to a list, an event
              answers a flow, a letter hands one person one message, the shift clock speaks for the schedule,
              a call-off looks for cover and a window ask learns when somebody can be reached — and two
              species are not messages at all: a gate is a brake on a door, and an AI row only says which
              model answers a question.
            </p>
          </div>
        </div>
      </div>

      {/* THE THREE STEPS, ABOVE THE LIST. Somebody reading "switch it on" and
          the row they are switching must see both in one eyeful — nobody reads
          a manual on another screen, which is how the lane got obscure. */}
      <h2 className="mb-2 text-[13px] font-semibold text-text-2">
        What to do with one of them
      </h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Step n={1} eyebrow="To switch one on" title="The Desk decides, never the code" tint="blue">
          <p>
            Open <em>Smart Comms › Desk</em>, find the row by its <Cell>id</Cell> — the same id printed on
            every row below — and switch it on. The Desk keeps the switch in Postgres
            {book?.record
              ? <>, which holds the record of the situations{book.name ? <> (<em>{book.name}</em>)</> : null}: the
                  Google sheet is only its backup copy.</>
              : <>.</>}
          </p>
          <p>
            <span className="font-semibold text-text-1">A publish can never switch a sender on.</span>{' '}
            Deploying code changes what a situation would say, never whether it says it. Only that row
            can. A cell typed into the Google sheet comes back only with the daily check — the Desk is
            where a switch takes effect at once. This page only reads.
          </p>
          <Link
            to={deskHref}
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
          >
            <Megaphone size={12} /> Open the Desk
          </Link>
        </Step>

        <Step n={2} eyebrow="To test it" title="Record it, reach nobody" tint="amber">
          <p>
            <span className="font-semibold text-text-1">What is built.</span> In{' '}
            <em>Settings → Test mode</em>, turn <Cell>test_mode</Cell> on (<Cell>sheet</Cell>,{' '}
            <Cell>rehearsal</Cell> and <Cell>paper</Cell> are the same position). Every message is then
            stopped at the transport door and kept in Postgres instead of being sent — the mock outbox{' '}
            (<Cell>app.comm_mock</Cell>) and the rehearsal log (<Cell>app.comm_rehearsal</Cell>): who would
            have been told, through which channel, the exact subject and body, and the verdict and reasons
            beside them. No phone, no inbox, no sheet.
          </p>
          <p>
            It is safer than the redirect it replaces: the tester lists are handed out empty, so the
            standing law — a channel with nobody listed refuses rather than falling back to the real
            person — fires for every channel at once. Nothing in this position can reach anybody.
          </p>
          <p>
            <span className="font-semibold text-text-1">Where it is read.</span> Postgres is the only
            record of a test pass: no sheet is written and none is read. The Rehearsal page reads the plan
            (<Cell>comm_intents</Cell> / <Cell>comm_bindings</Cell>), not those messages.
          </p>
        </Step>

        <Step n={3} eyebrow="To let it go out" title="One switch" tint="mint">
          <p>
            <Cell>test_mode</Cell> off in <em>Settings → Test mode</em>. The sending dial follows it on its own —
            test mode on is <Cell>record</Cell> (everything worked out and written down, nothing handed over),
            off is <Cell>send</Cell> — so there is no second key to turn.
          </p>
          <p>
            <span className="font-semibold text-text-1">Until then, nothing reaches a person.</span>{' '}
            The ledger writes <Cell>rehearsal</Cell> on every row, and the Activity page counts those as
            reaching nobody — so nobody is recorded as told, which is exactly what happened.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <Position
              label="dial"
              value={dialRead ? (dial || 'off') : ''}
              on={dialRead && dial === 'send'}
              unknownWhy="The dial comes with the situations, and that read did not land — this is unknown, not off."
            />
            <Position
              label="transport"
              value={loading || loadError ? '' : (sendingOn ? 'open' : 'shut')}
              on={sendingOn}
              unknownWhy="The transport door's position comes with the situations, and that read did not land."
            />
          </div>
          <p className="text-text-3">
            The transport door is a third switch of its own, and it binds every rung of the ladder below.
          </p>
        </Step>
      </div>

      {/* THE PARAMETER MAP — every knob in the lane, what it does, and the room
          it is edited in. The rule for this page is that nothing may
          be left for a reader to remember; a switch whose name and address are not
          written down is the thing nobody remembers. */}
      <h2 className="mb-1 mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
        <SlidersHorizontal size={14} className={cn('shrink-0', TINT_FG.blue)} />
        Every knob, what it does, and where it lives
      </h2>
      <p className="mb-1 text-[12px] leading-[17px] text-text-3">
        Nothing in this lane is configured in code. Every one of these is a cell somebody types a word
        into — or, in one case, a platform property — and this map is the address of each. Where the page
        can read a position it prints it; where it cannot, the row says so in words rather than drawing
        the code&apos;s default and letting it pass for a reading. The floors quoted are what the code
        assumes when a cell is EMPTY, which is not the same thing as what the cell says.
      </p>
      <KnobBlock
        title="The row’s own cells — what one situation is"
        lede="Written on the situation itself — one row per thing the platform can say, switched and edited on the Desk and kept in Postgres."
        knobs={rowKnobs}
      />
      <KnobBlock
        title="The doors — whether anything leaves the building"
        lede="Lane-wide, and independent of each other: every one of them must agree before a person hears anything."
        knobs={doorKnobs}
      />
      <KnobBlock
        title="The pace and the patience — what it costs the person"
        lede={`The lane speaks slowly on purpose. These are the numbers that decide how slowly, each a row of ${wordsBook}’s Digest Settings, printed as it is written now. The Hub has no screen for them yet: Postgres keeps that book’s record, and a row typed into its Google sheet comes back with the daily check, not at once.`}
        knobs={paceKnobs}
      />

      {/* THE LADDER. It belongs beside the list because it is what a situation
          may COST the person it reaches — and because the three permissions
          must be read as three. */}
      <h2 className="mb-2 mt-7 text-[13px] font-semibold text-text-2">
        What a message may cost the person who gets it
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LADDER.map((r) => (
          <Card key={r.id} padded={false} className="flex h-full flex-col p-4">
            <span className={cn('inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG[r.tint], TINT_FG[r.tint])}>
              {r.id}
            </span>
            <p className="mt-2 text-[12.5px] font-semibold leading-[17px] text-text-1">{r.why}</p>
            <ul className="mt-2 space-y-1">
              <Permission ok={r.gap} yes="skips the pacing gap" no="waits for the pacing gap" />
              <Permission ok={r.sleep} yes="may wake somebody" no="never wakes anybody" />
              <Permission ok={r.weekend} yes="may be said on a weekend" no="holds over a weekend" />
            </ul>
            <p className="mt-2 text-[11px] leading-[16px] text-text-3">{r.cap}</p>
            <p className="mt-2 border-t border-border pt-2 text-[11.5px] leading-[17px] text-text-2">
              {r.carries}
            </p>
          </Card>
        ))}
      </div>
      <p className="mt-2.5 text-[11.5px] leading-[17px] text-text-3">
        <span className="font-semibold text-text-2">A rung is a pacing decision, never a permission.</span>{' '}
        Nothing on this ladder opens a door: the opt-out list, consent, the dial, the transport door and
        the test position bind every rung, <Cell>safety</Cell> included.
      </p>

      {/* WHERE EACH ROW'S RUNG COMES FROM — said once and in full, rather than
          hidden in the tooltip of a chip nobody hovers. */}
      <div
        className="mt-3 rounded-lg border border-border bg-surface-2 p-3.5"
        style={{ borderLeft: `3px solid ${TINT_VAR.blue}` }}
      >
        <p className="text-[12.5px] font-semibold text-text-1">
          Where each row’s rung comes from
        </p>
        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-2">
          The ladder lives in the policy; the membership is the three <Cell>comm_priority_*</Cell> rows of
          the Digest Settings. Each row below prints the rung the lane resolves for its id, and anything
          not listed is an <Cell>ask</Cell>.{' '}
          {countsKnown && lane?.priorities
            ? <><span className="font-stat text-text-1">{stats.aboveAsk}</span> of{' '}
                <span className="font-stat text-text-1">{situations.length}</span> sit above ask.</>
            : countsKnown
              ? <>The Digest Settings did not answer just now, so every row reads{' '}
                  <span className="font-mono text-[11.5px] text-text-1">priority —</span>: unknown, not ask.</>
              : null}
        </p>
      </div>

      {/* HOW TO READ A ROW — the one worked example on the page, and it says on
          its face that it is one. A frozen figure that is not labelled is how a
          screen starts lying about a count nobody took. */}
      <h2 className="mb-2 mt-7 text-[13px] font-semibold text-text-2">How to read a row</h2>
      <Card padded={false} className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words font-mono text-[12.5px] font-semibold text-text-1">
            cpr_expiring
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3">
            illustration
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-[18px] text-text-2">
          CPR card, 45 days before it lapses.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG[RUNG.ask.tint], TINT_FG[RUNG.ask.tint])}>
            ask
          </span>
          <Badge label="sms" tint="blue" />
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4', TINT_BG.mint, TINT_FG.mint)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> on
          </span>
        </div>
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[12px] leading-[17px] text-text-2">
          <li>
            <span className="font-semibold text-text-1">The id</span> is the row&apos;s name on the Desk.
            It is what you search for there, and it never changes when the words do.
          </li>
          <li>
            <span className="font-semibold text-text-1">The sentence</span> is built only out of that
            row&apos;s own cells — the credential and the days before it. A row that carries neither gets
            no sentence at all rather than an invented one.
          </li>
          <li>
            <span className="font-semibold text-text-1">The channel chips</span> are the row&apos;s{' '}
            <Cell>channels</Cell> cell: the doors it may leave by, or “no channel” when it names none.
          </li>
          <li>
            <span className="font-semibold text-text-1">The rung</span> is what the message may cost the
            person — the lane&apos;s own answer for that id, or an em-dash when the ladder could not be read.
          </li>
          <li>
            <span className="font-semibold text-text-1">on / off</span> is the <Cell>enabled</Cell> cell,
            printed as a fact and not as a control: this page has no switch on it, because a third door
            onto the same truth is how two of them start disagreeing.
          </li>
        </ul>
        <p className="mt-3 text-[11.5px] leading-[16px] text-text-3">
          The figures on this one card are an illustration of the shape — not a reading. Every row below
          this point is read from the live catalogue.
        </p>
      </Card>

      {/* THE LIST */}
      {groups.map((g) => {
        if (!g.items.length) return null
        const folded = g.id === 'ai' && !showAi
        const open = !!expanded[g.id]
        const shown = open ? g.items : g.items.slice(0, PREVIEW_ROWS)
        const hidden = g.items.length - shown.length
        return (
          <div key={g.id} className="mt-7">
            <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
              <g.icon size={14} className={cn('shrink-0', TINT_FG[g.tint])} /> {g.title}
              <span className="text-[11px] font-normal text-text-3">
                {g.items.length} · {countsKnown ? `${g.live} on` : '— on'} · {g.caption}
              </span>
              {g.id === 'ai' && (
                <button
                  type="button"
                  onClick={() => setShowAi((v) => !v)}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                >
                  {folded ? 'Show' : 'Hide'}
                </button>
              )}
            </h2>
            <p className="mb-3 text-[12px] leading-[17px] text-text-3">{g.lede}</p>

            {!folded && (
              <>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {shown.map((s) => {
                    const on = s.enabled === 'yes'
                    const sentence = describe(s)
                    const channels = String(s.channels ?? '')
                    const isAi = kindOf(s) === 'ai'
                    const isGate = kindOf(s) === 'gate'
                    return (
                      <Card key={s.id} padded={false} className={cn('p-4 transition-opacity', !on && 'opacity-70')}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 break-words font-mono text-[12.5px] font-semibold text-text-1">
                            {s.id}
                          </p>
                          {/* ON/OFF IS A FACT HERE, NOT A CONTROL — the switch is
                              the Desk's, and a second door onto the same truth is
                              how two of them start disagreeing. */}
                          <span
                            title={isGate
                              ? (on ? 'Armed on the Desk — it holds its door while test mode holds.' : 'Not armed — its door is not held.')
                              : on ? 'Switched on on the Desk.' : 'Written and silent — one switch away from speaking.'}
                            className={cn(
                              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4',
                              on ? cn(TINT_BG.mint, TINT_FG.mint) : 'border border-border bg-surface-2 text-text-3',
                            )}
                          >
                            <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-current' : 'bg-text-3')} />
                            {on ? (isGate ? 'armed' : 'on') : 'off'}
                          </span>
                        </div>
                        {sentence ? (
                          <p className="mt-1 text-[12px] leading-[18px] text-text-2">{sentence}</p>
                        ) : (
                          <p className="mt-1 text-[12px] leading-[18px] text-text-3">
                            The row carries no condition this page can read — its id is all it says.
                          </p>
                        )}
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {!isAi && !isGate && <PriorityChip sit={s} />}
                          {channels.includes('sms') && <Badge label="sms" tint="blue" />}
                          {channels.includes('email') && <Badge label="email" tint="lavender" />}
                          {channels.includes('web') && <Badge label="web" tint="mint" />}
                          {!channels.trim() && (
                            <span
                              title={isAi
                                ? 'An AI request carries no channel: it asks a model a question and reaches nobody.'
                                : isGate
                                  ? 'A gate carries no channel: it holds a door, it says nothing.'
                                  : 'This row names no channel, so there is no door for it to leave by.'}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold leading-4 text-text-3"
                            >
                              {isAi ? 'reaches nobody' : isGate ? 'a brake, not a message' : 'no channel'}
                            </span>
                          )}
                        </div>
                      </Card>
                    )
                  })}
                </div>
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [g.id]: true }))}
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                  >
                    Show the other {hidden} {g.title.toLowerCase()}
                  </button>
                )}
                {open && g.items.length > PREVIEW_ROWS && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [g.id]: false }))}
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                  >
                    Show fewer
                  </button>
                )}
              </>
            )}
            {folded && (
              <p className="text-[11.5px] leading-[17px] text-text-3">
                Folded by default because they are not messages and reach nobody: {g.items.length} rows
                that only configure which model answers a question, not what a person is told.
              </p>
            )}
          </div>
        )
      })}

      {loading && situations.length === 0 && (
        <p className="mt-7 inline-flex items-center gap-2 text-[12.5px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the catalogue…
        </p>
      )}

      {/* "The tab holds nothing" is a claim about the tab, and only a read that
          came back may make it. A read that threw gets the retry instead. */}
      {!loading && !loadError && situations.length === 0 && (
        <div className="mt-7">
          <EmptyState title="No situations" body="The situations came back holding nothing at all." />
        </div>
      )}

      {!loading && loadError && (
        <div className="mt-7 rounded-md border border-border bg-surface-2 px-4 py-3">
          <p className="text-[13px] font-semibold text-text-1">The catalogue could not be read.</p>
          <p className="mt-1 text-[12px] leading-[18px] text-text-3">
            Nothing here says the platform can say nothing — this page simply did not hear back. {loadError}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
          >
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}

      {/* WHY THIS IS A PAGE AND NOT A SECTION OF THE DESK. The argument is
          printed rather than assumed, because the next person to tidy the app
          will otherwise fold it back into the Desk and lose the only list of
          what is switched off. */}
      <h2 className="mb-1 mt-9 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
        <Compass size={14} className={cn('shrink-0', TINT_FG.peach)} />
        Why this is its own page and not a section
      </h2>
      <p className="mb-3 text-[12px] leading-[17px] text-text-3">
        The argument for one more page rather than folding this into the Desk.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card padded={false} className="p-4">
          <h3 className="font-display text-[13.5px] font-bold leading-5 text-text-1">
            The Desk is for changing one thing
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-2">
            It opens a drawer, you edit the words, you close it. It is already dense with{' '}
            {countsKnown
              ? <><span className="font-stat text-text-1">{situations.length}</span> cards and{' '}
                <span className="font-stat text-text-1">{speciesWithRows}</span> species</>
              : <>every card and every species at once</>}. A catalogue that answers “what exists and how
            do I operate it” is a different question asked by a different person on a different day.
          </p>
        </Card>
        <Card padded={false} className="p-4">
          <h3 className="font-display text-[13.5px] font-bold leading-5 text-text-1">
            The Guide teaches, this one operates
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-2">
            How it works explains the lane end to end. This page is the reference you open while doing
            something: which id, which channel, which switch, and what happens when you flip it.
          </p>
        </Card>
        <Card padded={false} className="p-4">
          <h3 className="font-display text-[13.5px] font-bold leading-5 text-text-1">
            The instructions belong beside the list
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-2">
            Three steps at the top, the parameter map under them, the catalogue underneath. Nobody reads
            a manual on another screen — “switch it on” and “the row you switch” have to be in the same
            eyeful.
          </p>
        </Card>
        <Card padded={false} className="p-4">
          <h3 className="font-display text-[13.5px] font-bold leading-5 text-text-1">
            {countsKnown && stats.off > 0
              ? <>The <span className="font-stat">{stats.off}</span> silent rows are the point</>
              : <>The silent rows are the point</>}
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-2">
            Written, tested, and switched off. Nowhere else in the platform lists them, so nobody knows
            they exist. That is the number this page exists to surface.
          </p>
        </Card>
      </div>
      <p className="mt-3 text-[11.5px] leading-[17px] text-text-3">
        Reading order in the app: <span className="font-semibold text-text-2">Desk</span> (change one) ·{' '}
        <span className="font-semibold text-text-2">Catalogue</span> (what exists, how to operate) ·{' '}
        <span className="font-semibold text-text-2">Rehearsal</span> (who would be told) ·{' '}
        <span className="font-semibold text-text-2">Activity</span> (who was told) ·{' '}
        <span className="font-semibold text-text-2">Replies</span> (what they said) ·{' '}
        <span className="font-semibold text-text-2">When</span> (when we may speak) ·{' '}
        <span className="font-semibold text-text-2">How it works</span> (why any of it).
      </p>
    </div>
  )
}
