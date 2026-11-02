// The Smart Comms activity page: the proof of every message — the deliveries ledger (who was told, when, through…
// WHAT THE HEADLINE COUNTS: the tellings of the last seven days, taken from the very rows below it — this page…
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, BookOpen, Clock, FileSpreadsheet, FlaskConical, HeartPulse, Mail,
  RefreshCw, Search, Table2,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { Badge } from '@/components/shared/Badge'
import { heroBand, TINT_FG, TINT_VAR } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { gasAction } from '@/features/hiring/shared'
import { onLiveEvent } from '@/lib/snapshotClient'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// A LEDGER ROW.
type Delivery = {
  situation: string; person: string; expires: string; channel: string; at: string
  said?: string
  /** every ledger row is a send that left: the ledger is written only when the provider took it */
  status?: 'sent'
  /** what left, from the outbox (secrets withheld; an admin only); absent for a send from before it kept words */
  text?: string; subject?: string
  /** whether the provider handed back a receipt for it */
  receipt?: boolean
}
// A send the transport tried that did not leave (the outbox's failed, refused, no-phone and unknown rows).
type NotSent = { situation: string; person: string; to: string; channel: string; state: string; why: string; at: string }
type DueRow = { situation: string; name: string; credential: string; expires: string; days_left: number; preview?: string }

/** A due row's day: the days left, due today, or how long ago it expired — never a negative count. */
export const dueWords = (days: number): string =>
  days < 0 ? `Expired ${-days}d ago` : days === 0 ? 'Due today' : `${days}d left`

// One house the lane writes, where it lives now (rows null: it could not be read).
type HouseRead = { id: string; name: string; book_id: string; record: boolean; rows: number | null; why: string }
// One message test mode held, from app.comm_rehearsal (the words come for an admin only).
type Rehearsal = {
  at: string; situation: string; purpose: string; channel: string; person: string; to: string
  would_have_sent: boolean; reasons: string; subject: string; body: string
}

// What `smartCommsHistory` answers.
type HistoryReply = {
  deliveries?: Delivery[]
  wording?: Record<string, string>
  test_mode?: { on?: boolean; sms?: string[]; emails?: string[] }
  houses?: HouseRead[]
  rehearsals?: { rows: Rehearsal[] | null; why: string }
  not_sent?: NotSent[] | null
}

/** The Smart Comms live event: rung after a clock turn told or rehearsed somebody, and after a landed send. */
const LIVE_EVENT = 'smartcomms'

type TestMode = { on: boolean; sms: string[]; emails: string[] }

// ------------------------------------------------------------------ the words behind a telling…

type Wording = 'same' | 'changed' | 'unknown'

// Compare what a telling was rendered from against what its situation would say now.
function wordingOf(d: Delivery, now: Record<string, string> | null): Wording {
  const said = String(d.said || '').trim()
  if (!said || !now) return 'unknown'
  const today = String(now[d.situation] || '').trim()
  if (!today) return 'unknown'
  return today === said ? 'same' : 'changed'
}

const WORDING_LABEL: Record<Wording, string> = {
  same: 'Words still current',
  changed: 'Words changed since — a correction would start here',
  unknown: 'Words not recorded — unknown, not unchanged',
}

// Pink is the trail's colour for "the ledger did not say", the same one the Unknown channel band wears; peach is…
const WORDING_TINT: Record<Wording, TintName> = {
  same: 'mint',
  changed: 'peach',
  unknown: 'pink',
}

const WORDING_NOTE: Record<Wording, string> = {
  same: 'The words behind this telling are still the words this situation sends.',
  changed: 'This situation says something else now — what went out here is not what would go out today.',
  unknown: 'What this telling said was not recorded — the row was written before the trail kept the wording, ' +
    'or today\'s wording cannot be read. It is not evidence that the words held.',
}

// ------------------------------------------------------------------ the channels a ledger row can carry…

type Band = 'sms' | 'email' | 'team' | 'other' | 'unknown' | 'rehearsal'

// Fixed order, so a quiet week keeps the same bar as a loud one.
const BANDS: Band[] = ['sms', 'email', 'team', 'other', 'unknown', 'rehearsal']

const BAND_LABEL: Record<Band, string> = {
  sms: 'SMS',
  email: 'E-mail',
  team: 'Team',
  other: 'Other',
  unknown: 'Unknown',
  rehearsal: 'Rehearsal',
}

const BAND_TINT: Record<Band, TintName> = {
  sms: 'blue',
  email: 'lavender',
  team: 'mint',
  other: 'peach',
  unknown: 'pink',
  rehearsal: 'amber',
}

// WHY THE REHEARSAL BAND SHOWS A DASH.
const REHEARSAL_NOTE =
  'Rehearsals do not reach this screen — the trail drops rows whose channel is exactly "rehearsal". ' +
  'The band is here so you know the lane exists; it is not a measured zero.'

// A ledger row can name more than one channel — the sweep writes `delivered.join('+')`, so 'sms+email' is one…
function bandsOf(channel: string): Band[] {
  const parts = String(channel || '').toLowerCase().split('+').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return ['unknown']
  return parts.map((p) =>
    p === 'sms' || p === 'email' || p === 'team' || p === 'rehearsal' ? (p as Band) : 'other',
  )
}

const WINDOW_MS = 7 * 86_400_000

// The server's clock and the browser's are never the same clock.
const SKEW_MS = 60_000

