// HOTLINE — one screen for everything that comes in on the two AI-answered lines, laid out as an inbox: the calls…
// +13309195558 · Employee Support Hotline — Call Offs, the Support Queue, Daily Notes and Incidents +13307544040 ·…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Headphones, Lock, RefreshCw } from 'lucide-react'
import Card from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import Skeleton from '@/components/shared/Skeleton'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import PageSwitch from '@/pages/features/smartcomms/PageSwitch'
import CallPanel, { type PanelReads } from './hotline/CallPanel'
import HotlineHero from './hotline/HotlineHero'
import HotlineList from './hotline/HotlineList'
import HotlineToolbar from './hotline/HotlineToolbar'
import LaneSheet from './hotline/LaneSheet'
import { RecordPanel, ScreenPanel } from './hotline/RecordPanel'
import {
  TABS, buildPicture, chipsFor, heroStats, matchesSearch, rowDomId,
  type IndexState, type Item, type RecordItem, type TabId,
} from './hotline/items'
import { ohioDayOf, relativeTime, tally } from './hotline/join'
import { useHotlineData, type IndexProblem } from './hotline/useHotlineData'
import { isAccessRefusal, type NotesSourceKey, type SourceKey } from './hotline/hotlineApi'
import {
  LANE_IDS, MODALITY, NOTES_SOURCE_NAME, SHEET_LANES, SOURCE_NAME, scheduleReadOf, type LaneId,
} from './hotline/vocabulary'

// THE WINDOW EACH LANE OPENS ON: Calls the last 50, Call Offs 15, Support Queue 15, Daily Notes 20, Incidents 15…
const WINDOW: Record<TabId, number> = {
  calls: 50,
  calloffs: 15,
  queue: 15,
  notes: 20,
  incidents: 15,
  screening: 25,
}

// The window of the tab being read, with a floor for a tab added later and forgotten here — a missing number must…
const windowOf = (t: TabId) => WINDOW[t] ?? 25

/** The sweep runs every ten minutes; a last pass older than this is said. */
const SWEEP_LATE_MS = 30 * 60_000

const isLane = (t: TabId): t is LaneId => (LANE_IDS as string[]).includes(t)
const isTab = (v: string | null): v is TabId => TABS.some((t) => t.id === v)

