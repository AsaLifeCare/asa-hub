// REPLIES — the demand owner's desk (P4).
// A reply to a compliance message is read into a typed candidate by CommInbound.gs: which thread it answers (a…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, FlaskConical, MessageSquareReply, RefreshCw, Scale, Search, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { TINT_BG, TINT_FG, TINT_VAR, heroBand, type ExtendedTintName } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { gasAction } from '@/features/hiring/shared'
import { onLiveEvent } from '@/lib/snapshotClient'
import { fetchAlerts } from '@/lib/hiringAlerts'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'

type Contribution = {
  id: string; intent_key: string; person_key: string; person_name: string
  channel: string; message_id: string; received_at: string; text: string
  correlation: string; kind: string; claims: string; why: string
  settled_now: string; awaiting: string
  state: string; reason: string
  verdict: string; verdict_by: string; verdict_at: string; note: string
  // WRITTEN ONLY BY THE REHEARSAL PATH (CommInbound.gs), so all three are optional: a production row carries none…
  test_mode?: string; would_settle?: string; would_await?: string
  /** how many more of our lines the same message reached, folded into this card by the server */
  twins?: number
}

// THE MARK THE REHEARSAL PATH STAMPS ON THE REASON, matched rather than compared, because the sentence after it is…
const REHEARSAL_MARK = /^REHEARSAL \(test mode[^)]*\)\s*—\s*/

// String() around a cell the sheet owns: these columns are typed here but they arrive as whatever the spreadsheet…
const isRehearsal = (r: Contribution) => r.test_mode === 'yes' || REHEARSAL_MARK.test(String(r.why || ''))
const plainWhy = (r: Contribution) => String(r.why || '').replace(REHEARSAL_MARK, '')

const STATE: Record<string, { tint: ExtendedTintName; label: string }> = {
  awaiting_owner: { tint: 'amber', label: 'Awaiting your word' },
  needs_human: { tint: 'pink', label: 'Needs a human' },
  settled: { tint: 'mint', label: 'Settled' },
  dismissed: { tint: 'slate', label: 'Dismissed' },
  /* a refusal reads as its own thing, not as noise filed away */
  stopped: { tint: 'violet', label: 'Asked us to stop' },
}

// THE BANDS OF THE HEADLINE BAR, in the order a reply travels them.
const BANDS = ['awaiting_owner', 'needs_human', 'settled', 'dismissed', 'stopped'] as const
type Band = (typeof BANDS)[number]
const OPEN_BANDS: readonly Band[] = ['awaiting_owner', 'needs_human']
const KIND: Record<string, string> = {
  named: 'names the item(s)', whole: 'a plain yes to one item', declined: 'a plain no',
  unclear: 'unclear', stop: 'asked us to stop',
  // not a refusal and never filed as one: the line reached somebody who never applied, which is our bad data to fix…
  'wrong-number': 'the wrong number, not the person we meant',
}
const HOW: Record<string, string> = {
  token: 'quoted the reference', thread: 'the provider threaded it', 'sole-open': 'the only open thread',
  ambiguous: 'several threads open — not guessed', 'unknown-token': 'quoted a reference nobody has', none: 'nothing open',
  // what the rehearsal path writes when it never correlated at all: the row came from one of our own lines and…
  'own-line': 'from one of our own lines',
}

// THE TWO LEVELS, PER ROW.
type Step = { tint: ExtendedTintName; head: string; body: string }