function ago(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  // A STAMP AHEAD OF THE CLOCK IS NOT "JUST NOW".
  if (ms < -SKEW_MS) return 'dated ahead'
  if (ms < 0) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`
  return `${(ms / 86_400_000).toFixed(1)}d ago`
}

// ------------------------------------------------------------------ what this page says about itself…

// ONE LAW THIS TRAIL KEEPS, WRITTEN WHERE IT IS READ.
function Rule({ tint, label, children }: { tint: TintName; label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2.5" style={{ borderLeft: `3px solid ${TINT_VAR[tint]}` }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</p>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">{children}</p>
    </div>
  )
}

// One row of the provenance table.
function Source({ what, count, from, unread }: { what: string; count: string; from: string; unread?: boolean }) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="py-2 pl-4 pr-3 text-[12.5px] leading-[1.45] text-text-2">{what}</td>
      <td className={cn('whitespace-nowrap py-2 pr-3 text-right font-stat text-[12.5px]', unread ? 'text-text-3' : 'text-text-1')}>
        {count}
      </td>
      <td className="break-all py-2 pr-4 font-mono text-[11px] leading-[1.45] text-text-3">{from}</td>
    </tr>
  )
}

// THE HOUSES THIS LANE WRITES, AND WHAT ONE ROW OF EACH IS — where each lives, and how many rows, come with the trail.
const HOUSE_WHAT: Record<string, string> = {
  comm_intents: 'One person’s thread: the verdict, every reason, the channel, both memories, the escalation, the reply token.',
  comm_bindings: 'One obligation inside a thread, with its own state: open, settled, deferred, superseded.',
  comm_attempts: 'One attempt: channel, masked number, the provider’s receipt, the error, the doubt. Append-only.',
  comm_observations: 'The trail of what happened: sent, redirected, replied, unmatched, consent changed.',
  comm_routes: 'What the graph proposes per person: a phone, an address, the hours their own shifts say they are awake.',
  comm_contributions: 'What a person answered, read against the record — and the owner’s verdict on it.',
  smart_comms_sent: 'The catalogue’s own ledger, shared with the older reminder lanes. A rehearsal is never written here — test mode keeps its messages in Postgres, shown above.',
}

/** The house this page actually reads, so the table can mark it apart. */
const LEDGER_HOUSE = 'smart_comms_sent'

export default function SmartCommsActivityPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [due, setDue] = useState<DueRow[]>([])
  const [previewDenied, setPreviewDenied] = useState(false)
  // WOULD FIRE NOW STAYS UP: a failed read keeps the last good list and says when it was read.
  const [dueFailed, setDueFailed] = useState('')
  const [dueAt, setDueAt] = useState<Date | null>(null)
  const [houses, setHouses] = useState<HouseRead[] | null>(null)
  const [held, setHeld] = useState<{ rows: Rehearsal[] | null; why: string } | null>(null)
  const [notSent, setNotSent] = useState<NotSent[] | null>(null)
  const [heldAt, setHeldAt] = useState<Date | null>(null)
  // THE TRAIL DID NOT ANSWER — which is not an empty trail.
  const [trailFailed, setTrailFailed] = useState(false)
  /** null = the door does not send today's wording yet, NOT "no wording". */
  const [wording, setWording] = useState<Record<string, string> | null>(null)
  /** null = the trail does not say whether the redirect is on. */
  const [testMode, setTestMode] = useState<TestMode | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'changed' | 'unknown'>('all')

  // `quiet` is a live re-read: nothing flashes, and a failure keeps what was last read rather than blanking it.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const hist = await gasAction<HistoryReply>('smartCommsHistory', { limit: 500 })
      setDeliveries(hist.deliveries ?? [])
      // An absent map and an empty one are different answers, and only one of them is allowed to mark rows changed.
      const w = hist.wording
      setWording(w && typeof w === 'object' && Object.keys(w).length ? w : null)
      // Same law for test mode: only a stated boolean turns the banner into a fact.
      const t = hist.test_mode
      setTestMode(t && typeof t.on === 'boolean'
        ? { on: t.on, sms: Array.isArray(t.sms) ? t.sms : [], emails: Array.isArray(t.emails) ? t.emails : [] }
        : null)
      setHouses(Array.isArray(hist.houses) ? hist.houses : null)
      setHeld(hist.rehearsals ?? null)
      setNotSent(Array.isArray(hist.not_sent) ? hist.not_sent : null)
      setHeldAt(new Date())
      setTrailFailed(false)
    } catch (err) {
      if (!quiet) {
        setDeliveries([])
        setWording(null)
        setTestMode(null)
        setHouses(null)
        setHeld(null)
        setTrailFailed(true)
        toast({ type: 'danger', title: 'Could not load the trail', body: err instanceof Error ? err.message : String(err) })
      }
    }
    try {
      const prev = await gasAction<{ due?: DueRow[] }>('smartCommsPreview', {})
      setDue(prev.due ?? [])
      setDueAt(new Date())
      setPreviewDenied(false)
      setDueFailed('')
    } catch (err) {
      // only the door's own refusal is "admin-only"; any other failure keeps the last list up and says so
      if ((err as { status?: number })?.status === 403) {
        setDue([])
        setPreviewDenied(true)
      } else {
        setDueFailed(err instanceof Error ? err.message : String(err))
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // THE PAGE STAYS CONSTANT. Every turn of the clock that told or rehearsed somebody rings the live event, and the
  // page reads again; so does a reconnected stream and a tab brought back into view. One read at a time, and a ring
  // that lands during one is read right after it. No timer.
  const reading = useRef(false)
  const again = useRef(false)
  useEffect(() => {
    const reread = () => {
      if (reading.current) { again.current = true; return }
      reading.current = true
      void load(true).finally(() => {
        reading.current = false
        if (again.current) { again.current = false; reread() }
      })
    }
    const seen = () => { if (document.visibilityState === 'visible') reread() }
    const offRing = onLiveEvent(LIVE_EVENT, reread)
    const offOpen = onLiveEvent('open', reread)
    document.addEventListener('visibilitychange', seen)
    return () => { offRing(); offOpen(); document.removeEventListener('visibilitychange', seen) }
  }, [load])

  // THE SEARCH AND THE WORDING FILTER ARE ONE SET.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return deliveries.filter((d) => {
      if (needle && !`${d.situation} ${d.person} ${d.channel}`.toLowerCase().includes(needle)) return false
      if (only === 'all') return true
      return wordingOf(d, wording) === only
    })
  }, [deliveries, q, only, wording])

  const filtering = q.trim() !== '' || only !== 'all'
  const rowsOf = (id: string): number | null => houses?.find((h) => h.id === id)?.rows ?? null
  const attemptsNow = rowsOf('comm_attempts')
  const observationsNow = rowsOf('comm_observations')

  // THE HEADLINE READS THE ROWS THE TRAIL IS SHOWING — the filtered ones.
  const head = useMemo(() => {
    const now = Date.now()
    const counts: Record<Band, number> = { sms: 0, email: 0, team: 0, other: 0, unknown: 0, rehearsal: 0 }
    const words: Record<Wording, number> = { same: 0, changed: 0, unknown: 0 }
    let recent = 0
    let rehearsed = 0
    let digests = 0
    let lastAt = ''
    let lastMs = -Infinity
    for (const d of shown) {
      const ms = Date.parse(d.at)
      if (Number.isFinite(ms) && ms > lastMs) { lastMs = ms; lastAt = d.at }
      // A DATE IN THE FUTURE IS NOT INSIDE THE WINDOW.
      const age = now - ms
      if (!Number.isFinite(ms) || age > WINDOW_MS || age < -SKEW_MS) continue
      recent += 1
      const bands = bandsOf(d.channel)
      for (const b of bands) counts[b] += 1
      if (bands.includes('rehearsal')) rehearsed += 1
      if (String(d.person || '').trim().toLowerCase() === 'digest') digests += 1
      words[wordingOf(d, wording)] += 1
    }
    const parts = BANDS.reduce((sum, b) => sum + counts[b], 0)
    return { counts, words, recent, rehearsed, digests, lastAt, parts }
  }, [shown, wording])

  /** Nothing may be stated as a count while the ledger is unread or unreadable. */
  const blind = loading || trailFailed

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Activity"
          subtitle="Every telling this platform actually made, newest first."
          actions={
            <>
              <PageSwitch />
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </>
          }
        />
      </motion.div>

      {/* DID ANY OF THIS REACH A PERSON? — the first thing a reader of a trail
          needs, and the last thing they should have to infer from a channel
          column. Three states, and the third one says so out loud. */}
      <div
        className={cn(
          'mb-4 flex items-start gap-2.5 rounded-[14px] border px-4 py-3 text-[12.5px] leading-[1.45]',
          testMode?.on
            ? 'border-transparent bg-tint-amber text-tint-fg-amber'
            : 'border-border bg-surface text-text-2',
        )}
      >
        {/* The alarm icon belongs to the state nobody can check, not to the
            state that is merely on: an unknown redirect is the one a reader
            must not walk past. */}
        {testMode === null
          ? <AlertTriangle size={15} className="mt-[1px] shrink-0 text-tint-fg-amber" />
          : <FlaskConical size={15} className={cn('mt-[1px] shrink-0', testMode.on ? '' : 'text-text-3')} />}
        <p className="min-w-0">
          {testMode === null ? (
            <>
              <span className="font-semibold">Rehearsal or proof — this trail does not say.</span>{' '}
              Whether test mode is on did not come back with the trail, so nothing below is proof that a
              person was reached. While test mode is on nothing leaves: each message is held in Postgres
              and listed under Held by test mode, never in the deliveries.
            </>
          ) : testMode.on ? (
            <>
              <span className="font-semibold">Test mode is on — nothing leaves the platform.</span>{' '}
              No message reaches anybody, testers included, and the people named are still owed the real
              message. What the lane would have said is listed live under Held by test mode, newest first;
              the deliveries are what went out while test mode was off.
            </>
          ) : (
            <>
              <span className="font-semibold">Test mode is off.</span>{' '}
              The tellings below went to the people they name.
            </>
          )}
        </p>
      </div>

      {/* the headline, on the one dark surface this design system keeps */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Tellings in the last 7 days
            </p>
            {/* ZERO IS A FINDING, AND THERE IS NO FINDING YET while the ledger
                is still being read — the first paint used to state "0 tellings"
                as fact, before a single row had arrived. A read that FAILED is
                the same silence: it says nothing about how quiet the week was. */}
            <p className={cn('font-stat text-[60px] leading-none', blind ? 'text-white/25' : 'text-white')}>
              {blind ? '—' : head.recent}
            </p>
            <p className="mt-1 text-[12px] text-white/60">
              {loading
                ? 'Reading the ledger…'
                : trailFailed
                  ? 'The ledger could not be read — this is not a quiet week, it is an unanswered question.'
                  : filtering
                    ? `of ${shown.length} row${shown.length === 1 ? '' : 's'} matching the filter · last one ${ago(head.lastAt)}`
                    : `of ${deliveries.length} row${deliveries.length === 1 ? '' : 's'} in the trail · last one ${ago(head.lastAt)}`}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              How they left
            </p>
            {/* a band with no count draws nothing — the legend still carries its 0.
                The colours come from heroBand(): this bar is painted on the one
                always-navy surface, where the theme-following tint tokens turn to
                dark ink on dark ground for half the estate. */}
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {!blind && BANDS.map((b) => (
                head.counts[b] ? (
                  <span
                    key={b}
                    title={`${head.counts[b]} ${BAND_LABEL[b]}`}
                    style={{ width: `${(head.counts[b] / Math.max(1, head.parts)) * 100}%`,
                             background: heroBand(BAND_TINT[b]) }}
                  />
                ) : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/70">
              {BANDS.map((b) => {
                // The rehearsal lane is filtered out upstream, so its 0 is not a count — it is the absence of one.
                const unmeasured = b === 'rehearsal' && !blind && !head.counts.rehearsal
                return (
                  <span
                    key={b}
                    title={b === 'rehearsal' ? REHEARSAL_NOTE : undefined}
                    className={cn('inline-flex items-center gap-1.5', unmeasured && 'opacity-60')}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: heroBand(BAND_TINT[b]) }} />
                    {BAND_LABEL[b]}{' '}
                    <span className="font-stat text-white">
                      {blind || unmeasured ? '—' : head.counts[b]}
                    </span>
                  </span>
                )
              })}
            </div>
            {(head.rehearsed > 0 || head.digests > 0) && (
              <p className="mt-3 text-[12.5px] text-white/80">
                {head.rehearsed > 0 && (
                  <>
                    <span className="font-stat text-white">{head.rehearsed}</span> of them were
                    {' '}rehearsals — test mode held those (before it became the one switch, it sent them to
                    {' '}the testers), and the people they name are
                    {' '}still owed the real message.
                  </>
                )}
                {head.rehearsed > 0 && head.digests > 0 ? ' ' : null}
                {head.digests > 0 && (
                  <>
                    <span className="font-stat text-white">{head.digests}</span> weekly digest
                    {head.digests === 1 ? '' : 's'} went to a desk, not to a person.
                  </>
                )}
              </p>
            )}
            {/* THE WORDS BEHIND THEM — the line a correction is built from.
                With no wording to compare against, the three numbers would all
                be the same number dressed three ways, so the page says what it
                is missing instead of counting to zero. */}
            {!blind && (wording === null || head.recent > 0) && (
              <p className="mt-3 text-[12.5px] text-white/70">
                {wording === null ? (
                  <>
                    <span className="font-stat text-white">—</span> The words behind these tellings
                    {' '}are not in the trail yet, so none of them can be checked against what the
                    {' '}situations say today. Unknown, not unchanged.
                  </>
                ) : (
                  <>
                    Words behind them:{' '}
                    <span className="font-stat text-white">{head.words.same}</span> still current ·{' '}
                    <span className="font-stat text-white">{head.words.changed}</span> changed since ·{' '}
                    <span className="font-stat text-white">{head.words.unknown}</span> never recorded
                    {head.words.changed > 0
                      ? ' — the changed ones are where a correction starts.'
                      : head.words.unknown > 0
                        ? ' — and the unrecorded ones are why no correction can call itself complete.'
                        : '.'}
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* WHAT TEST MODE HELD — the activity while nothing leaves. A rehearsal never reaches the ledger below, so
          without this the page was empty for exactly the weeks somebody was testing. Live: it reads again on every
          ring of the clock. */}
      <div className="mb-5">
        <h2 className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <FlaskConical size={14} className={cn('shrink-0', TINT_FG.amber)} /> Held by test mode
          <span className="text-[11px] font-normal text-text-3">
            {held?.rows
              ? `the newest ${held.rows.length} · app.comm_rehearsal${heldAt ? ` · read ${heldAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : ''}`
              : 'app.comm_rehearsal'}
          </span>
        </h2>
        <Card padded={false}>
          {held === null ? (
            <div className="px-4 py-6 text-center text-[12px] text-text-3">
              {loading ? 'Reading what test mode held…' : 'The trail did not come back, so what test mode held is unread — not empty.'}
            </div>
          ) : held.rows === null ? (
            <div className="px-4 py-6 text-center text-[12px] text-text-3">
              What test mode held could not be read: {held.why}. Unread, not empty.
            </div>
          ) : held.rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] text-text-3">Test mode has held nothing yet.</div>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {held.rows.map((r, i) => (
                <li key={`${r.at}-${i}`} className="border-b border-border/50 px-3.5 py-2.5 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[12.5px] font-medium text-text-1">
                      <span className="font-mono">{r.situation || r.purpose || '—'}</span>
                      <span className="text-text-3"> · {r.person || r.to || 'nobody named'}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge label={r.channel || 'no channel'} tint={r.channel === 'email' ? 'lavender' : 'blue'} />
                      <span className="text-[11px] tabular-nums text-text-3">{ago(r.at)}</span>
                    </span>
                  </div>
                  {r.reasons && <p className="mt-0.5 text-[11px] leading-4 text-text-3">held: {r.reasons}</p>}
                  {(r.subject || r.body) && (
                    <p className="mt-1 rounded-md bg-surface-2 px-2 py-1.5 text-[11px] leading-4 text-text-2">
                      {r.subject && <span className="font-semibold">{r.subject} — </span>}{r.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* WHAT DID NOT LEAVE — a send the transport tried that failed or was refused. The deliveries below are only
          what left, so a failure would otherwise be invisible here. */}
      {notSent !== null && notSent.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
            <AlertTriangle size={14} className={cn('shrink-0', TINT_FG.pink)} /> Not sent
            <span className="text-[11px] font-normal text-text-3">the newest {notSent.length} · the outbox</span>
          </h2>
          <Card padded={false}>
            <ul className="max-h-[320px] overflow-y-auto">
              {notSent.map((r, i) => (
                <li key={`${r.at}-${i}`} className="border-b border-border/50 px-3.5 py-2.5 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[12.5px] font-medium text-text-1">
                      {r.person || r.to || 'nobody named'}
                      <span className="text-text-3"> · from {r.situation || 'an unnamed situation'}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge label={`Not sent · ${r.state.replace('_', ' ')}`} tint="pink" />
                      <span className="text-[11px] tabular-nums text-text-3">{ago(r.at)}</span>
                    </span>
                  </div>
                  {r.why && <p className="mt-0.5 text-[11px] leading-4 text-text-3">{r.why}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* the deliveries trail */}
        <div className="xl:col-span-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-text-2">Deliveries</h2>
            <div className="flex flex-wrap items-center gap-2">
              {/* The wording filter only exists while there is a wording to
                  compare against. Offered against an absent map it would put
                  every row under "never recorded" and none under "changed",
                  which reads as a finding and is only a missing column. */}
              {wording !== null && (
                <span className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-1">
                  {([
                    ['all', 'All'],
                    ['changed', 'Wording changed'],
                    ['unknown', 'Not recorded'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOnly(key)}
                      title={key === 'all' ? 'Every telling in the trail' : WORDING_NOTE[key]}
                      className={cn(
                        'rounded px-2 py-1 text-[11.5px] font-semibold transition-colors',
                        only === key ? 'bg-surface-2 text-text-1' : 'text-text-3 hover:text-text-2',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              )}
              <span className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5">
                <Search size={12} className="text-text-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Situation, person or channel…"
                  className="w-40 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-3" />
              </span>
            </div>
          </div>
          <Card padded={false}>
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-text-3">
                <RefreshCw size={13} className="animate-spin" /> Reading the ledger…
              </div>
            ) : trailFailed ? (
              // NOT AN EMPTY LEDGER — an unanswered one.
              <div className="px-4 py-10 text-center text-[12px] leading-5 text-text-3">
                The ledger did not answer. Nothing below is missing — nothing below was read.
                <br />Try Refresh; if it keeps failing, the trail is unreadable, not empty.
              </div>
            ) : shown.length === 0 ? (
              filtering ? (
                <div className="px-4 py-10 text-center text-[12px] leading-5 text-text-3">
                  No telling in the trail matches this filter. The trail itself still holds{' '}
                  {deliveries.length} row{deliveries.length === 1 ? '' : 's'}.
                </div>
              ) : (
                <EmptyState title="No deliveries yet" body="When a situation really sends, the telling lands here — person, channel, expiry." />
              )
            ) : (
              <ul className="max-h-[560px] overflow-y-auto">
                {shown.map((d, i) => {
                  const bands = bandsOf(d.channel)
                  const rehearsal = bands.includes('rehearsal')
                  // THE LEDGER'S PERSON COLUMN HOLDS A WORD, NOT A NAME, for a digest row — it is one weekly e-mail…
                  const digest = String(d.person || '').trim().toLowerCase() === 'digest'
                  // Every row carries its wording state, including 'same' — a row that says nothing would let…
                  const words = wordingOf(d, wording)
                  const said = String(d.said || '').trim()
                  return (
                    <li
                      key={`${d.situation}-${d.person}-${d.at}-${i}`}
                      className={cn(
                        'flex items-center justify-between gap-3 border-b border-border/50 px-3.5 py-2.5 last:border-0',
                        rehearsal ? 'bg-tint-amber' : 'hover:bg-surface-2/50',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {digest && <Mail size={14} className="shrink-0 text-tint-fg-lavender" />}
                        <div className="min-w-0">
                          <p className={cn('truncate text-[13px] font-medium', digest ? 'text-text-2' : 'text-text-1')}>
                            {digest ? 'Weekly digest' : (d.person || '—')}
                          </p>
                          {/* PROVENANCE FIRST: which situation said this. A
                              blank one is named as blank — an unattributed
                              telling cannot be corrected, and the gap is worth
                              seeing rather than rendering as empty space. */}
                          <p className="truncate text-[11px] text-text-3">
                            {d.situation ? `from ${d.situation}` : 'from a situation the ledger did not name'}
                            {digest
                              ? (d.expires ? ` · week ${d.expires}` : ' · the whole list, once a week')
                              : (d.expires ? ` · expires ${d.expires}` : '')}
                          </p>
                          {rehearsal && (
                            <p className="mt-0.5 text-[11px] font-medium text-tint-fg-amber">
                              Rehearsal — the testers were told, not {digest ? 'the desk' : (d.person || 'the person')}.
                            </p>
                          )}
                          <p
                            title={said ? `${WORDING_NOTE[words]} Fingerprint ${said.slice(0, 10)}.` : WORDING_NOTE[words]}
                            className={cn(
                              'mt-0.5 flex items-center gap-1.5 text-[11px]',
                              words === 'changed' ? 'font-medium text-tint-fg-peach' : 'text-text-3',
                            )}
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: TINT_VAR[WORDING_TINT[words]] }}
                            />
                            <span className="truncate">
                              {d.text || d.subject
                                ? 'What left, as the outbox kept it'
                                : d.status === 'sent'
                                  ? 'Its words were not kept — this send is older than the outbox that keeps them'
                                  : WORDING_LABEL[words]}
                            </span>
                          </p>
                          {(d.text || d.subject) && (
                            <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface-2 px-2 py-1.5 text-[11px] leading-4 text-text-2">
                              {d.subject && <span className="font-semibold">{d.subject} — </span>}{d.text}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {d.status === 'sent' && !rehearsal && (
                          <span title={d.receipt ? 'The provider took it and handed back a receipt.' : 'The provider took it.'}>
                            <Badge label={d.receipt ? 'Sent ✓ receipt' : 'Sent'} tint="mint" />
                          </span>
                        )}
                        {digest && !rehearsal && <Badge label="Digest" tint="lavender" />}
                        {/* THE RAW CELL STAYS REACHABLE. The badge names the band,
                            and a channel the page does not know collapses into
                            "Other" — which would bury the only clue about what the
                            transport actually wrote. The title keeps the ledger's
                            own word one hover away. */}
                        <span
                          title={d.channel
                            ? `Channel recorded as "${d.channel}"`
                            : 'The ledger left the channel blank — the transport did not say which door it used.'}
                        >
                          <Badge
                            label={bands.map((b) => BAND_LABEL[b]).join(' + ')}
                            tint={BAND_TINT[rehearsal ? 'rehearsal' : bands[0]]}
                          />
                        </span>
                        <span className="text-[11px] text-text-3">{ago(d.at)}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* who would be told now */}
        <div className="xl:col-span-2">
          <h2 className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
            <HeartPulse size={14} className="text-tint-fg-amber" /> Would fire now
            <span className="text-[11px] font-normal text-text-3">
              {dueAt
                ? `live · read ${dueAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
                : 'live'}
            </span>
          </h2>
          {dueFailed && (
            <p className="mb-2 text-[11.5px] leading-[16px] text-text-3">
              <AlertTriangle size={12} className="mr-1 inline text-tint-fg-amber" />
              The last read did not land ({dueFailed}); {dueAt ? 'the list below is the one read before it' : 'nothing has been read yet'}, and the next ring reads again.
            </p>
          )}
          <Card padded={false}>
            {previewDenied ? (
              <div className="px-4 py-8 text-center text-[12px] text-text-3">The live preview is admin-only.</div>
            ) : !dueAt ? (
              <div className="px-4 py-8 text-center text-[12px] text-text-3">
                {loading ? 'Reading who is due…' : 'Who is due could not be read yet — unread, not quiet.'}
              </div>
            ) : due.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-text-3">Nobody is due right now — the sweeps are quiet.</div>
            ) : (
              <ul className="max-h-[560px] overflow-y-auto">
                {due.map((d, i) => (
                  <li key={`${d.situation}-${d.name}-${i}`} className="border-b border-border/50 px-3.5 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-medium text-text-1">{d.name}</p>
                      <Badge label={dueWords(d.days_left)} tint={d.days_left > 0 ? 'amber' : 'pink'} />
                    </div>
                    <p className="text-[11px] text-text-3">{d.situation} · {d.credential} · {d.expires}</p>
                    {d.preview && <p className="mt-1 rounded-md bg-surface-2 px-2 py-1.5 text-[11px] leading-4 text-text-2">{d.preview}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          HOW TO READ THIS TRAIL. Every rule below decided how a row or a
          band above is drawn. They live on the screen because a reader who
          does not know that a rehearsal never arrives here will read a quiet
          bar as a quiet week.
          ───────────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <BookOpen size={14} className={cn('shrink-0', TINT_FG.blue)} />
          How to read this trail
        </h2>
        <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
          This ledger is becoming the evidence a <span className="font-semibold text-text-2">correction</span>{' '}
          is derived from: when the platform learns that what it said was wrong, the only way to work out
          who was told the wrong thing is a trail that remembers which words produced each telling. That is
          why nothing here is allowed to round itself into a tidier number.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Rule tint="amber" label="Rehearsals are listed apart">
            What test mode held is kept in Postgres (<code>app.comm_rehearsal</code>) and listed under Held by
            test mode, never in the deliveries: a ledger row whose channel is the bare word{' '}
            <code>rehearsal</code> is dropped at the door. The Rehearsal band reads an em-dash —{' '}
            <span className="font-semibold text-text-1">not a measured zero</span> — and the person a rehearsal
            names is still owed the real message.
          </Rule>
          <Rule tint="lavender" label="A digest is not a person">
            One weekly e-mail about everybody writes one row, whatever the recipient count, and the ledger’s
            person column holds the literal word <code>digest</code>. Printed raw it read as a colleague
            nobody has met; it is drawn as a weekly digest now, stamped with its week instead of an expiry.
          </Rule>
          <Rule tint="pink" label="A blank channel is Unknown, not SMS">
            It used to be counted as SMS, because the ledger’s writer defaults to sms — but only when it
            knows nothing was delivered. A blank that reaches the ledger is a different, real thing: the
            transport never said which door it used. Counting it as SMS invents a channel nobody recorded.
          </Rule>
          <Rule tint="peach" label="The ledger’s own word stays reachable">
            A channel this screen has no band for collapses into <span className="font-semibold text-text-1">Other</span>,
            which would bury the only clue about what the transport actually wrote. The badge keeps the raw
            cell one hover away, and a row that names two channels — <code>sms+email</code> — is one telling
            counted in both bands.
          </Rule>
          <Rule tint="blue" label="A date ahead of the clock is not this week">
            The server’s clock and the browser’s are never the same clock, so a minute of drift is forgiven
            and reads as just now. Anything further ahead is a wrong date, not this week’s news: it is not
            counted in the seven days, and the row says <span className="font-semibold text-text-1">dated
            ahead</span> rather than flattering it as the freshest telling on the screen.
          </Rule>
          <Rule tint="mint" label="The words behind a telling: three answers">
            <span className="font-semibold text-text-1">Still current</span> — the words behind this telling
            are the words the situation still sends.{' '}
            <span className="font-semibold text-text-1">Changed since</span> — a correction would start here.{' '}
            <span className="font-semibold text-text-1">Not recorded</span> — and that one is never faked:
            read as unchanged the platform apologises to nobody, read as changed it apologises to everybody.
            Neither is a fact, so the page prints neither. The fingerprint is a hash and never a body; a body
            in a ledger is a leak waiting for a screenshot.
          </Rule>
          <Rule tint="mint" label="The headline counts what you are looking at">
            The search box and the wording filter are part of the same set as the hero: it counts the{' '}
            <span className="font-semibold text-text-1">filtered</span> rows, and the line under the number
            says which set it is. A headline that kept describing rows the reader had just filtered away
            would be a number about nothing.
          </Rule>
          <Rule tint="peach" label="A bundle names its situation, not its items">
            One obligation message can carry several owed items, and the ledger keeps a single row with the
            situation that said it and a date — not the list. Which obligations that message carried lives on
            the thread’s own house, <code>comm_bindings</code>, one row per item with its own state.
          </Rule>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          WHERE THE LANE KEEPS ITS RECORD. Seven houses, found where each one
          lives now and counted on this read, and the argument for why one
          send leaves a mark in two of them.
          ───────────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <FileSpreadsheet size={14} className={cn('shrink-0', TINT_FG.mint)} />
          Where the lane keeps its record
        </h2>
        <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
          Seven houses, each in an <em className="not-italic text-text-2">ASA Data — …</em> book reached by its
          declared pointer, never by a tab name. Where Postgres keeps a book&apos;s record, the Google sheet is
          only its backup copy. The rows are counted live on every read, the copy with every kept edit laid,
          so they move as the lane works.
        </p>
        <Card padded={false} className="overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">House</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
                    Rows now
                  </th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">What one row is</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Book</th>
                </tr>
              </thead>
              <tbody>
                {(houses ?? []).map((h) => (
                  <tr key={h.id} className="border-b border-border align-top last:border-0">
                    <td className="py-2 pl-4 pr-3 font-mono text-[12px] text-text-1">{h.id}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-stat text-[12.5px] text-text-1"
                      title={h.rows === null ? h.why : undefined}>
                      {h.rows === null ? '—' : h.rows.toLocaleString('en-US')}
                    </td>
                    <td className="py-2 pr-3 text-[12.5px] leading-[1.45] text-text-2">
                      {HOUSE_WHAT[h.id] ?? ''}
                      {h.id === LEDGER_HOUSE && (
                        <span className="mt-1 block text-[11.5px] text-text-3">
                          The trail above read{' '}
                          <span className="font-stat text-text-1">{blind ? '—' : deliveries.length}</span>{' '}
                          {blind ? 'rows from it' : `row${deliveries.length === 1 ? '' : 's'} from it`} — newest
                          first.
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-[11.5px] leading-[1.45] text-text-2">
                      {h.name || <span className="text-text-3">not found{h.why ? ` — ${h.why}` : ''}</span>}
                      {h.name && (
                        <span className="mt-0.5 block text-[10.5px] text-text-3">
                          {h.record ? 'Postgres keeps the record · the sheet is a copy' : 'read from its sheet copy'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {houses === null && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-[12px] text-text-3">
                      {loading ? 'Finding the houses…' : 'The houses did not come back with the trail — unread, not empty.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="mt-3">
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            <span className="font-semibold text-text-1">Why two houses record one send.</span> The attempt is
            the <em className="not-italic text-text-1">evidence</em> — it carries the provider’s receipt,
            which is the only proof a message left the building. The observation is the{' '}
            <em className="not-italic text-text-1">story</em> — what happened, in the order it happened,
            including the things that produced no attempt at all. They are not duplicates of each other
            {attemptsNow !== null && observationsNow !== null
              ? <>: right now {attemptsNow.toLocaleString('en-US')} attempts against{' '}
                  {observationsNow.toLocaleString('en-US')} observations</>
              : null}
            , because most of what happens to a thread never becomes a message. And when the evidence row is
            lost, the receipt stays mirrored on the thread, so the proof of a real send survives in one more
            place than the house that holds it.
          </p>
        </Card>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          WHY A QUIET TRAIL IS USUALLY NOT A FAULT. The lane paces itself,
          and the pace is the first thing somebody blames the screen for.
          ───────────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <Clock size={14} className={cn('shrink-0', TINT_FG.amber)} />
          Why the trail can look still
        </h2>
        <Card>
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            A day with nothing new on it is usually the lane{' '}
            <span className="font-semibold text-text-1">pacing itself</span>, not a lane that broke. A thread
            that has already asked waits out its gap before it asks again, and every thread carries the
            sentence that explains its own silence — in the reading this page was designed against, all 64 of
            them said the same one:{' '}
            <em className="not-italic text-text-1">attempt 2 of 3 · gap: asked 17h ago; the test pace is 24h</em>.
            Those figures are an <span className="font-semibold text-text-1">illustration</span>: this screen
            reads the ledger, not the threads, so it cannot say what the gap is right now — the Rehearsal
            screen writes that sentence on every row it shows.
          </p>
          <p className="mt-2.5 text-[12.5px] leading-[1.55] text-text-2">
            The pace itself is a setting — <code>comm_test_gap_hours</code>, in the words book&apos;s Digest
            Settings (its current value is on the Catalogue) — and setting
            it to 0 releases the held threads on the next pass.{' '}
            <span className="font-semibold text-text-1">Nothing on this screen changes it.</span> It is named
            here so that a still trail is read as a paced lane rather than as a broken one, and so that
            whoever needs it knows where it lives.
          </p>
        </Card>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          WHERE EVERY FIGURE ON THIS PAGE CAME FROM.
          ───────────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-text-2">
          <Table2 size={14} className={cn('shrink-0', TINT_FG.lavender)} />
          Where every figure here comes from
        </h2>
        <p className="mb-3 max-w-[78ch] text-[12px] leading-[18px] text-text-3">
          Read live — on this page load, and again on every ring of the Smart Comms clock, a reconnected
          stream and a tab brought back into view. The hero and the trail cannot disagree because they are the
          same rows. The greyed lines are the ones nothing here measured; they are listed so that a silence is
          never mistaken for a count.
        </p>
        <Card padded={false} className="overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">What</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Count</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Where it came from</th>
                </tr>
              </thead>
              <tbody>
                <Source
                  what="Tellings in the last 7 days"
                  count={blind ? '—' : String(head.recent)}
                  from={filtering ? 'the filtered rows below, inside the 7-day window' : 'the rows below, inside the 7-day window'}
                  unread={blind}
                />
                <Source
                  what="Rows this page read"
                  count={blind ? '—' : String(deliveries.length)}
                  from="smartCommsHistory · newest 500 at most, rehearsals dropped at the door"
                  unread={blind}
                />
                <Source
                  what="Rows matching the filter"
                  count={blind ? '—' : String(shown.length)}
                  from={filtering ? 'the search box and the wording filter' : 'no filter is on — every row is shown'}
                  unread={blind}
                />
                <Source
                  what="SMS · e-mail · team · other · unknown"
                  count={blind
                    ? '—'
                    : `${head.counts.sms} · ${head.counts.email} · ${head.counts.team} · ${head.counts.other} · ${head.counts.unknown}`}
                  from="the ledger’s channel cell, split on + — a blank cell counts as unknown"
                  unread={blind}
                />
                <Source
                  what="Rehearsals in the window"
                  count="not measured"
                  from="the trail drops rows whose channel is exactly “rehearsal” — this is an absence, not a zero"
                  unread
                />
                <Source
                  what="Weekly digests in the window"
                  count={blind ? '—' : String(head.digests)}
                  from="rows whose person cell is the literal word “digest”"
                  unread={blind}
                />
                <Source
                  what="Words still current · changed · never recorded"
                  count={blind || wording === null
                    ? 'not carried'
                    : `${head.words.same} · ${head.words.changed} · ${head.words.unknown}`}
                  from={wording === null
                    ? 'the trail does not carry the wording fingerprint yet — unknown, not unchanged'
                    : 'the row’s fingerprint against what its situation would say now'}
                  unread={blind || wording === null}
                />
                <Source
                  what="The newest telling"
                  count={blind ? '—' : ago(head.lastAt)}
                  from="the newest stamp among the rows in view, with a minute of clock drift forgiven"
                  unread={blind}
                />
                <Source
                  what="Is test mode on?"
                  count={testMode === null ? 'not stated' : testMode.on ? 'on' : 'off'}
                  from="smartCommsHistory · held as absent, never as off"
                  unread={testMode === null}
                />
                <Source
                  what="Held by test mode"
                  count={held?.rows ? String(held.rows.length) : '—'}
                  from="smartCommsHistory · the newest rows of app.comm_rehearsal"
                  unread={!held?.rows}
                />
                <Source
                  what="Would fire now"
                  count={previewDenied ? 'admin-only' : dueAt ? String(due.length) : '—'}
                  from="smartCommsPreview · enabled date-driven situations only"
                  unread={previewDenied || !dueAt}
                />
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