const sentence = (s: string) => {
  const t = s.trim()
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`
}

const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const clip = (s: string, max = 240) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

// The clock the relative times read, to the minute — a tick inside the same minute is the same value, and React…
const minuteOf = (ms: number) => ms - (ms % 60_000)

// THE SENTENCE A REFUSAL EARNS, by the status and the reason the door gave.
function accessWords(p: IndexProblem, what: string): { title: string; body: string } {
  if (p.status === 401) {
    return { title: 'Sign in again', body: `Your session has ended, so the platform cannot tell who is asking for ${what}. Signing in again is all it needs.` }
  }
  switch (p.reason) {
    case 'session':
      return {
        title: 'Not in the access record yet',
        body: `The platform does not find this account in the access record, so ${what} stay closed. A new account appears there once the record catches up — try again later; signing in again will not change it.`,
      }
    case 'badge':
      return {
        title: `${upperFirst(what)} are not open to your badge`,
        body: 'Who may read the hotline is decided in App Access, by badge, and the matrix names none of yours for Smart Comms.',
      }
    case 'stale':
      return {
        title: 'Access could not be checked right now',
        body: 'The copy of App Access the platform reads is too old to vouch for a grant, so the door stays closed until it is read again. This is not a decision about your badge — try again later.',
      }
    case 'unreadable':
      return {
        title: 'Access could not be checked right now',
        body: 'The platform could not read the access record, so the door stays closed. This is not a decision about your badge — try again in a moment.',
      }
    case 'restricted':
      // an inactive account, a role the app is not served to, an app not installed for the home tenant — the…
      return { title: 'Not open to this account', body: `The platform does not serve ${what} to this account. Its own words below say why.` }
    default:
      return { title: `The platform refused ${what}`, body: 'It closed the door without a reason this screen knows — its own words are below.' }
  }
}

function LockCard({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-3 text-text-2">
        <Lock size={18} />
      </span>
      <h2 className="font-display text-[16px] font-semibold text-text-1">{title}</h2>
      <p className="max-w-[440px] text-[13px] leading-[1.6] text-text-2">{body}</p>
      {detail && <p className="max-w-[440px] text-[12px] text-text-3">{sentence(detail)}</p>}
    </Card>
  )
}

export default function SmartCommsHotlinePage() {
  const data = useHotlineData()
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  // THE ADDRESS HOLDS THE TAB, so a link to a tab opens that tab
  const tab: TabId = isTab(asked) ? asked : 'calls'
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('')
  const [limit, setLimit] = useState(() => windowOf(tab))
  const [selected, setSelected] = useState('')
  /** below lg the panel replaces the list; this is "the panel is showing" */
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [asSheet, setAsSheet] = useState(false)
  const [now, setNow] = useState(() => minuteOf(Date.now()))
  const panelRef = useRef<HTMLDivElement>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)

  // the clock the relative times read — Ohio's today flips with it.
  useEffect(() => {
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') setNow(minuteOf(Date.now()))
    }
    const t = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const today = ohioDayOf(now)

  const { lanes, screens, index, screening } = data
  // keyed on the row arrays themselves: a re-read that brought the same rows moves a lane's clock, not the picture
  const laneRows = useMemo(() => ({
    calloffs: lanes.calloffs.rows,
    queue: lanes.queue.rows,
    notes: lanes.notes.rows,
    incidents: lanes.incidents.rows,
  }), [lanes.calloffs.rows, lanes.queue.rows, lanes.notes.rows, lanes.incidents.rows])

  // whether "no scheduled shift was found" may be said of a note placed by its call's hour
  const notesSchedule = scheduleReadOf(data.notesMeta?.sources.schedule)
  const picture = useMemo(
    () => buildPicture(index, laneRows, screens.screens, screens.candidates, notesSchedule),
    [index, laneRows, screens.screens, screens.candidates, notesSchedule],
  )
  const screensRead = !!screens.screens
  const stats = useMemo(
    () => (index ? heroStats(picture.calls, today, { screensRead, screening }) : null),
    [index, picture, today, screensRead, screening],
  )

  const refused = isAccessRefusal(data.problem)
  const indexState: IndexState = refused ? 'refused' : index ? (data.fromKept ? 'kept' : 'live') : data.problem ? 'failed' : 'loading'
  const notesRefusal = lanes.notes.refusal

  /** a tab this session may not read, with the sentence of why */
  const closed = useMemo(() => {
    const out: Partial<Record<TabId, string>> = {}
    if (refused && data.problem) {
      out.calls = accessWords(data.problem, 'the calls').title
      out.screening = out.calls
    } else if (screening === 'withheld') {
      out.screening = 'Not open to your role'
    }
    if (notesRefusal) out.notes = accessWords(notesRefusal, 'Daily Notes').title
    // the three sheet lanes come through the same gate as the calls now, so a refusal of the session closes them…
    for (const l of SHEET_LANES) {
      const r = lanes[l].refusal
      if (r) out[l] = accessWords(r, MODALITY[l].label).title
    }
    return out
  }, [refused, data.problem, screening, notesRefusal, lanes])

  const tabItems = closed[tab] ? null : picture.tabs[tab]
  const chips = useMemo(
    () => tally((tabItems ?? []).flatMap((i) => chipsFor(tab, i, screensRead))),
    [tabItems, tab, screensRead],
  )
  const filtered = useMemo(
    () => (tabItems ?? []).filter((i) => (!chip || chipsFor(tab, i, screensRead).includes(chip)) && matchesSearch(i, query)),
    [tabItems, tab, chip, query, screensRead],
  )
  const shown = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  const counts: Record<TabId, number | null> = {
    calls: closed.calls ? null : picture.tabs.calls?.length ?? null,
    calloffs: closed.calloffs ? null : picture.tabs.calloffs?.length ?? null,
    queue: closed.queue ? null : picture.tabs.queue?.length ?? null,
    notes: closed.notes ? null : picture.tabs.notes?.length ?? null,
    incidents: closed.incidents ? null : picture.tabs.incidents?.length ?? null,
    // an empty Screening tab is a count only when the line is known to be open to this role — otherwise the calls…
    screening: closed.screening || (screening === 'unknown' && !picture.tabs.screening?.length)
      ? null
      : picture.tabs.screening?.length ?? null,
  }

  /* ── selection ─────────────────────────────────────────────────── */

  const selectedItem: Item | null = selected ? picture.byKey.get(selected) ?? null : null
  // A row filed from a call opens THE CALL, with that row's card in focus.
  const panelCall = selectedItem?.type === 'call'
    ? selectedItem
    : selectedItem?.type === 'record' ? selectedItem.call : null
  const panelKey = panelCall ? panelCall.key : selected || 'nothing'

  useEffect(() => {
    if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0
  }, [panelKey])

  const select = useCallback((key: string, open: boolean) => {
    setSelected(key)
    if (!open) return
    setPhoneOpen(true)
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023.98px)').matches
    if (narrow) window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'start' }))
  }, [])

  const back = useCallback(() => {
    setPhoneOpen(false)
    const key = selected
    window.requestAnimationFrame(() => document.getElementById(rowDomId(key))?.scrollIntoView({ block: 'center' }))
  }, [selected])

  const showMore = useCallback(() => setLimit((n) => n + windowOf(tab)), [tab])

  const changeTab = (t: TabId) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (t === 'calls') p.delete('tab')
      else p.set('tab', t)
      return p
    }, { replace: true })
    setChip('')
    setLimit(windowOf(t))
    setPhoneOpen(false)
    if (!isLane(t)) setAsSheet(false)
    const next = picture.tabs[t] ?? []
    if (!selected || next.some((i) => i.key === selected)) return
    // a row opened from a lane leads to its call on the Calls tab
    const cur = picture.byKey.get(selected)
    const call = cur?.type === 'record' ? cur.call : null
    setSelected(call && next.some((i) => i.key === call.key) ? call.key : '')
  }

  const onRefresh = async () => {
    const { problem, laneErrors } = await data.refresh()
    if (problem) {
      toast({
        type: 'warning',
        title: isAccessRefusal(problem) ? accessWords(problem, 'the calls').title : 'The hotline door did not answer',
        body: sentence(problem.message),
      })
    } else if (laneErrors.length) {
      toast({
        type: 'warning',
        title: 'Read again, with gaps',
        body: `${laneErrors.map((l) => MODALITY[l].label).join(', ')} could not be read — the rest is current.`,
      })
    } else {
      toast({ type: 'success', title: 'Read again', body: 'The calls, the four sheets and the screens.' })
    }
  }

  /* ── what the hero must say ─────────────────────────────────────── */

  const { sweep, notesMeta } = data
  const problems = useMemo(() => {
    const out: string[] = []
    const p = data.problem
    if (p && !isAccessRefusal(p)) {
      // a door that could not read (a 503 included) closes nothing: what is on screen stays, and the relay's own…
      out.push(index
        ? `The hotline door did not answer just now — ${sentence(p.message)} ${data.fromKept
          ? 'The calls shown are the copy this browser kept.'
          : 'The calls shown are the last ones this tab read.'}`
        : sentence(p.message))
    }
    for (const [k, h] of Object.entries(index?.sources ?? {})) {
      if (h && !h.ok) {
        const name = SOURCE_NAME[k as SourceKey] ?? k
        out.push(`${upperFirst(name)} could not be read${h.error ? ` — ${sentence(h.error)}` : '.'}`)
      }
    }
    if (sweep) {
      const n = sweep.refused_in_a_row
      const why = sweep.message ? ` — ${sentence(clip(sweep.message))}` : sweep.reason && sweep.reason !== 'unknown' ? ` (${sweep.reason}).` : '.'
      if (n !== null && n > 0) {
        out.push(`The hotline sweep has refused ${n === 1 ? 'its last pass' : `${n.toLocaleString()} passes in a row`}${why}`)
      } else if (n === null && /^([45]\d\d|degraded|error|failed|refused)$/i.test(sweep.status)) {
        out.push(`The hotline sweep's last pass was refused${why}`)
      }
      const at = Date.parse(sweep.at)
      if (Number.isFinite(at) && now - at > SWEEP_LATE_MS) {
        // "read as they end" only while the relay says so and this tab hears it
        out.push(data.live
          ? `The hotline sweep's last pass was ${relativeTime(at, now)}. Calls are read as they end; a ten-minute pass is the safety net.`
          : `The hotline sweep's last pass was ${relativeTime(at, now)} — it runs about every ten minutes.`)
      }
    }
    for (const l of SHEET_LANES) {
      // a refusal is said on the lane's own tab, in its card, not here
      if (lanes[l].error && !lanes[l].refusal) out.push(`${MODALITY[l].label} could not be read — ${sentence(lanes[l].error)}`)
    }
    if (lanes.notes.error && !lanes.notes.refusal) {
      out.push(`Daily Notes could not be read — ${sentence(lanes.notes.error)}`)
    }
    for (const [k, h] of Object.entries(notesMeta?.sources ?? {})) {
      // the notes book's own copy sentence is the notes' error, said just above
      if (k === 'notes' && lanes.notes.error) continue
      if (h && !h.ok) {
        const name = NOTES_SOURCE_NAME[k as NotesSourceKey] ?? k
        // the schedule is three copies: rows that came back mean some of them answered
        const part = k === 'schedule' && typeof h.rows === 'number' ? 'part of ' : ''
        out.push(`For Daily Notes, ${part}${name} could not be read${h.error ? ` — ${sentence(h.error)}` : '.'}`)
      }
    }
    if (screening !== 'withheld' && !closed.screening) {
      if (screens.asked && !screens.screens) {
        out.push('The hiring lane’s screens could not be read, so screening calls show without their outcome.')
      }
      if (screens.asked && !screens.candidates) {
        out.push('The candidates could not be read, so a screening call cannot name its candidate by number.')
      }
    }
    return out
  }, [data.problem, data.fromKept, data.live, index, sweep, now, lanes, notesMeta, screening, closed.screening, screens])

  const quiet = useMemo(() => {
    const out: string[] = []
    if (data.fromKept) out.push('showing the copy this browser kept while the door answers')
    const built = Date.parse(data.builtAt)
    if (Number.isFinite(built)) out.push(`index built ${relativeTime(built, now)}`)
    return out
  }, [data.fromKept, data.builtAt, now])

  const lastLogged = index ? Date.parse(index.hotline_last_logged_at) : NaN

  const lineNotes = useMemo(() => ({
    hotline: refused ? 'Not open to this session' : undefined,
    screening: refused
      ? 'Not open to this session'
      : screening === 'withheld'
        ? 'Not open to your role'
        : screening === 'unknown' && index ? 'Whether this line is open to your role could not be read' : undefined,
  }), [refused, screening, index])

  const reads: PanelReads = useMemo(() => ({
    sources: index?.sources ?? null,
    laneErrors: Object.fromEntries(LANE_IDS.filter((l) => lanes[l].error).map((l) => [l, lanes[l].error])),
    lanesUnread: LANE_IDS.filter((l) => !lanes[l].rows && !lanes[l].error),
    laneFresh: {
      calloffs: lanes.calloffs.dataAt,
      queue: lanes.queue.dataAt,
      notes: lanes.notes.dataAt,
      incidents: lanes.incidents.dataAt,
    },
    screensRead,
    candidatesRead: !!screens.candidates,
    indexState,
    live: data.live,
  }), [index, lanes, screensRead, screens.candidates, indexState, data.live])

  /* ── the page ───────────────────────────────────────────────────── */

  const header = (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
      <PageHeader
        title="Hotline"
        subtitle="Every call on the two AI-answered lines — who called, what was said, and what it filed."
        actions={
          <>
            <PageSwitch />
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={data.refreshing}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              <RefreshCw size={14} className={data.refreshing || !data.settled ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        }
      />
    </motion.div>
  )

  /** the card a closed tab shows in place of its list */
  const lockCard = (() => {
    if (!closed[tab]) return null
    if (tab === 'notes' && notesRefusal) {
      const w = accessWords(notesRefusal, 'Daily Notes')
      return <LockCard title={w.title} body={w.body} detail={notesRefusal.message} />
    }
    const laneRefusal = isLane(tab) ? lanes[tab].refusal : null
    if (laneRefusal && isLane(tab)) {
      const w = accessWords(laneRefusal, MODALITY[tab].label)
      return <LockCard title={w.title} body={w.body} detail={laneRefusal.message} />
    }
    if (refused && data.problem) {
      const w = accessWords(data.problem, 'the calls')
      return <LockCard title={w.title} body={w.body} detail={data.problem.message} />
    }
    return (
      <LockCard
        title="Screening calls are not open to your role"
        body="The 4040's calls are candidates' interviews, and the platform hands them only to the roles the hiring lane's screens are open to. The hotline's own tabs are unaffected."
      />
    )
  })()

  const listEmpty = (() => {
    if (tabItems && tabItems.length && !filtered.length) return 'Nothing on this tab answers to that search and filter.'
    if (tab === 'calls') {
      if (!index) return data.problem ? sentence(data.problem.message) : 'Reading the calls index…'
      return 'The calls index answered and holds no call on either line.'
    }
    if (isLane(tab)) {
      if (!tabItems) return lanes[tab].error
        ? `${MODALITY[tab].label} could not be read — ${sentence(lanes[tab].error)}`
        : `Reading ${MODALITY[tab].label}…`
      return `${MODALITY[tab].label} answered and holds no rows.`
    }
    if (!tabItems) return 'Neither the calls index nor the hiring lane’s screens have answered.'
    if (screening === 'unknown') {
      return 'No screening call is in the calls index, and whether the screening line is open to your role could not be read.'
    }
    return screensRead ? 'No call on the screening line and no screen on file.' : 'No call on the screening line — and the screens could not be read.'
  })()

  const waitingForList = !tabItems && !closed[tab] && (
    (tab === 'calls' && !data.settled) ||
    (isLane(tab) && !lanes[tab].error) ||
    (tab === 'screening' && !data.settled && !screens.asked)
  )

  const sheetLane = asSheet && isLane(tab) && tabItems ? tab : null
  const unmatched = tab === 'notes' && !closed.notes ? notesMeta?.unmatched ?? null : null

  return (
    <div className="w-full pb-16">
      {header}

      {!index && !data.settled ? (
        <Skeleton className="mb-5 h-[248px] w-full rounded-[16px]" />
      ) : (
        <HotlineHero
          stats={stats}
          now={now}
          sweep={sweep}
          lastLoggedMs={Number.isFinite(lastLogged) ? lastLogged : null}
          indexState={indexState}
          lineNotes={lineNotes}
          unavailable={refused
            ? 'The calls are not open to this session — nothing here is a measured zero.'
            : 'The calls index has not answered — nothing here is a measured zero.'}
          quiet={quiet}
          problems={problems}
          live={data.live}
        />
      )}

      <HotlineToolbar
        tab={tab}
        counts={counts}
        closed={closed}
        onTab={changeTab}
        query={query}
        onQuery={(q) => { setQuery(q); setLimit(windowOf(tab)) }}
        chips={chips}
        chip={chip}
        onChip={(v) => { setChip(v); setLimit(windowOf(tab)) }}
        sheetable={isLane(tab) && !!tabItems}
        asSheet={asSheet}
        onSheet={setAsSheet}
      />

      {unmatched && unmatched.rows !== null && unmatched.rows > 0 && (
        <p className="-mt-1 mb-3 px-1 text-[12px] leading-[1.6] text-text-3">
          <span className="font-stat text-text-2">{unmatched.rows.toLocaleString()}</span>{' '}
          {unmatched.rows === 1 ? 'note names' : 'notes name'} a client the clients list does not hold
          {unmatched.names !== null ? <> (<span className="font-stat">{unmatched.names.toLocaleString()}</span> {unmatched.names === 1 ? 'name' : 'distinct names'})</> : null}
          {' '}— {unmatched.rows === 1 ? 'it shows' : 'they show'} the name as written and no client.
        </p>
      )}

      {sheetLane ? (
        <LaneSheet lane={sheetLane} items={filtered as RecordItem[]} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className={cn('min-w-0', phoneOpen && 'hidden lg:block')}>
            {lockCard ?? (waitingForList ? (
              <Card padded={false} className="overflow-hidden">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-start gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
                    <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  </div>
                ))}
              </Card>
            ) : (
              <HotlineList
                tab={tab}
                items={shown}
                total={filtered.length}
                selectedKey={selected}
                today={today}
                indexState={indexState}
                screensRead={screensRead}
                onSelect={select}
                onShowMore={showMore}
                empty={listEmpty}
              />
            ))}
          </div>

          <div ref={panelRef} className={cn('min-w-0 scroll-mt-4 lg:sticky lg:top-4', !phoneOpen && 'hidden lg:block')}>
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
              <div ref={panelScrollRef} className="scroll-thin lg:max-h-[calc(100dvh-8.5rem)] lg:overflow-y-auto">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={panelKey}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                  >
                    {panelCall ? (
                      <CallPanel
                        item={panelCall}
                        focusKey={selectedItem?.type === 'record' ? selectedItem.key : ''}
                        reads={reads}
                        today={today}
                        onBack={back}
                      />
                    ) : selectedItem?.type === 'record' ? (
                      <RecordPanel item={selectedItem} indexState={indexState} onBack={back} />
                    ) : selectedItem?.type === 'screen' ? (
                      <ScreenPanel item={selectedItem} indexState={indexState} onBack={back} />
                    ) : (
                      <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary">
                          <Headphones size={20} />
                        </span>
                        <p className="mt-4 font-display text-[15px] font-medium text-text-1">
                          {isLane(tab) ? 'Pick a row' : 'Pick a call'}
                        </p>
                        <p className="mt-1 max-w-[340px] text-[13px] leading-[1.6] text-text-2">
                          {isLane(tab)
                            ? 'A row filed from a call opens that call — its summary, its words, and the row in focus. A row filed by hand opens on its own.'
                            : 'Its summary, what it filed, what that set in motion, and its words open here. Up and Down walk the list.'}
                        </p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 px-1 text-[12px] leading-[1.6] text-text-3">
        This screen only reads. The hotline sweep files every call on the 5558 into its four lanes and the hiring lane
        files every call on the 4040, whether or not anybody is looking — what you see is what they already stored. A
        name appears only where the roster knows the number or a filed row says who spoke; a name taken from the caller
        ID is the roster&apos;s to give, and a shared line names nobody.
      </p>
    </div>
  )
}
