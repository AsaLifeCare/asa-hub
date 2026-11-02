// WORDS — what we would say.
// This page exists to change the messages the situations hold, and the explanatory mockups come WITH the app…
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, FlaskConical, MessageSquare, Moon, Pencil,
  RefreshCw, Signature, type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { TINT_BG, TINT_FG, heroBand, type ExtendedTintName } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { readSlice } from '@/lib/snapshotClient'
import { gasAction } from '@/features/hiring/shared'
import { fetchAlerts } from '@/lib/hiringAlerts'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

// ------------------------------------------------------------------ the shapes the four doors answer with…

/** A situation is the spreadsheet row it came from: every cell is a string. */
type Sit = Record<string, string> & { id: string }

type Binding = {
  demand_id: string; req_id: string; state: string
  expires: string; days_left: string; band: string; binding_state: string
}

/** One thread the obligations lane planned — CommRecord.gs wrote every cell. */
type Intent = {
  intent_key: string; person_key: string; person_name: string
  purpose: string; state: string; worst: string
  dial: string; verdict: string; reasons: string
  carried: string; deferred: string; open_count: string
  planned_at: string
  attempts?: string; last_asked_at?: string
  test_attempts?: string; test_last_asked_at?: string; test_mode?: string
  channel?: string; reply_token?: string
  items?: Binding[]
}

/** Only the fields this page reads, of the row comm_when.py emits. */
type WhenRow = {
  person_key: string; name: string; state: string
  window_from: string; window_to: string; moment_at: string
  shift_at: string; shift_code: string; house: string
  only_by_this_rule: boolean; why: string
}

type TestMode = { on?: boolean; explicit?: boolean; sms?: string[]; emails?: string[]; dropped?: string[] }
type AlertRow = { key: string; value: string; note: string; default_value: string; group: string }

// ------------------------------------------------------------------ the constants this page only ever SAYS OUT…

// THE SITUATION THE OBLIGATIONS LANE SENDS UNDER (SmartComms.gs, SMART_EXTRA_SITUATIONS_SEED).
const BUNDLE_ID = 'compliance_bundle'

// The shipped fallback for {sender} when a situation's own cell is empty (SmartComms.gs, SMART_SENDER_DEFAULT).
const SENDER_FALLBACK = 'the admin team from ASA LifeCare'

// What that constant used to read.
const SENDER_WAS = 'the admin team from A Brighter Dawn'
const SENDER_WRONG_COUNT = 9

// The one platform-wide quiet pair every caregiver is held by today (CommPolicy.gs, quiet_from / quiet_to).
const QUIET_FROM = '21:00'
const QUIET_TO = '08:00'

// The rule, carried as a number only so it can be said: fifteen minutes before a shift a person can take a message.
const OPERATOR_POINT_MIN = 15

// THE MORNING THE BLANKET WINDOW GETS WRONG, measured once by the reachability study (server/comm_cortex.py) over…
const NIGHTS_ENDING_0800 = 58
const NIGHTS_ENDING_0700 = 39

// AND THE OTHER HALF OF "WHO IT IS WRITING TO": when nobody said who they were, the number can often say it.
const HOTLINE_ROWS_NO_NAME = 80
const HOTLINE_NAMED_BY_PHONE = 32
const HOTLINE_REFUSED_AS_SHARED = 3
const HOTLINE_ON_A_COMPANY_LINE = 171

// ------------------------------------------------------------------ the clock — read off the stamp, not through…

// THE HOURS HERE ARE THE ESTATE'S, NOT THE READER'S — the same law the When page keeps.
function hhmm(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : ''
}

// ------------------------------------------------------------------ the renderer — the same substitution Apps…

// `{placeholder}` substitution, character for character as `smartRender_` does it (SmartComms.gs): an unknown or…
function fill(tpl: string, vars: Record<string, string>): string {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k: string) =>
    vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : m)
}