function levelOne(r: Contribution): Step {
  const settled = (r.settled_now || '').trim()
  const awaiting = (r.awaiting || '').trim()
  if (isRehearsal(r)) {
    const would = (r.would_settle || '').trim()
    const held = (r.would_await || '').trim()
    // A REHEARSAL THAT NEVER CORRELATED NEVER REACHED THE QUALIFIER, and saying "it would have closed nothing"…
    if (r.correlation !== 'token') {
      return {
        tint: 'lavender', head: 'It never reached the estate',
        body: 'The words did not resolve to one open thread, so nothing was qualified — the reason is above. The row exists so the same message is not read again on the next pass.',
      }
    }
    return {
      tint: 'lavender', head: 'Ran, and wrote none of it down',
      body: `The qualifier read this against the estate exactly as it reads a real reply, and then acted on nothing: ${
        would ? `it would have closed ${would}` : 'it would have closed nothing'
      }, ${held ? `and sent ${held} to you` : 'and sent nothing to you'}. No binding moved and the thread is as open as it was.`,
    }
  }
  if (settled && awaiting) {
    return {
      tint: 'mint', head: 'Closed part of it on arrival',
      body: `${settled} closed itself — the estate's own record already agreed, so the qualifier on the binding is the record and not the reply. ${awaiting} it would not close.`,
    }
  }
  if (settled) {
    return {
      tint: 'mint', head: 'Closed on arrival',
      body: `${settled} — the person said so and requirement_states already agreed, so the machine closed it with the estate as the qualifier, never the reply.`,
    }
  }
  if (awaiting) {
    return {
      tint: 'amber', head: 'Refused to close',
      body: `${awaiting} — they say it is handled and the record does not agree, or holds nothing for it. Which of the two is stale is not a thing a message can settle, so the machine settled nothing.`,
    }
  }
  return {
    tint: 'slate', head: 'Nothing it could check',
    body: 'The words were not read as a claim about any open item, so there was nothing for the estate to agree or disagree with.',
  }
}

function levelTwo(r: Contribution, waits: boolean): Step {
  if (waits) {
    const last = r.verdict ? ` Last word: ${r.verdict.replace('_', ' ')} by ${r.verdict_by || 'somebody'}.` : ''
    if (isRehearsal(r)) {
      return {
        tint: 'lavender', head: 'On your desk, and it is a drill',
        body: `Nobody claimed anything here — the tester answered and the person did not — which is why it arrived as needs a human and not as your word to give.${last}`,
      }
    }
    if (r.state === 'needs_human') {
      return {
        tint: 'pink', head: 'A person has to read it first',
        body: `The ear could not turn this into an answer on its own${r.reason ? ` (${r.reason})` : ''}, so nothing was proposed and nothing waits on a yes.${last}`,
      }
    }
    return {
      tint: 'amber', head: 'Yours to say',
      body: `Settled closes exactly the items above with your address as the qualifier; keep asking leaves the thread open with the reply on the record; dismiss files it as noise.${last}`,
    }
  }
  if (r.verdict) {
    return {
      tint: r.verdict === 'settled' ? 'mint' : 'slate',
      head: `${r.verdict.replace('_', ' ')} by ${r.verdict_by || 'somebody'}`,
      body: `${when(r.verdict_at) || 'time not recorded'}${r.note ? ` · ${r.note}` : ''}`,
    }
  }
  if (r.state === 'settled') {
    return { tint: 'mint', head: 'Nobody had to', body: 'Level one closed it against the estate’s record. No person was asked, and none was needed.' }
  }
  if (r.state === 'stopped') {
    return {
      tint: 'violet', head: 'Not a verdict anyone gets to give',
      body: 'They asked us to stop, or the number was never theirs. The address is suppressed and the thread stopped asking — there is nothing here to settle.',
    }
  }
  if (!STATE[r.state]) {
    // the card already draws the raw state on a slate chip; guessing a sentence for it here would be the page…
    return {
      tint: 'slate', head: 'Not a state this desk knows',
      body: `The row reads ${r.state || 'nothing at all'}, which has no rule on this screen — it is shown, and nothing is assumed about it.`,
    }
  }
  return { tint: 'slate', head: 'Filed, not asked', body: 'Recorded so the same message is never read twice; there is nothing for a desk to do about it.' }
}