/** The placeholders a render left standing, in the order they appear. */
function leftovers(text: string): string[] {
  const out: string[] = []
  for (const m of String(text || '').matchAll(/\{(\w+)\}/g)) {
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

// THE ONE-LINE SUMMARY THE BUNDLE'S `{credential}` CARRIES, copied from `commDispatchSummary_` (CommDispatch.gs) so…
function itemSummary(names: string[]): string {
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

// ------------------------------------------------------------------ the states a row of the sheet can be in…

type RowState = 'sent' | 'rehearsed' | 'held' | 'planned'

const ROW_STATES: RowState[] = ['sent', 'rehearsed', 'held', 'planned']

const ROW_STATE: Record<RowState, { label: string; tint: ExtendedTintName; note: string }> = {
  sent: {
    label: 'sent', tint: 'blue',
    note: 'An attempt was made outside a test pass — this one reached a person.',
  },
  rehearsed: {
    label: 'rehearsed', tint: 'amber',
    note: 'An attempt was made during a test pass. It was redirected, so it reached the tester and never the person named on the row.',
  },
  held: {
    label: 'held', tint: 'lavender',
    note: 'The policy is holding it. Nothing was rendered and nothing was sent — the reason beside it says which rule.',
  },
  planned: {
    label: 'planned', tint: 'slate',
    note: 'Worked out and written down, not yet asked. The lane is at record, or the pass has not come round.',
  },
}

function stateOf(r: Intent): RowState {
  const asked = Number(r.attempts || 0) > 0 || Number(r.test_attempts || 0) > 0
  if (asked) return r.test_mode === 'yes' ? 'rehearsed' : 'sent'
  if (r.verdict === 'held' || r.verdict === 'blocked') return 'held'
  return 'planned'
}

/** The hour the row carries, if any — the ask first, then the plan. */
function rowWhen(r: Intent): string {
  return hhmm(r.test_last_asked_at || '') || hhmm(r.last_asked_at || '') || hhmm(r.planned_at || '')
}

// ------------------------------------------------------------------ small pieces, borrowed from the pages either…

/** A word taken literally from a book cell or a file — never prose. */
function Cell({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] border border-border bg-surface-2 px-1 py-px font-mono text-[11px] text-text-1">
      {children}
    </code>
  )
}

/** A section head, in the mockup's own order: the tag, the title, the reason. */
function Reading({ tag, title, children }: { tag: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-4 border-t border-border pt-7">
      <span className="inline-block rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">
        {tag}
      </span>
      <h2 className="mt-2.5 font-display text-[19px] font-bold leading-6 tracking-[-0.01em] text-text-1">{title}</h2>
      <div className="mt-1.5 max-w-[72ch] space-y-1.5 text-[13px] leading-[19px] text-text-2">{children}</div>
    </div>
  )
}

/** A card that argues one point, the way the mockup's pair of cards do. */
function Point({ title, icon: Icon, tint, children }: {
  title: string; icon?: LucideIcon; tint?: TintName; children: ReactNode
}) {
  return (
    <Card padded={false} className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        {Icon && (
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full', TINT_BG[tint ?? 'blue'], TINT_FG[tint ?? 'blue'])}>
            <Icon size={13} />
          </span>
        )}
        <h3 className="font-display text-[14px] font-bold leading-5 text-text-1">{title}</h3>
      </div>
      <div className="space-y-2 text-[12.5px] leading-[18px] text-text-2">{children}</div>
    </Card>
  )
}

/** A rendered message body, with any surviving placeholder drawn as one. */
function Body({ text }: { text: string }) {
  const parts = String(text || '').split(/(\{\w+\})/g)
  return (
    <>
      {parts.map((p, i) =>
        /^\{\w+\}$/.test(p)
          ? (
            <mark
              key={i}
              title="This placeholder was not filled. It goes out exactly like this."
              className="rounded-[3px] bg-tint-peach px-1 font-mono text-[11px] text-tint-fg-peach"
            >
              {p}
            </mark>
          )
          : <span key={i}>{p}</span>,
      )}
    </>
  )
}

// A PHONE.
function Phone({ from, children, stamp }: { from: string; children: ReactNode; stamp?: ReactNode }) {
  return (
    <div className="rounded-[18px] bg-detail-hero p-3.5 pb-5 shadow-2">
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] text-white/40">
        <span>SMS</span>
        <span>▮▮▮</span>
      </div>
      <p
        className="mb-3 border-b border-white/10 pb-2.5 text-center text-[12px] text-white/75"
        title="The line every message on this platform is sent from — the platform resolves the provider line named “Automations”, and that exact name is what a caregiver sees."
      >
        {from}
      </p>
      <div className="space-y-2">{children}</div>
      {stamp && <p className="ml-1 mt-2.5 font-mono text-[9.5px] leading-[14px] text-white/40">{stamp}</p>}
    </div>
  )
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[94%] rounded-[16px] rounded-bl-[4px] bg-surface-3 px-3 py-2.5 text-[12.5px] leading-[18px] text-text-1">
      {children}
    </div>
  )
}

/** One line of the "why" list under a phone: a verdict, then the reason. */
function Why({ head, children }: { head: string; children: ReactNode }) {
  return (
    <p className="text-[12.5px] leading-[18px] text-text-2">
      <span className="font-semibold text-text-1">{head}</span> {children}
    </p>
  )
}

// ------------------------------------------------------------------ the page…

export default function SmartCommsWordsPage() {
  const [sits, setSits] = useState<Sit[] | null>(null)
  const [tab, setTab] = useState('')
  const [creds, setCreds] = useState<Record<string, string> | null>(null)
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [rows, setRows] = useState<Intent[] | null>(null)
  const [dial, setDial] = useState('')
  const [boardNote, setBoardNote] = useState('')
  const [when, setWhen] = useState<WhenRow[] | null>(null)
  const [test, setTest] = useState<TestMode | null>(null)
  const [testWord, setTestWord] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [wordsErr, setWordsErr] = useState('')
  const [boardErr, setBoardErr] = useState('')
  const [picked, setPicked] = useState('')
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setWordsErr('')
    setBoardErr('')

    /* THE SITUATIONS — the same read the Desk makes. */
    try {
      const w = await gasAction<{
        situations?: Sit[]; tab?: string
        credentials?: Record<string, string>; placeholders?: string[]
      }>('smartCommsGet', {}, { timeoutMs: 60_000 })
      setSits(w?.situations ?? null)
      setTab(w?.tab ?? '')
      setCreds(w?.credentials ?? null)
      setPlaceholders(w?.placeholders ?? [])
    } catch (e) {
      setSits(null)
      setWordsErr(e instanceof Error ? e.message : String(e))
    }

    // THE REHEARSAL — who would be told, and every reason the planner reached.
    try {
      const b = await gasAction<{ rows?: Intent[]; dial?: string; note?: string }>(
        'commBoard', {}, { timeoutMs: 120_000 })
      setRows(b?.rows ?? null)
      setDial(b?.dial ?? '')
      setBoardNote(b?.note ?? '')
    } catch (e) {
      setRows(null)
      setBoardErr(e instanceof Error ? e.message : String(e))
    }

    // THE HOUR — from the slice, and from nowhere else.
    let people: WhenRow[] | null = null
    try { people = await readSlice<WhenRow>('commWhen') } catch { people = null }
    setWhen(people)

    // WHERE A PREVIEW GOES.
    try {
      const a = await fetchAlerts() as { rows?: AlertRow[]; test_mode?: TestMode }
      setTest(a?.test_mode ?? null)
      const raw = (a?.rows ?? []).find((r) => r.key === 'test_mode')
      setTestWord(raw ? String(raw.value ?? '').trim().toLowerCase() : '')
    } catch {
      setTest(null)
      setTestWord(null)
    }

    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // ---------------------------------------------------------------- the words this page renders from…

  const bundle = useMemo(
    () => (sits ?? []).find((s) => String(s.id) === BUNDLE_ID) ?? null,
    [sits],
  )

  /** The literal {sender} of the bundle: its own cell, or the shipped one. */
  const sender = String(bundle?.sender || '').trim() || SENDER_FALLBACK
  const senderIsOwn = !!String(bundle?.sender || '').trim()

  // Every distinct {sender} the book would send under, so a wrong one cannot hide in a row nobody opened.
  const senders = useMemo(() => {
    if (!sits) return null
    const seen = new Map<string, number>()
    for (const s of sits) {
      const v = String(s.sender || '').trim() || SENDER_FALLBACK
      seen.set(v, (seen.get(v) ?? 0) + 1)
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1])
  }, [sits])

  // A requirement id → the label a caregiver would recognise.
  const labelFor = useCallback((id: string): string => {
    const key = String(id || '').trim()
    if (!key) return ''
    const map = creds ?? {}
    return map[key] || map[key.toLowerCase()] || key
  }, [creds])

  // ---------------------------------------------------------------- the sheet…

  const live = useMemo(
    () => (rows ?? []).filter((r) => r.state !== 'superseded'),
    [rows],
  )

  const whenBy = useMemo(() => {
    const m = new Map<string, WhenRow>()
    for (const w of when ?? []) if (w.person_key) m.set(w.person_key, w)
    return m
  }, [when])

  // THE HOUR WAS NOT READ — which is NOT the same as "nobody works nights".
  const whenUnread = when === null || when.length === 0

  // One rendered row of the sheet — the render is this screen's, and the caption under the table says so.
  const sheet = useMemo(() => live.map((r) => {
    const open = (r.items ?? []).filter((b) => String(b.binding_state || 'open') === 'open')
    const items = open.length ? open : (r.items ?? [])
    const names = items.map((b) => labelFor(b.req_id || b.demand_id)).filter(Boolean)
    const state = stateOf(r)
    const first = String(r.person_name || '').trim().split(/\s+/)[0] || ''
    const vars: Record<string, string> = {
      first_name: first,
      name: String(r.person_name || ''),
      sender,
      credential: itemSummary(names),
      items: String(items.length || ''),
      token: String(r.reply_token || ''),
    }
    const tpl = String(bundle?.sms_text || '')
    return {
      r, state, items, names,
      // A held row was never rendered, and the sheet says exactly that rather than showing a body nobody composed.
      body: state === 'held' || !tpl ? '' : fill(tpl, vars),
    }
  }), [live, labelFor, sender, bundle])

  const counts = useMemo(() => {
    const c: Record<RowState, number> = { sent: 0, rehearsed: 0, held: 0, planned: 0 }
    for (const row of sheet) c[row.state]++
    return c
  }, [sheet])

  // THE PLACEHOLDERS THAT SURVIVED EVERY RENDER ON THIS SHEET.
  const standing = useMemo(() => {
    const seen = new Map<string, number>()
    for (const row of sheet) {
      for (const p of leftovers(row.body)) seen.set(p, (seen.get(p) ?? 0) + 1)
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1])
  }, [sheet])

  const shown = showAll ? sheet : sheet.slice(0, 12)

  // ---------------------------------------------------------------- the one person, twice…

  // WHOSE MESSAGE IS DRAWN.
  const defaultKey = useMemo(() => {
    // WITH NO SLICE THERE IS NO NIGHT WORKER TO FIND — not because there is none, but because nothing was read.
    const night = live.find((r) => whenBy.get(r.person_key)?.only_by_this_rule)
    return night?.person_key || live[0]?.person_key || ''
  }, [live, whenBy])

  const key = picked || defaultKey
  const one = useMemo(() => sheet.find((s) => s.r.person_key === key) ?? null, [sheet, key])
  const oneWhen = one ? whenBy.get(one.r.person_key) ?? null : null

  // The item that costs them something first: the soonest expiry, which is the most negative days_left.
  const worstItem = useMemo(() => {
    if (!one) return null
    let best: Binding | null = null
    let bestN = Number.POSITIVE_INFINITY
    for (const b of one.items) {
      const n = Number(b.days_left)
      if (!Number.isFinite(n)) continue
      if (n < bestN) { bestN = n; best = b }
    }
    return best ? { binding: best, days: bestN, label: labelFor(best.req_id || best.demand_id) } : null
  }, [one, labelFor])

  const firstName = String(one?.r.person_name || '').trim().split(/\s+/)[0] || ''
  const momentAt = hhmm(oneWhen?.moment_at || '')
  const shiftAt = hhmm(oneWhen?.shift_at || '')
  const nightWorker = !!oneWhen?.only_by_this_rule

  // The left-hand phone: the current template, rendered, exactly as it would go out today — down to the…
  const todayBody = one?.body || (one && bundle
    ? fill(String(bundle.sms_text || ''), {
      first_name: firstName,
      name: String(one.r.person_name || ''),
      sender,
      credential: itemSummary(one.names),
      items: String(one.items.length || ''),
      token: String(one.r.reply_token || ''),
    })
    : '')

  // ---------------------------------------------------------------- where a preview goes…

  const testKnown = test !== null && testWord !== null
  const toSheet = testWord === 'sheet' || testWord === 'rehearsal' || testWord === 'paper'
  const testOn = test?.on === true
  const testOff = test?.on === false && !toSheet
  const testSms = (test?.sms ?? []).filter(Boolean).map(formatPhoneDisplay)
  const testMails = (test?.emails ?? []).filter(Boolean)

  const gap = loading ? '…' : '—'
  const boardKnown = rows !== null
  const total = Math.max(1, sheet.length)

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader
          title="Words"
          subtitle="What we would say — every planned message as it really is, and one person’s message before and after."
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

      {/* THE HEADLINE. The big number is how many messages the lane would say
          right now; the bar is what state each of them is in; the paragraph is
          the mockup's own lede, because the argument is the page. */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Messages the lane would say
            </p>
            <p className="font-stat text-[60px] leading-none text-white">
              {boardKnown ? sheet.length : gap}
            </p>
            <p className="mt-1 text-[12px] text-white/60">
              {boardKnown
                ? <>one per person, carrying everything they owe</>
                : loading
                  ? <>reading the rehearsal…</>
                  : <>the rehearsal did not come back — nothing here is a measured zero</>}
            </p>
            <p className="mt-4 text-[12.5px] leading-[1.55] text-white/80">
              <span className="font-stat text-[17px] text-white">
                {boardKnown ? counts.rehearsed : gap}
              </span>{' '}
              of them have already been rehearsed at least once, and a rehearsal is not a quiet
              thing — every one of those went to the tester’s line.
            </p>
          </div>

          <div className="min-w-0 sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              What we would say
            </p>
            <p className="text-[13px] leading-[1.6] text-white/85">
              Two readings. The first is the plan that holds every message this platform would
              send, kept in Postgres, so a rehearsal is{' '}
              <span className="font-stat text-white">{boardKnown ? sheet.length : gap}</span> rows you
              read instead of{' '}
              <span className="font-stat text-white">{boardKnown ? sheet.length : gap}</span> texts to
              one group. The second is the same message before and after it learns anything about the
              person receiving it.
            </p>
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {boardKnown && ROW_STATES.map((s) => (
                counts[s] ? (
                  <span
                    key={s}
                    title={`${counts[s]} ${ROW_STATE[s].label} — ${ROW_STATE[s].note}`}
                    style={{ width: `${(counts[s] / total) * 100}%`, background: heroBand(ROW_STATE[s].tint) }}
                  />
                ) : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-white/70">
              {ROW_STATES.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5" title={ROW_STATE[s].note}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: heroBand(ROW_STATE[s].tint) }} />
                  {ROW_STATE[s].label} <span className="font-stat text-white">{boardKnown ? counts[s] : gap}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══ THE TWO THINGS TO READ BEFORE ANY PREVIEW ══════════════════
          Both are here because both have already cost something: a message
          went out signed with the wrong company, and a rehearsal went into a
          chat full of colleagues. Neither belongs in a tooltip. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Point title="The name it goes out under" icon={Signature} tint="peach">
          <p>
            Every message this lane sends signs itself with one phrase, and the phrase is a cell.
            The obligations bundle currently signs{' '}
            {sits === null
              ? <span className="text-text-3">— the situations did not answer, so this screen will not guess</span>
              : <strong className="text-text-1">“{sender}”</strong>}
            {sits !== null && (
              <>
                {' '}— {senderIsOwn
                  ? <>its own <Cell>sender</Cell> cell</>
                  : <>the shipped fallback, because that row’s <Cell>sender</Cell> cell is empty</>}.
              </>
            )}
          </p>
          <p>
            <span className="font-semibold text-text-1">{SENDER_WRONG_COUNT} messages went out signed
            with the wrong company.</span> The shipped constant read{' '}
            <em className="not-italic text-text-1">“{SENDER_WAS}”</em>. It is corrected in the code —
            and a correction in code only takes effect on a publish, which is why the live cell is
            printed above rather than the constant.
          </p>
          {senders && senders.length > 1 && (
            <p>
              The situations would send under{' '}
              <strong className="text-text-1">{senders.length} different signatures</strong>:{' '}
              {senders.map(([v, n], i) => (
                <span key={v}>
                  {i > 0 && ' · '}
                  <span className="text-text-1">“{v}”</span>
                  <span className="text-text-3"> ×{n}</span>
                </span>
              ))}. One of them being wrong is invisible in a template and obvious here.
            </p>
          )}
          <p className="text-text-3">
            The line itself is separate: every text leaves from the provider line named{' '}
            <Cell>Automations</Cell>, which is what the phone shows above the first bubble — the
            signature is inside the words, and the two are edited in different places.
          </p>
        </Point>

        <Point title="Where a preview goes in test mode" icon={FlaskConical} tint="pink">
          {!testKnown ? (
            <p className="text-text-3">
              The test position did not come back. This screen will not say where a preview goes, and
              it will certainly not say “test mode is off”.
            </p>
          ) : toSheet || testOn ? (
            <>
              <p>
                <span className="font-semibold text-text-1">Test mode is on{toSheet ? <> (<Cell>{testWord}</Cell>)</> : null}.</span>{' '}
                Every message is stopped at the transport door and kept in Postgres instead of being
                handed to a provider — a row of the rehearsal log (<Cell>app.comm_rehearsal</Cell>) and of
                the mock outbox (<Cell>app.comm_mock</Cell>). Nothing is redirected to the testers
                {testSms.length || testMails.length
                  ? <> ({[...testSms, ...testMails].join(', ')} are only named on the rows)</>
                  : null}
                , so nothing in this position can reach anybody.
              </p>
              <p>
                It is the position that answers the group problem, and it is the reason this page
                exists: the rehearsal becomes rows somebody reads, not texts into one chat.
              </p>
            </>
          ) : testOff ? (
            <>
              <p>
                <span className="font-semibold text-text-1">Test mode is off.</span> A message sent
                from this lane reaches the person named on the row, at the number on their record.
              </p>
              <p>
                Which makes the rendered line below the thing to read carefully rather than the thing
                to skim: it is what a caregiver receives.
              </p>
            </>
          ) : (
            <p className="text-text-3">
              The test cell reads <Cell>{testWord || '(empty)'}</Cell> and the resolved state did not
              come back. Unknown, not off.
            </p>
          )}

          {/* THE SENTENCE THAT STAYS UP WHATEVER THE POSITION READS. This
              has bitten once already, and a fact that only appears in
              one of four branches is a fact somebody meets again by accident. */}
          <p className="border-t border-border pt-2 text-text-2">
            <span className="font-semibold text-text-1">The tester number is a GROUP CHAT.</span>{' '}
            {testSms.length
              ? <>It is <strong className="text-text-1">{testSms.join(' and ')}</strong>, and everybody
                in that chat receives everything sent to it.</>
              : <>The tester list did not come back, so the number is not printed here — the fact is,
                because it does not depend on the read.</>}{' '}
            Test mode sends nothing there any more, but a message tried on that phone is never private:
            it greets a different person by name, in front of colleagues. That is the whole reason the
            words are read on a screen instead of tried on a phone.
          </p>
        </Point>
      </div>

      {/* ═══════════════════ READING 1 · THE PLAN ═══════════════════ */}
      <div className="mt-7">
        <Reading tag="Reading 1 · the plan" title="Every planned message">
          <p>
            One row per message, whether it was delivered or only rehearsed. The names, the thread
            references and the reasons below are real rows read from the platform; the message text is
            what the current words would render for them.
          </p>
        </Reading>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2 px-3 py-2 font-mono text-[11.5px] text-text-2">
          <span className="text-text-1">Postgres</span>
          <span>· plan <span className="text-text-1">comm_intents</span></span>
          <span>· words <span className="text-text-1">{tab ? 'the situations' : '—'}</span></span>
          <span>· {boardKnown ? `${sheet.length} rows` : 'rows unread'}</span>
          {dial ? <span>· dial <span className="text-text-1">{dial}</span></span> : null}
        </div>

        {loading && rows === null ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : !boardKnown ? (
          <div className="p-4">
            <p className="text-[12.5px] leading-[18px] text-text-2">
              <AlertTriangle size={13} className="mr-1 inline text-tint-fg-peach" />
              The rehearsal did not answer{boardErr ? <> — <span className="text-text-3">{boardErr}</span></> : null}. There is
              no table here, and there is no zero here either: what the lane would say is unread.
            </p>
          </div>
        ) : !sheet.length ? (
          <EmptyState
            title="No thread on the board"
            body={boardNote || 'At off this is correct — nothing is planned. At record it means the sweep has not come round yet. The two look identical and mean opposite things.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse font-mono text-[11.5px]">
                <thead>
                  <tr>
                    {['', 'when', 'to', 'ch', 'state', 'what it would say', 'why it was allowed', 'ref'].map((h, i) => (
                      <th
                        key={i}
                        className="border-b border-r border-border bg-surface-2 px-2.5 py-1.5 text-left font-normal text-text-3 last:border-r-0"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, i) => {
                    const st = ROW_STATE[row.state]
                    const stamp = rowWhen(row.r)
                    return (
                      <tr key={row.r.intent_key} className={cn(i % 2 === 1 && 'bg-surface-2/50')}>
                        <td className="w-[38px] border-b border-r border-border bg-surface-2 px-2.5 py-1.5 text-right align-top text-text-3">
                          {i + 2}
                        </td>
                        <td className="whitespace-nowrap border-b border-r border-border px-2.5 py-1.5 align-top text-text-1">
                          {stamp || '—'}
                        </td>
                        <td className="whitespace-nowrap border-b border-r border-border px-2.5 py-1.5 align-top text-text-1">
                          <DragPerson
                            name={row.r.person_name}
                            id={row.r.person_key}
                            type="staff"
                            subtitle={row.r.purpose}
                            title="Drag this name onto the tracker, top left"
                          >
                            {row.r.person_name || row.r.person_key}
                          </DragPerson>
                        </td>
                        <td className="border-b border-r border-border px-2.5 py-1.5 align-top text-text-2">
                          {row.r.channel || '—'}
                        </td>
                        <td className="border-b border-r border-border px-2.5 py-1.5 align-top">
                          <span
                            title={st.note}
                            className={cn('inline-block whitespace-nowrap rounded-[4px] px-1.5 py-px text-[10.5px]', TINT_BG[st.tint], TINT_FG[st.tint])}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td className="max-w-[420px] border-b border-r border-border px-2.5 py-1.5 align-top leading-[16px]">
                          {row.body
                            ? <span className="text-text-1"><Body text={row.body} /></span>
                            : row.state === 'held'
                              ? <span className="text-text-3">— not rendered, nothing was sent</span>
                              : <span className="text-text-3">— the bundle’s words did not come back</span>}
                        </td>
                        <td className="min-w-[220px] border-b border-r border-border px-2.5 py-1.5 align-top leading-[16px] text-text-2">
                          {row.r.reasons || '—'}
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-2.5 py-1.5 align-top text-text-1">
                          {row.r.reply_token || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {sheet.length > 12 && (
              <div className="border-t border-border px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[11.5px] font-semibold text-primary hover:underline"
                >
                  {showAll ? 'Show the first 12' : `Show all ${sheet.length} rows`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-2.5 max-w-[80ch] text-[11.5px] leading-[17px] text-text-3">
        <span className="font-semibold text-text-2">The “what it would say” column is rendered here,
        by this screen.</span> It fills the bundle situation’s own{' '}
        <Cell>sms_text</Cell> with this person’s first name, the items they owe and their reply
        token, using the same substitution the platform performs — an unfilled placeholder is left
        standing and drawn as one, because that is exactly how it would go out. It is NOT a copy of
        anything that was sent: what a test pass held is kept in Postgres
        (<Cell>app.comm_rehearsal</Cell>), and this screen does not read it.
      </p>

      {standing.length > 0 && (
        <p className="mt-2 max-w-[80ch] text-[11.5px] leading-[17px] text-text-2">
          <AlertTriangle size={12} className="mr-1 inline text-tint-fg-peach" />
          <span className="font-semibold text-text-1">
            {standing.length === 1 ? 'One placeholder' : `${standing.length} placeholders`} did not
            get filled
          </span>{' '}
          and would go out exactly as written:{' '}
          {standing.map(([p, n], i) => (
            <span key={p}>
              {i > 0 && ' · '}
              <Cell>{p}</Cell> <span className="text-text-3">on {n} {n === 1 ? 'row' : 'rows'}</span>
            </span>
          ))}
          . Substitution leaves an unknown or empty placeholder standing rather than blanking it, on
          purpose: “Hi {'{first_name}'}” is visibly broken and “Hi ,” looks like it was meant.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Point title="Why this fixes the group problem" icon={MessageSquare} tint="lavender">
          <p>
            In test mode every destination collapses onto one phone, and that phone is a group.{' '}
            {boardKnown ? <>{sheet.length} threads became {sheet.length} texts</> : <>Every thread became a text</>},
            each greeting a different person by name, in a chat real colleagues read. Kept as rows in
            Postgres, the same rehearsal reaches nobody.
          </p>
          <p className="text-text-3">
            That is not a flaw in the redirect. It is a thing nobody had written down: when every
            destination collapses onto one, the sending should collapse too.
          </p>
        </Point>
        <Point title="Why the text has to be here" icon={Pencil} tint="amber">
          <p>
            In the code the message is a template: <Cell>Hi {'{first_name}'}, this is {'{sender}'}…</Cell>.
            It looks fine. The wrong company name was invisible there and obvious once filled in. Only
            the rendered line shows what actually goes out.
          </p>
          {placeholders.length > 0 && (
            <p className="text-text-3">
              The placeholders a situation may use:{' '}
              {placeholders.map((p, i) => <span key={p}>{i > 0 && ' '}<Cell>{p}</Cell></span>)}. Anything
              else is left standing in the message.
            </p>
          )}
        </Point>
      </div>

      {/* ═══════════════════ READING 2 · THE MESSAGE ═════════════════ */}
      <div className="mt-8">
        <Reading tag="Reading 2 · the message" title="The same person, twice">
          {one ? (
            <p>
              <strong className="text-text-1">{one.r.person_name}</strong> is real, and so is{' '}
              {oneWhen && (shiftAt || oneWhen.window_from)
                ? (
                  <>
                    the hour: the roster has their next shift starting at{' '}
                    <strong className="text-text-1">{shiftAt || '—'}</strong>
                    {oneWhen.house ? <> at {oneWhen.house}</> : null}
                    {nightWorker ? <>, which the platform-wide window calls quiet. They work nights.</> : <>.</>}
                  </>
                )
                : whenUnread
                  ? (
                    <>
                      everything on their row — except the hour, because the{' '}
                      <Cell>commWhen</Cell> file did not answer AT ALL on this read. Nobody&apos;s hour was
                      looked up, theirs included. It is not drawn, and it is not guessed.
                    </>
                  )
                  : (
                    <>
                      everything on their row — except the hour: the <Cell>commWhen</Cell> file answered,
                      and this person is not in it. It is not drawn, and it is not guessed.
                    </>
                  )}{' '}
              On the left is what the platform sends them today. On the right is what it would send if
              the message knew anything at all.
            </p>
          ) : (
            <p>
              The same message before and after it knows anything about the person receiving it. No
              thread is drawn here yet, because the rehearsal has not answered.
            </p>
          )}
          <p className="text-text-3">
            The example this was written from is a night worker whose PsiAnywhere punch record has her
            working 00:00 to 08:45 and again 14:00 to 21:00 — kept here as the worked example it is,
            not as a live reading. That record is closed, and it is on the{' '}
            <Link to="/app/smartcomms/punches" className="font-semibold text-primary hover:underline">Punches</Link>{' '}
            page.
          </p>
        </Reading>
      </div>

      {/* THE MOON IS MISSING FOR A REASON, AND THE REASON IS SAID.
          Without this line an unread slice draws exactly like a board with no
          night workers on it — and the moon is the argument the feature is
          built on. */}
      {whenUnread && sheet.length > 0 && (
        <p className="mb-3 text-[12px] leading-[1.55] text-text-3">
          <strong className="text-text-2">No hour was read for anybody on this board.</strong> The{' '}
          <Cell>commWhen</Cell> file did not answer this reader, so no moon is drawn beside any name below — that is
          a reading nobody took, not a board without night workers, and the person the panel opens on was picked as
          the first thread rather than as the one the rule is about.
        </p>
      )}

      {/* WHOSE MESSAGE IS DRAWN. A picker, not a filter: it changes which one
          person the two phones below are about, and writes nothing. */}
      {sheet.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] font-semibold text-text-3">Draw it for</span>
          {sheet.slice(0, 10).map((row) => {
            const on = row.r.person_key === key
            return (
              <button
                key={row.r.intent_key}
                type="button"
                onClick={() => setPicked(row.r.person_key)}
                title={whenUnread
                  ? 'No hour was read for anybody on this board — the commWhen file did not answer.'
                  : whenBy.get(row.r.person_key)?.only_by_this_rule
                    ? 'Their only reachable minute is inside the blanket quiet pair.'
                    : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[11.5px] font-semibold transition-colors',
                  on ? 'border-border-strong bg-surface-2 text-text-1' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                )}
              >
                <Avatar name={row.r.person_name || row.r.person_key} size="xs" />
                {whenBy.get(row.r.person_key)?.only_by_this_rule && <Moon size={11} className="text-tint-fg-lavender" />}
                {row.r.person_name || row.r.person_key}
              </button>
            )
          })}
          {sheet.length > 10 && (
            <span className="text-[11px] text-text-3">
              (the first 10 of {sheet.length} — the whole set is the table above)
            </span>
          )}
        </div>
      )}

      {one ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ── TODAY ─────────────────────────────────────────────── */}
          <div>
            <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-tint-fg-pink">
              Today · one template for everybody
            </p>
            <Phone
              from="ASA — Automations"
              stamp={
                <>
                  delivered {QUIET_TO} — the first minute the platform-wide window opens
                  {nightWorker ? ', and the hour a night worker has just gone to sleep' : ''}
                </>
              }
            >
              <Bubble>
                {todayBody
                  ? <Body text={todayBody} />
                  : <span className="text-text-3">The bundle’s words did not come back, so nothing is drawn here.</span>}
              </Bubble>
            </Phone>
            <div className="mt-3.5 space-y-1.5">
              <Why head="Wrong company.">
                A shipped constant nobody had read in months. It signed{' '}
                <em className="not-italic">“{SENDER_WAS}”</em> on {SENDER_WRONG_COUNT} real messages;
                the cell above this bubble is what it signs now.
              </Why>
              <Why head="Wrong hour.">
                {QUIET_TO} is where the blanket quiet pair ({QUIET_FROM}–{QUIET_TO}) lets go, and the
                lane writes at the first minute it may. For a night worker that is minutes after a
                shift ended. They are asleep.
              </Why>
              <Why head="Wrong shape.">
                {one.names.length > 1
                  ? <>{one.names.length} items in one breath, none of them ranked</>
                  : <>Every open item in one breath, none of them ranked</>}
                {worstItem && Number.isFinite(worstItem.days)
                  ? <> — {worstItem.days < 0
                    ? <>one of them expired {Math.abs(Math.round(worstItem.days))} days ago</>
                    : <>the soonest is {Math.round(worstItem.days)} days away</>} and the rest are not
                    — read as if they were the same thing.</>
                  : <>, read as if they were the same thing.</>}
              </Why>
              <Why head="No memory.">
                It does not know what it said to them yesterday, or what they answered.
              </Why>
            </div>
          </div>

          {/* ── WITH THE INTELLIGENCE ─────────────────────────────── */}
          <div>
            <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-tint-fg-mint">
              With the intelligence
            </p>
            <Phone
              from="ASA — Automations"
              stamp={
                momentAt
                  ? <>queued {momentAt} — {OPERATOR_POINT_MIN} minutes before their shift{shiftAt ? ` at ${shiftAt}` : ''}</>
                  : <>the hour this person could take a message was not read, so no stamp is invented</>
              }
            >
              <Bubble>
                Hi {firstName || '{first_name}'} — the ASA LifeCare team. Sorry about the message
                yesterday: it went out signed with the wrong company name.
              </Bubble>
              <Bubble>
                One thing that needs you:{' '}
                <strong>
                  {worstItem?.label
                    ? <>your {worstItem.label}{worstItem.days < 0 ? ' expired' : ' is next'}</>
                    : 'the one item that costs you something first'}
                </strong>
                . The others on your file can wait and we will not chase them separately. Portal link,
                or just reply here. Ref {one.r.reply_token || '—'}
              </Bubble>
            </Phone>
            <div className="mt-3.5 space-y-1.5">
              <Why head="Right hour.">
                {shiftAt
                  ? <>Their shift starts at {shiftAt}. {OPERATOR_POINT_MIN} minutes before, they are up
                    and have their phone. </>
                  : <>{OPERATOR_POINT_MIN} minutes before a shift somebody is up and has their phone. </>}
                The platform’s blanket quiet hours would have refused to write at all —{' '}
                {shiftAt || '22:00'} is inside them — and would have waited until morning, when a
                night worker sleeps.
              </Why>
              <Why head="Right order.">
                One item named, the rest acknowledged and deferred, so the ask is answerable in one
                action.
              </Why>
              <Why head="It remembers.">
                The correction comes first, unprompted, because the platform knows what it said
                yesterday and knows it was wrong.
              </Why>
            </div>
          </div>
        </div>
      ) : boardKnown ? (
        <Card>
          <EmptyState
            title="No thread to draw"
            body="The board came back with nothing to say, so there is no person to draw this for."
          />
        </Card>
      ) : (
        <Card><Skeleton className="h-[220px] w-full" /></Card>
      )}

      {/* THE CALLOUT — the mockup's own, with each claim attached to the thing
          in this platform that carries it. */}
      <div className="mt-5 rounded-r-lg border-l-[3px] border-primary bg-surface p-4">
        <p className="max-w-[80ch] text-[12.5px] leading-[1.6] text-text-2">
          <strong className="text-text-1">Nothing above is invented except the wording on the
          right.</strong>{' '}
          The hours are in the PsiAnywhere punch record, the thread and its reference are live rows read
          from the rehearsal, the wrong company name is a constant that was shipped and is now
          corrected, and the {OPERATOR_POINT_MIN}-minutes-before rule is a standing one. What the
          platform cannot do yet is JOIN them.
        </p>
        <p className="mt-2 max-w-[80ch] text-[12.5px] leading-[1.6] text-text-2">
          <span className="font-semibold text-text-1">Which half is built, precisely.</span> The
          apology riding the front of the next message is real —{' '}
          <Cell>app/comm_repair.py</Cell> computes who holds words this platform would no longer say,
          and the render places the line ahead of the body so no second message is sent.
          The HOUR is the half that is not: the lane&apos;s policy holds one quiet pair for
          everybody, the Hub may only ever widen it and never narrow it, and the per-person windows
          the <Link to="/app/smartcomms/when" className="font-semibold text-primary hover:underline">When</Link>{' '}
          page reads are not consulted by the planner. The right-hand message above is composed by
          this screen to show the shape of the join. Nothing queues it, and nothing on this page can.
        </p>
      </div>

      {/* ═══════════ WHAT MAKES THE DIFFERENCE ══════════════════════ */}
      <div className="mt-8">
        <Reading tag="What makes the difference" title="Four things the message does not know">
          <p>Each one is a real gap, and each is being closed by something already running.</p>
        </Reading>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Point title="1 · Who it is writing to" tint="blue">
          <p>
            Night worker or day worker. Measured:{' '}
            <span className="font-stat text-text-1">{NIGHTS_ENDING_0800}</span> people finish an
            overnight shift at 08:00 and{' '}
            <span className="font-stat text-text-1">{NIGHTS_ENDING_0700}</span> at 07:00 — exactly
            when the platform decides the quiet hours are over and starts writing.
          </p>
          <p className="text-text-3">
            Those two figures are the reachability study’s (<Cell>server/comm_cortex.py</Cell>), read
            once over the roster. They are an illustration on this screen, not a count it took: the
            per-person windows this page reads live are on the When page.
          </p>
          <p>
            <span className="font-semibold text-text-1">And sometimes it does not know their name
            at all.</span> When a hotline call leaves no name — blank,{' '}
            <em className="not-italic">Undetermined</em>,{' '}
            <em className="not-italic">Not specified in transcript</em> — the platform now asks the
            number. <Cell>contactPhoneWho_</Cell> puts the caller ID to the People roster with the
            estate’s own key. Measured on the queue:{' '}
            <span className="font-stat text-text-1">{HOTLINE_ROWS_NO_NAME}</span> rows carry no
            usable name and the roster names{' '}
            <span className="font-stat text-text-1">{HOTLINE_NAMED_BY_PHONE}</span> of them.
          </p>
          <p>
            <span className="font-semibold text-text-1">A shared line names nobody.</span> Where more
            than one person on the roster holds the number, the answer is{' '}
            <Cell>shared</Cell>: it lists the candidates for a human to read and it may never be used
            as the name — <span className="font-stat text-text-1">{HOTLINE_REFUSED_AS_SHARED}</span>{' '}
            rows end there. The company lines are refused for the same reason and not the opposite
            one: <span className="font-stat text-text-1">{HOTLINE_ON_A_COMPANY_LINE}</span> of these
            calls arrived on a number many people call from, so a single roster row against it proves
            nothing.
          </p>
          <p className="text-text-3">
            It fills a blank and never overrides. A name the caller gave is returned before the
            roster is even opened, and every row records which it was — the person, the number, or
            nothing at all. A call-off named only by its caller ID is written down and{' '}
            <em className="not-italic">not</em> answered: a candidate is not who to text.
          </p>
        </Point>

        <Point title="2 · What they actually owe" tint="amber">
          <p>
            Six items is not six problems. One expired two years ago, one expires next month. The
            message lists them flat, so the reader cannot tell which one costs them their job this
            week.
          </p>
          <p className="text-text-3">
            {one && one.names.length
              ? <>Live, on the row drawn above: <span className="font-stat text-text-2">{one.names.length}</span>{' '}
                open {one.names.length === 1 ? 'item' : 'items'}, and the message names{' '}
                <span className="text-text-2">“{itemSummary(one.names)}”</span> — the first two and a
                count, which is what the template asks for.</>
              : <>The bands are on the row (<Cell>comm_bindings</Cell>) and the message does not use
                them: <Cell>{'{credential}'}</Cell> is the first two items and a count.</>}
          </p>
        </Point>

        <Point title="3 · Whether we already got it wrong" tint="peach">
          <p>
            Nothing stored what a message <em className="not-italic">said</em>. So when a constant was
            corrected, no query anywhere could name the people who got the old one. A column is being
            added for exactly this.
          </p>
          <p className="text-text-3">
            <span className="font-semibold text-text-2">Where it stands now:</span> the ledger carries{' '}
            <Cell>said</Cell> — the FINGERPRINT of the wording a telling was rendered from, not the
            words. It is enough to prove a message no longer matches what its situation would say
            today, which is what the{' '}
            <Link to="/app/smartcomms/activity" className="font-semibold text-primary hover:underline">Activity</Link>{' '}
            page draws, and every row written before the column existed has none and is marked
            unknown rather than unchanged.
          </p>
        </Point>

        <Point title="4 · Whether they already answered" tint="mint">
          <p>
            The reply machinery exists and works. What it cannot do is prove itself while every reply
            arrives from the tester’s own line — so nothing it learns reaches the next message yet.
          </p>
          <p className="text-text-3">
            A reply is read, qualified and shown on the{' '}
            <Link to="/app/smartcomms/replies" className="font-semibold text-primary hover:underline">Replies</Link>{' '}
            page marked as a rehearsal, and it settles nothing: the row is written with its awaiting
            list deliberately empty, so no verdict clicked there can reach a real person’s
            obligations.
          </p>
        </Point>
      </div>

      {/* ══ THE DOOR ════════════════════════════════════════════════
          The point is to change the messages the situations hold. The change
          is made at one door, the Desk; this page is a reader and points at it. */}
      <div className="mt-8">
        <Reading tag="Changing the words" title="One door — the Desk — and this page is not it">
          <p>
            The words live on the situations, and Postgres keeps their record; the Google sheet is only
            a backup copy, and a word typed there comes back with the daily check, not at once. One
            screen writes them: the Desk. This page reads them and renders them; it does not write
            them. A second door onto one truth is how two of them start disagreeing.
          </p>
          <p>
            One thing worth knowing before you change a sentence: saving is the only moment that ever
            holds both versions at once, so the save itself is what works out who is holding words
            this platform would no longer say. A detector running afterwards could only compare today
            against today.
          </p>
        </Reading>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/app/smartcomms/overview" aria-label="Edit the words on the Desk" title="Edit the words on the Desk"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <Pencil size={14} />
        </Link>
        <Link
          to="/app/smartcomms/overview"
          className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          Change the words on the Desk
        </Link>
      </div>

      {wordsErr && (
        <p className="mt-3 text-[12px] leading-[17px] text-text-3">
          <AlertTriangle size={12} className="mr-1 inline text-tint-fg-peach" />
          The situations did not answer: {wordsErr}. Every sentence above that needed it says so
          where it stands, and none of them printed a zero instead.
        </p>
      )}
    </div>
  )
}