function Chip({ tint, children }: { tint: ExtendedTintName; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>{children}</span>
}

/** One level, drawn. The rail colour is the only thing separating the two. */
function LevelBlock({ label, step }: { label: string; step: Step }) {
  return (
    <div className="rounded-md bg-surface-2 px-2.5 py-2" style={{ borderLeft: `3px solid ${TINT_VAR[step.tint]}` }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">{label}</p>
      <p className="mt-0.5 text-[12px] font-semibold leading-[1.35] text-text-1">{step.head}</p>
      <p className="mt-0.5 break-words text-[11.5px] leading-[1.5] text-text-2">{step.body}</p>
    </div>
  )
}

function when(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// THE TRANSPORT'S OWN ANSWER, the shape Settings already reads.
type TestMode = { on?: boolean; sms?: string[]; emails?: string[] }

export default function SmartCommsRepliesPage() {
  const [rows, setRows] = useState<Contribution[] | null>(null)
  const [open, setOpen] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [test, setTest] = useState<TestMode | null>(null)

  // ONE SHARED READ, not a new door.
  useEffect(() => {
    let alive = true
    void (fetchAlerts() as Promise<{ test_mode?: TestMode }>)
      .then((a) => { if (alive) setTest(a?.test_mode ?? null) })
      .catch(() => { /* the rule stands without the addresses */ })
    return () => { alive = false }
  }, [])

  // `quiet` is a live re-read: nothing flashes, and a failure keeps what was last read on the screen
  const load = useCallback(async (everything: boolean, quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const r = await gasAction<{ rows?: Contribution[]; open?: number; total?: number }>('commReplies', { all: everything }, { timeoutMs: 120_000 })
      setRows(r.rows ?? []); setOpen(r.open ?? 0); setTotal(r.total ?? 0); setErr('')
    } catch (e) { if (!quiet) setErr(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { void load(all) }, [load, all])

  // ALWAYS CURRENT. A filed text or a captured e-mail rings the Smart Comms event and the page reads again; so does a
  // reconnected stream and a tab brought back into view. One read at a time, a ring during one read right after it.
  const reading = useRef(false)
  const again = useRef(false)
  useEffect(() => {
    const reread = () => {
      if (reading.current) { again.current = true; return }
      reading.current = true
      void load(all, true).finally(() => {
        reading.current = false
        if (again.current) { again.current = false; reread() }
      })
    }
    const seen = () => { if (document.visibilityState === 'visible') reread() }
    const offRing = onLiveEvent('smartcomms', reread)
    const offOpen = onLiveEvent('open', reread)
    document.addEventListener('visibilitychange', seen)
    return () => { offRing(); offOpen(); document.removeEventListener('visibilitychange', seen) }
  }, [load, all])

  const verdict = async (row: Contribution, v: 'settled' | 'not_settled' | 'dismissed') => {
    setBusy(row.id)
    try {
      const r = await gasAction<{ settled?: string[] }>('commContributionVerdict', { id: row.id, verdict: v }, { timeoutMs: 120_000 })
      const n = (r.settled ?? []).length
      toast({ type: 'success', title: v === 'settled' ? `Settled — ${n} obligation${n === 1 ? '' : 's'} closed with your name on it` : v === 'dismissed' ? 'Dismissed' : 'Kept asking' })
      await load(all)
    } catch (e) { toast({ type: 'danger', title: 'The verdict did not land', body: e instanceof Error ? e.message : String(e) }) }
    setBusy(null)
  }

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const base = rows ?? []
    return needle ? base.filter((r) => r.person_name.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle)) : base
  }, [rows, q])
  const searching = q.trim().length > 0

  // the headline's arithmetic — over the rows the cards below ACTUALLY render, the search box included.
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of list) c[r.state] = (c[r.state] ?? 0) + 1
    return c
  }, [list])
  const bands: readonly Band[] = all ? BANDS : OPEN_BANDS
  const inView = bands.reduce((n, k) => n + (counts[k] ?? 0), 0)

  // NOTHING HAS LOADED YET IS NOT THE SAME AS NOTHING IS THERE, and the legend below is the place that lies about…
  const ready = rows !== null

  // THE CARDS THE BAR DOES NOT DESCRIBE.
  const unbanded = Math.max(0, list.length - inView)

  // HOW MANY OF THESE ARE THE TESTER TALKING TO HERSELF.
  const rehearsals = useMemo(() => list.filter(isRehearsal).length, [list])

  // THE TRANSPORT'S STATE READS THREE WAYS, NEVER TWO: on, off, and not known.
  const testOn = test?.on === true
  const testOff = test?.on === false

  // NOT "filed", and the difference is not pedantry.
  const notWaiting = Math.max(0, total - open)

  // THE CAP, said out loud only when it bites.
  const LOADED_CAP = 500
  const loadable = all ? total : open
  const capped = (rows?.length ?? 0) >= LOADED_CAP && loadable > LOADED_CAP

  return (
    <div className="w-full pb-16">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
        <PageHeader title="Replies" subtitle="What people answered, read as a candidate — and what waits for your word."
          actions={
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setAll((v) => !v)}
                className={cn('inline-flex h-9 items-center rounded-md border border-border px-3 text-[12.5px] font-semibold transition-colors', all ? 'bg-surface-2 text-text-1' : 'bg-surface text-text-2 hover:bg-surface-2')}>
                {all ? 'Showing everything' : 'Show settled too'}
              </button>
              <PageSwitch />
              <button type="button" onClick={() => void load(all)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          } />
      </motion.div>

      {/* the headline, on the one dark surface this design system keeps */}
      <div className="mb-5 rounded-[16px] bg-detail-hero p-6 shadow-2">
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              Waiting for a person
            </p>
            <p className="font-stat text-[60px] leading-none text-white">{ready ? open : '…'}</p>
            <p className="mt-1 text-[12px] text-white/60">
              {ready ? <>of {total} repl{total === 1 ? 'y' : 'ies'} the ear has read in all</> : <>of — replies the ear has read in all</>}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
              {searching ? 'How the replies matching your search read' : 'How the replies in view read'}
            </p>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {ready && bands.map((k) => (
                counts[k] ? (
                  <span
                    key={k}
                    title={`${counts[k]} · ${STATE[k].label}`}
                    style={{ width: `${(counts[k] / Math.max(1, inView)) * 100}%`, background: heroBand(STATE[k].tint) }}
                  />
                ) : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/70">
              {bands.map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: heroBand(STATE[k].tint) }} />
                  {STATE[k].label} <span className="font-stat text-white">{ready ? counts[k] ?? 0 : '—'}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-white/80">
              Your word closes an obligation with your name as the qualifier — nothing on this page sends anything.
              {ready && rehearsals > 0 && (
                <> <span className="font-stat text-white">{rehearsals}</span> of the replies in view{' '}
                {rehearsals === 1 ? 'is a rehearsal' : 'are rehearsals'} — the tester's own line answering, settling
                nothing, each marked on its card. The house counts them like any other row, so the numbers here and on
                the left carry them too.</>
              )}
              {ready && unbanded > 0 && (
                <> <span className="font-stat text-white">{unbanded}</span> more in view{' '}
                {unbanded === 1 ? 'sits' : 'sit'} in a state this desk has no band for, so the bar leaves{' '}
                {unbanded === 1 ? 'it' : 'them'} out while the cards below still show{' '}
                {unbanded === 1 ? 'it' : 'them'}.</>
              )}
              {ready && capped && (
                <> The bar reads the newest <span className="font-stat text-white">{LOADED_CAP}</span> of{' '}
                <span className="font-stat text-white">{loadable}</span> — the desk loads that many at a time, so the count on
                the left is over all of them and the bar over the sample.</>
              )}
              {ready && !all && notWaiting > 0 && (
                <> <span className="font-stat text-white">{notWaiting}</span> more repl{notWaiting === 1 ? 'y is' : 'ies are'} out
                of view because {notWaiting === 1 ? 'it is' : 'they are'} not waiting for you — settled, dismissed, stopped, or in
                some other state this desk does not hold open. <em className="not-italic text-white">Show settled too</em> brings
                them back.</>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* THE TEST-MODE TRUTH, FIRST AND UNMISSABLE.
          A reader who does not know that every message is redirected will read
          a person's name on a card and believe that person wrote the words
          underneath it. Nobody did: the tester did. The banner is placed above
          everything the desk shows, and it is written to be true even when the
          transport's own state could not be read — the unknown case prints the
          rule that holds while the redirect is on, never "test mode is off". */}
      <Card padded={false} className="mb-4 overflow-hidden">
        <div className="p-4" style={{ borderLeft: `3px solid ${TINT_VAR[testOff ? 'mint' : 'amber']}` }}>
          <div className="flex items-start gap-2.5">
            <FlaskConical size={16} className="mt-0.5 shrink-0" style={{ color: TINT_VAR[testOff ? 'mint' : 'amber'] }} />
            <div className="min-w-0">
              <p className="font-display text-[14.5px] font-bold leading-[1.35] text-text-1">
                {testOn
                  ? 'Test mode is ON — not one reply below is the person’s own'
                  : testOff
                    ? 'Test mode is off — a reply below is the person answering, unless it is marked Rehearsal'
                    : 'While test mode is on, no reply here is taken as the person’s own'}
              </p>

              {!testOff && (
                <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-2">
                  While test mode is on the platform sends nothing — every message is a row in the mock outbox,
                  testers included — and a reply that arrives meanwhile is read as a rehearsal. A reply can still name the <strong className="text-text-1">thread</strong>{' '}
                  — the words end in <code className="text-[11.5px]">Ref</code> and a quoted reference matches exactly one open
                  thread — but it is never taken as evidence that <em className="not-italic text-text-1">the person</em> answered,
                  and this screen will not draw a line between a reply below and the name on its card.
                </p>
              )}

              <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-2">
                {testOff ? (
                  <>A row marked <strong className="text-text-1">Rehearsal</strong> was written during a test-mode pass and
                  stands exactly as it was left.</>
                ) : (
                  <>A tester's reply is not thrown away: it is read, qualified, and shown here marked{' '}
                  <strong className="text-text-1">Rehearsal</strong>.</>
                )}{' '}
                It <strong className="text-text-1">settles nothing</strong> — the row is written with its claimed items and its
                awaiting list deliberately empty, so no verdict clicked on this page can reach a real person's obligations, and
                what the qualifier would have done is recorded beside it instead. One that got as far as a thread lands as{' '}
                <em className="not-italic text-text-1">needs a human</em>, never as your word to give, because an owner
                settles what a person claimed and nobody claimed this; a stop word from the tester is recorded and never acted
                on, since the address it would suppress is where the whole platform's mail goes.
              </p>

              {!testOff && (
                <p className="mt-1.5 text-[12.5px] leading-[1.55] text-text-3">
                  <strong className="text-text-2">When test mode comes off:</strong> the messages reach the people, a reply is
                  the person's own and can be matched by their only open thread as well as by the reference, level one starts
                  closing bindings for real where the estate agrees, and a stop word acts. Until then the answer back cannot be
                  exercised end to end — what the rows below prove is the machinery, not the conversation.
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* THE TWO LEVELS, in the same words the cards use, so the strip on a
          card needs no legend. */}
      <Card className="mb-4">
        <div className="flex items-start gap-2.5">
          <Scale size={15} className="mt-0.5 shrink-0 text-text-3" />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            A reply is matched to <strong className="text-text-1">one</strong> thread — the quoted reference, or the only open
            one — and never guessed. What happens next has exactly two levels, and every card below says which one it is
            sitting at. What the message it answers actually <em className="not-italic text-text-1">said</em> is not kept
            anywhere yet, so this desk can show you an answer and never the question that drew it.
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-surface-2 px-3 py-2.5" style={{ borderLeft: `3px solid ${TINT_VAR.mint}` }}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Level one · the machine</p>
            <p className="mt-0.5 text-[12.5px] leading-[1.5] text-text-2">
              It may close exactly one thing: an item the estate's own record <strong className="text-text-1">already</strong>{' '}
              holds as met. The qualifier written on that binding is the record, never the reply — which is the only reason the
              compliance matrix is worth reading.
            </p>
          </div>
          <div className="rounded-md bg-surface-2 px-3 py-2.5" style={{ borderLeft: `3px solid ${TINT_VAR.amber}` }}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">Level two · you</p>
            <p className="mt-0.5 text-[12.5px] leading-[1.5] text-text-2">
              Where somebody says a thing is handled and the record disagrees, the machine{' '}
              <strong className="text-text-1">refuses to close it</strong> and hands it to you. The person may be right and the
              record stale, or the other way round, and a message is not the authority that can tell the two apart.
            </p>
          </div>
        </div>
      </Card>

      {err && (
        <Card className="mb-4 flex items-start gap-2.5 border-danger/30">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[12.5px] text-text-2">{err}</p>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-2">
        <span className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person or a reply…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-text-1 outline-none focus:border-primary" />
        </span>
      </div>

      {loading && !ready ? <Skeleton className="h-64 w-full" /> : !ready ? (
        // A READ THAT NEVER LANDED IS NOT AN EMPTY DESK.
        <Card padded={false}>
          <EmptyState title="The replies did not load"
            body="Nothing below is a statement about what is waiting — the desk could not read the contributions house. The reason is above; Refresh asks again." />
        </Card>
      ) : list.length === 0 ? (
        <Card padded={false}>
          {/* a search that matches nothing says so, rather than borrowing the
              sentence that describes an empty desk */}
          <EmptyState title={searching ? 'No reply matches that' : all ? 'No replies yet' : 'Nothing waits for you'}
            body={searching
              ? 'The search reads the name and the words of the replies already loaded. Clear it to see the rest.'
              : all ? 'When somebody answers a compliance message, it appears here.'
                : 'Every reply so far was settled by the estate, dismissed, or is still to come.'} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.map((r) => {
            const st = STATE[r.state] ?? { tint: 'slate' as ExtendedTintName, label: r.state }
            const waits = r.state === 'awaiting_owner' || r.state === 'needs_human'
            const drill = isRehearsal(r)
            return (
              <Card key={r.id} hover>
                <div className="flex items-start gap-3">
                  <DragPerson name={r.person_name} id={r.person_key} type="staff" subtitle={r.channel}>
                    <Avatar name={r.person_name} size="md" />
                  </DragPerson>
                  <div className="min-w-0 flex-1">
                    <DragPerson name={r.person_name} id={r.person_key} type="staff" className="block truncate text-[14px] font-semibold text-text-1">
                      {r.person_name || r.person_key}
                    </DragPerson>
                    <p className="mt-0.5 text-[11.5px] text-text-3" title={r.received_at}>
                      {r.channel} · {when(r.received_at)} · {HOW[r.correlation] ?? r.correlation}
                      {r.twins ? ` · reached ${r.twins + 1} of our lines, shown once` : null}
                      {r.twins ? ` · reached ${r.twins + 1} of our lines, shown once` : null}
                    </p>
                    {/* THE NAME ON A REHEARSAL ROW IS THE THREAD'S, NOT THE
                        WRITER'S — the row is built from the intent it quoted,
                        so a real person's name and face sit above words the
                        tester typed. Left standing, because whose thread this
                        is remains the useful fact; said out loud, because the
                        other reading is the one that cannot be true. */}
                    {drill && (
                      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-text-3">
                        The thread is {r.person_name || 'this person'}'s. The words are the tester's — nothing here says{' '}
                        {r.person_name ? 'they' : 'the person'} answered.
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Chip tint={st.tint}>{st.label}</Chip>
                    {/* THE ONE MARK THAT CHANGES WHO WROTE THE WORDS BELOW.
                        Its own tint, not the state's: a rehearsal can be
                        waiting or filed, and either way it is the tester. */}
                    {drill && <Chip tint="lavender">Rehearsal · the tester</Chip>}
                    {r.reason && r.state === 'needs_human' && <span className="text-[11px] text-text-3">{r.reason}</span>}
                  </span>
                </div>

                <blockquote className="mt-3 flex gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-[1.5] text-text-1">
                  <MessageSquareReply size={14} className="mt-0.5 shrink-0 text-text-3" />
                  <span className="min-w-0 break-words">{r.text}</span>
                </blockquote>

                {/* the items themselves are named by the two blocks below, so
                    this line stays what it always was: how the words were read */}
                <p className="mt-2 text-[11.5px] leading-[1.5] text-text-3">
                  Read as <strong className="text-text-2">{KIND[r.kind] ?? r.kind}</strong>
                  {plainWhy(r) ? ` — ${plainWhy(r)}` : ''}.
                </p>

                <div className="mt-2.5 space-y-1.5">
                  <LevelBlock label="Level one · the machine" step={levelOne(r)} />
                  <LevelBlock label="Level two · a person" step={levelTwo(r, waits)} />
                </div>

                {waits && (
                  <div className="mt-3 border-t border-border pt-2.5">
                    {/* THE INTERLOCK, SAID BEFORE THE CLICK AND NOT AFTER IT.
                        The inbound reader leaves a rehearsal's claims empty so that
                        "Settled" here closes nothing; the toast says so
                        afterwards, which is a poor moment to learn it. */}
                    {drill && (
                      <p className="mb-2 text-[11.5px] leading-[1.5] text-text-3">
                        A verdict here files the rehearsal and closes nothing — the row carries no claimed items on purpose, so
                        Settled cannot reach a real person's obligations.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy === r.id} onClick={() => void verdict(r, 'settled')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary disabled:opacity-50">
                        <Check size={13} /> Settled
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => void verdict(r, 'not_settled')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-50">
                        Keep asking
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => void verdict(r, 'dismissed')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-3 hover:bg-surface-2 disabled:opacity-50">
                        <X size={13} /> Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
