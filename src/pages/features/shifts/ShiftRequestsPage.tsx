// Requests: the whole company's cumulative list of shift asks and answers, never emptied.
// Every rule and privacy cut is server/shift_requests.py's; the screen only draws, filters and counts down.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  AlertTriangle, ArrowRightLeft, Check, Clock, GraduationCap, Hand, Loader2, PanelRightOpen, Printer,
  RefreshCw, Share2, ShieldAlert, Undo2, Users, X,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import SearchInput from '@/components/shared/SearchInput'
import ExportMenu from '@/components/shared/ExportMenu'
import EmptyState from '@/components/shared/EmptyState'
import Avatar from '@/components/shared/Avatar'
import { useAuthStore } from '@/auth/useAuthStore'
import { share } from '@/stores/useShareStore'
import { toast } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { onLiveEvent } from '@/lib/snapshotClient'
import { ohioDateTime, ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { HOUSECAL_LIVE_EVENT } from './houseCalTypes'
import {
  CALL_OFF_EXPORT_COLUMNS, EXPORT_COLUMNS, KIND_LABEL, STATE_LABEL, STATE_TINT, TIME_OFF_EXPORT_COLUMNS,
  TIME_OFF_STATUS_LABEL, TIME_OFF_STATUS_TINT, timeOffLegLine,
  actionsFor, appliedFor, approveBlockedBy, askLine, callOffExportRows, calledOffLine, clockOf, codeOf,
  countdown, cutsFrom, dayLabel, decidesHere, decisionLine, displacedLine, drawsHouses, drawsRehearsal, exportRows, filterRows,
  filterTimeOff, groupByDay, placeLine, reasonLine, refNoLongerOpen, safeRef, shiftHandle, shiftLine,
  shiftStateLabel, shiftStateWord, splitReplies, timeOffCutsFrom, timeOffDirectorsNote, timeOffExportRows, urgentLine,
  visibleRows, waitingLine, windowLine,
  type Cuts, type Feed, type Offer, type PoolShift, type RequestRow, type ShiftCard, type ShiftDetail,
  type TimeOffCuts, type TimeOffRow,
} from './requestsLogic'
import { shiftPanel, swapPanel, timeOffPanel, trainingPanel } from './requestDetail'
import { useBuilderRefresh } from '@/pages/features/calendarbuilder/builderRefresh'
import OnCalendar from './OnCalendar'
import TextReplies from './TextReplies'
import Rehearsal from './Rehearsal'
import RehearsalMark from './RehearsalMark'
import TrainingNote from './TrainingNote'
import TransferPicker from './TransferPicker'
import HandoffCard from './HandoffCard'
import { ANSWER_PATH, WITHDRAW_PATH } from './handoffActions'

/** The ring on the row a notice opened. */
const FOCUS_RING = 'ring-2 ring-[#8b0000] ring-offset-1 ring-offset-surface'

async function lane<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const env = await res.json().catch(() => ({}))
  if (Number(env.status) !== 200) {
    throw new Error(String(env.message || `the server answered ${res.status}`))
  }
  return env.data as T
}

const CHIP = 'rounded-full px-2 py-0.5 text-[11px] font-semibold'
const BTN = 'flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all disabled:opacity-50'
const ICON_BTN = 'grid h-9 w-9 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

function Chip({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <span className={cn(CHIP, `bg-tint-${tint} text-tint-fg-${tint}`)}>{children}</span>
  )
}

// The window as a live number.
function Countdown({ closesAt, nowMs }: { closesAt: string; nowMs: number }) {
  const { label, urgent } = countdown(closesAt, nowMs)
  if (!label) return null
  return (
    <span className={cn('flex items-center gap-1 text-[11.5px] font-semibold',
      urgent ? 'text-danger' : 'text-text-2')}>
      <Clock size={11} /> {label}
    </span>
  )
}

export default function ShiftRequestsPage({ embedded }: { embedded?: boolean } = {}) {
  const [params, setParams] = useSearchParams()
  const [feed, setFeed] = useState<Feed | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')
  /** the tab lives in the address, so a notice clicked while open still lands */
  const tab = params.get('tab') || 'me'
  const [cuts, setCuts] = useState<Cuts>({ q: '', house: 'all', kind: 'all', state: 'all' })
  const [nowMs, setNowMs] = useState(() => Date.now())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  /** The shift a notice opened this screen on, ringed where it is listed. */
  const focusRef = safeRef(params.get('ref'))
  const scrolledFor = useRef('')

  /** One read at a time: a ring that arrives mid-read is read once more after. */
  const reading = useRef({ busy: false, again: false })
  const load = useCallback(() => {
    const r = reading.current
    if (r.busy) { r.again = true; return }
    r.busy = true
    lane<Feed>('/hub-lanes/shift-requests')
      .then((d) => { setFeed(d); setFailed('') })
      // A screen that cannot read says so.
      .catch((err) => setFailed(err instanceof Error ? err.message : 'could not be read'))
      .finally(() => {
        r.busy = false
        if (r.again) { r.again = false; load() }
      })
  }, [])

  useEffect(() => { load() }, [load])
  // Calendar Builder's header Refresh, when this screen is drawn under it.
  useBuilderRefresh(load)
  // the ring, and a stream reconnect, re-read the list
  useEffect(() => {
    const offRing = onLiveEvent(HOUSECAL_LIVE_EVENT, load)
    const offOpen = onLiveEvent('open', load)
    return () => { offRing(); offOpen() }
  }, [load])
  useEffect(() => {
    timer.current = setInterval(() => setNowMs(Date.now()), 1000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])
  // A ten-minute window closes while somebody is looking at it: the feed is re-read on its own clock so the button…
  useEffect(() => {
    const every = setInterval(load, 30_000)
    return () => clearInterval(every)
  }, [load])
  // scrolled into view once per tab, not on every re-read
  useEffect(() => {
    const mark = `${tab}|${focusRef}`
    if (!focusRef || !feed || scrolledFor.current === mark) return
    const el = typeof document.querySelector === 'function'
      ? document.querySelector(`[data-ref="${focusRef}"]`)
      : null
    if (!el) return
    scrolledFor.current = mark
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [focusRef, feed, tab])

  const act = useCallback(async (key: string, path: string, body: unknown, said: string) => {
    setBusy(key)
    try {
      // `changed: false` is the relay saying the seat was already filled by somebody else; it is a 200, and it is…
      const got = await lane<{ changed?: boolean }>(path, { method: 'POST', body: JSON.stringify(body) })
      if (got && got.changed === false) {
        toast({ type: 'warning', title: 'Nothing was recorded',
                body: 'That answer had already been given — it keeps the name that gave it.' })
      } else {
        toast({ type: 'success', title: said })
      }
      load()
      // the bell re-reads so an answered invitation leaves it
      void useNotificationStore.getState().fetchAll({ force: true })
    } catch (err) {
      toast({ type: 'danger', title: 'Not done',
              body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }, [load])

  const rows = useMemo(() => visibleRows(feed?.rows ?? []), [feed])
  const shown = useMemo(() => filterRows(rows, cuts), [rows, cuts])
  const choices = useMemo(() => cutsFrom(rows), [rows])
  // held here because Export, Share and Print carry the open tab's cuts
  const [offCuts, setOffCuts] = useState<TimeOffCuts>({})
  const offRows = useMemo(() => (feed?.time_off?.rows ?? []).filter((t) => t.visible), [feed])
  const offShown = useMemo(() => filterTimeOff(offRows, offCuts), [offRows, offCuts])
  const [coCuts, setCoCuts] = useState<Cuts>({})
  const coShown = useMemo(() => (feed?.call_offs ?? []).filter((s) =>
    (!coCuts.house || coCuts.house === 'all' || s.house === coCuts.house)
    && (!coCuts.state || coCuts.state === 'all' || s.state === coCuts.state)
    && (!coCuts.day || coCuts.day === 'all' || s.col_iso === coCuts.day)), [feed, coCuts])
  // Ohio's date, not UTC's
  const today = useMemo(() => ohioToday(), [])

  /** the side panel: list facts at once, the detail when it lands (if still open) */
  const opened = useRef('')
  const openShift = useCallback((ref: string | undefined) => {
    const card = ref ? feed?.shifts?.[ref] : undefined
    if (!ref || !card) return
    const store = useDetailPanelStore.getState()
    opened.current = ref
    store.openDetail(shiftPanel(card, { today, nowMs: Date.now(), detail: null }))
    const still = () => opened.current === ref
      && useDetailPanelStore.getState().panel?.record?.id === ref
    lane<ShiftDetail>(`/hub-lanes/shift-requests/detail?ref=${encodeURIComponent(ref)}`)
      .then((d) => { if (still()) store.openDetail(shiftPanel(card, { today, nowMs: Date.now(), detail: d })) })
      .catch((err) => {
        if (still()) {
          store.openDetail(shiftPanel(card, { today, nowMs: Date.now(), detail: null,
            detailWhy: err instanceof Error ? err.message : 'the server did not answer' }))
        }
      })
  }, [feed, today])
  const openRow = useCallback((r: RequestRow) => {
    if (r.kind === 'swap') { opened.current = r.id; useDetailPanelStore.getState().openDetail(swapPanel(r, today)); return }
    if (r.kind === 'ist_approval') { opened.current = r.id; useDetailPanelStore.getState().openDetail(trainingPanel(r, today)); return }
    openShift(r.ref)
  }, [openShift, today])
  const openTimeOff = useCallback((t: TimeOffRow) => {
    opened.current = t.id
    useDetailPanelStore.getState().openDetail(timeOffPanel(t, today))
  }, [today])
  const waitingOnMe = useMemo(
    () => rows.filter((r) => {
      const a = actionsFor(r, feed ?? { me: '', manages: [], badges: [] }, codeOf)
      return a.answerSwap || a.training || a.decide
    }),
    [rows, feed],
  )

  const tabs = useMemo(() => {
    const list = [
      { id: 'me', label: `Available to me · ${feed?.available.length ?? 0}` },
      { id: 'mine', label: `Waiting on you · ${waitingOnMe.length}` },
      { id: 'shifts', label: feed?.my_shifts_why ? 'My shifts · unread' : `My shifts · ${feed?.my_shifts?.length ?? 0}` },
      { id: 'calloffs', label: `Call-offs · ${feed?.call_offs.length ?? 0}` },
      { id: 'all', label: `All requests · ${rows.length}` },
      { id: 'timeoff', label: feed?.time_off && !feed.time_off.readable
          ? 'Time off · unread' : `Time off · ${offRows.length}` },
    ]
    if (drawsHouses(feed)) list.push({ id: 'houses', label: 'Houses' })
    if (feed?.panels) list.push({ id: 'attendance', label: 'Attendance' })
    // the texts tab rides with the attendance panels
    if (feed?.panels) {
      const acted = splitReplies(feed.panels.replies ?? []).acted.length
      list.push({ id: 'texts', label: feed.panels.replies_readable === false ? 'Texts · unread' : `Texts · ${acted}` })
    }
    // a new page: the master's alone until it is released, as the relay's doors say
    if (drawsRehearsal(feed)) list.push({ id: 'rehearsal', label: 'Rehearsal' })
    return list
  }, [feed, rows.length, waitingOnMe.length, offRows.length])

  const onTab = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  /** Export, Share and Print carry the open tab's on-screen rows */
  const out = useMemo(() => {
    const now = Date.now()
    if (tab === 'timeoff') {
      return { rows: timeOffExportRows(offShown), columns: TIME_OFF_EXPORT_COLUMNS, filename: 'time-off',
               noun: ['time-off request', 'time-off requests'] }
    }
    if (tab === 'calloffs') {
      return { rows: callOffExportRows(coShown, feed?.shifts, now), columns: CALL_OFF_EXPORT_COLUMNS,
               filename: 'call-offs', noun: ['call-off', 'call-offs'] }
    }
    return { rows: exportRows(shown, feed?.shifts, now), columns: EXPORT_COLUMNS, filename: 'shift-requests',
             noun: ['request', 'requests'] }
  }, [tab, offShown, coShown, shown, feed])

  const shareThis = () => share({
    title: 'Requests',
    subtitle: `${out.rows.length} ${out.rows.length === 1 ? out.noun[0] : out.noun[1]} — as shown on screen`,
    rows: out.rows,
    columns: out.columns,
    filename: out.filename,
    icon: 'inbox',
  })

  const outputs = (
    <>
      <ExportMenu filename={out.filename} columns={out.columns} rows={out.rows} />
      <button type="button" aria-label="Share this view" title="Share this view"
        onClick={shareThis} className={ICON_BTN}>
        <Share2 size={15} />
      </button>
      <button type="button" aria-label="Print" title="Print this view"
        onClick={() => window.print()} className={ICON_BTN}>
        <Printer size={15} />
      </button>
    </>
  )

  return (
    <div className="w-full">
      {!embedded ? (
        <PageHeader
          title="Requests"
          subtitle="Every open shift, call-off, swap, training approval and time off in the company — as they are asked and as they are answered"
          actions={
            <div className="flex items-center gap-1">
              <button aria-label="Refresh" title="Read it again" onClick={load} className={ICON_BTN}>
                <RefreshCw size={15} />
              </button>
              {outputs}
            </div>
          }
        />
      ) : (
        // Under Calendar Builder's header, which carries the title and Refresh.
        <div className="mb-3 flex items-center justify-end gap-1">{outputs}</div>
      )}

      {failed && (
        <p className="mb-3 rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
          Requests could not be read ({failed}). This screen is not saying there are none.
        </p>
      )}
      {feed && !feed.ist.readable && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500 bg-amber-500/[0.06] px-4 py-2.5 text-[12px] leading-[18px] text-text-2">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-600" />
          The IST record could not be read{feed.ist.why ? ` (${feed.ist.why})` : ''}, so nobody can
          be shown to be trained in a house. Every placement still needs the house manager's
          approval — a read that failed is not a trained person.
        </p>
      )}

      <div className="mb-4">
        <SegmentedTabs tabs={tabs} value={tab} onChange={onTab} />
      </div>

      {feed === null && !failed && (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the company's requests…
        </p>
      )}

      {refNoLongerOpen(feed, tab, focusRef) && (
        <p className="mb-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-[12.5px] leading-[18px] text-text-2">
          The shift that notice was about is no longer open to you — its window closed, somebody
          has it, or it now overlaps a shift of yours.
        </p>
      )}
      {tab === 'me' && !feed?.available.some((o) => o.ref === focusRef) && appliedFor(feed, focusRef) && (
        <p className="mb-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-[12.5px] leading-[18px] text-text-2">
          You applied for the shift that notice was about — the house manager decides.
        </p>
      )}

      {feed && tab === 'me' && (
        <AvailableToMe feed={feed} nowMs={nowMs} busy={busy} today={today} focusRef={focusRef}
          onOpen={openShift}
          onApply={(o) => act(o.key, '/hub-lanes/shift-requests/apply',
            shiftHandle(o),
            o.needs_training_approval
              ? 'Applied — it needs the house manager to approve the training'
              : 'Applied')} />
      )}

      {feed && tab === 'mine' && (
        <WaitingOnYou feed={feed} rows={waitingOnMe} busy={busy} act={act} focusRef={focusRef}
          today={today} nowMs={nowMs} onOpen={openRow} />
      )}

      {feed && tab === 'shifts' && (
        <MyShifts feed={feed} today={today} busy={busy} act={act} onChanged={load} />
      )}

      {feed && tab === 'calloffs' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={coCuts.house ?? 'all'} onChange={(house) => setCoCuts((c) => ({ ...c, house }))}
              all="Every house" options={[...new Set(feed.call_offs.map((s) => s.house))].sort()} />
            <Select value={coCuts.state ?? 'all'} onChange={(state) => setCoCuts((c) => ({ ...c, state }))}
              all="Any state" options={[...new Set(feed.call_offs.map((s) => s.state))].sort()}
              label={(s) => shiftStateLabel(s)} />
            <Select value={coCuts.day ?? 'all'} onChange={(day) => setCoCuts((c) => ({ ...c, day }))}
              all="Any shift day" options={[...new Set(feed.call_offs.map((s) => s.col_iso))].sort().reverse()}
              label={(d) => dayLabel(d, today)} />
            <span className="ml-auto text-[12px] text-text-3">{coShown.length} of {feed.call_offs.length}</span>
          </div>
          <CallOffs feed={feed} shifts={coShown} nowMs={nowMs} today={today} focusRef={focusRef}
            onOpen={openShift} />
        </>
      )}

      {feed && tab === 'houses' && (
        <HouseShifts feed={feed} shifts={feed.open_shifts} nowMs={nowMs} today={today}
          busy={busy} act={act} focusRef={focusRef} onOpen={openShift} />
      )}

      {feed && tab === 'timeoff' && (
        <TimeOff feed={feed} rows={offRows} shown={offShown} cuts={offCuts} setCuts={setOffCuts}
          today={today} onOpen={openTimeOff} />
      )}

      {feed && tab === 'attendance' && <Attendance feed={feed} />}

      {feed && tab === 'texts' && <TextReplies panels={feed.panels} />}

      {feed && tab === 'rehearsal' && drawsRehearsal(feed) && <Rehearsal />}

      {feed && tab === 'all' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput value={cuts.q ?? ''} onChange={(q) => setCuts((c) => ({ ...c, q }))}
              className="w-full max-w-full sm:w-[280px]"
              placeholder="Search person, house, shift…" />
            <Select value={cuts.house ?? 'all'} onChange={(house) => setCuts((c) => ({ ...c, house }))}
              all="Every house" options={choices.houses} />
            <Select value={cuts.person ?? 'all'} onChange={(person) => setCuts((c) => ({ ...c, person }))}
              all="Everybody" options={choices.people} />
            <Select value={cuts.kind ?? 'all'} onChange={(kind) => setCuts((c) => ({ ...c, kind }))}
              all="Every kind" options={choices.kinds} label={(k) => KIND_LABEL[k] ?? k} />
            <Select value={cuts.state ?? 'all'} onChange={(state) => setCuts((c) => ({ ...c, state }))}
              all="Any state" options={['waiting', 'settled']}
              label={(s) => (s === 'waiting' ? 'Still waiting' : 'Settled')} />
            <Select value={cuts.day ?? 'all'} onChange={(day) => setCuts((c) => ({ ...c, day }))}
              all="Any shift day" options={choices.days} label={(d) => dayLabel(d, today)} />
            <span className="ml-auto text-[12px] text-text-3">
              {shown.length} of {feed.total}
              {feed.whole_company ? ' · the whole company'
                : feed.manages.length ? ` · your own rows, and every row of ${feed.manages.join(', ')}`
                : ' · your own rows'}
            </span>
          </div>
          <AllRequests feed={feed} rows={shown} busy={busy} act={act} today={today} focusRef={focusRef}
            nowMs={nowMs} onOpen={openRow} />
        </>
      )}
    </div>
  )
}

function Select({ value, onChange, all, options, label }: {
  value: string; onChange: (v: string) => void; all: string; options: string[]
  label?: (v: string) => string
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary">
      <option value="all">{all}</option>
      {options.map((o) => <option key={o} value={o}>{label ? label(o) : o}</option>)}
    </select>
  )
}

/* ── what a shift's row leads with ───────────────────────────────────────── */

/** The button that opens a row's right-side panel. */
function DetailsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Everything about this request"
      className={cn(BTN, 'border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1')}>
      <PanelRightOpen size={13} /> Details
    </button>
  )
}

/** A pooled shift's lead facts, from its relay-cut card (Feed.shifts). */
function ShiftFacts({ card, nowMs, today, className }: {
  card: ShiftCard | undefined; nowMs: number; today: string; className?: string
}) {
  if (!card) return null
  const called = card.called_off
  return (
    <span className={cn('mt-1 grid gap-0.5 text-[11.5px] leading-[17px] text-text-3', className)}>
      <span>{placeLine(card)}</span>
      <span className="text-text-2">{shiftLine(card, today)}</span>
      <span>
        {windowLine(card.state, card.window, nowMs)}
        {` · ${card.applicant_count} applied`}
        {card.manager ? ` · ${card.managers.join(' and ')} ${card.managers.length > 1 ? 'manage' : 'manages'} the house` : ''}
      </span>
      {card.urgent && <span>{urgentLine(card.urgent)}</span>}
      {called && <span className="text-text-2">{calledOffLine(called)}</span>}
      {called && <span className="italic">{reasonLine(called)}</span>}
      {card.decision && <span className="text-text-2">{decisionLine(card.decision)}</span>}
    </span>
  )
}

/** A swap's or a training's own shift, led with the same place and hours. */
function CellFacts({ r, today }: { r: RequestRow; today: string }) {
  if (!r.essentials) return null
  return (
    <span className="mt-0.5 grid gap-0.5 text-[11px] leading-4 text-text-3">
      <span>{placeLine(r.essentials)}</span>
      <span>{shiftLine(r.essentials, today)}</span>
    </span>
  )
}

/* ── what this person may take right now ─────────────────────────────────── */

function AvailableToMe({ feed, nowMs, busy, today, onApply, focusRef, onOpen }: {
  feed: Feed; nowMs: number; busy: string; today: string; onApply: (o: Offer) => void; focusRef: string
  onOpen: (ref: string) => void
}) {
  if (!feed.me) {
    return <EmptyState title="This account is not on a roster"
      body="Shifts are offered by the name the schedule spells. Ask your manager to connect this account to it." />
  }
  if (feed.available_why) {
    return (
      <p className="flex items-start gap-2 rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 px-4 py-3 text-[12.5px] font-semibold text-text-1">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#8b0000]" />
        {feed.available_why} — this is not saying nothing is open to you. Refresh to try again.
      </p>
    )
  }
  if (!feed.available.length) {
    return <EmptyState title="Nothing is open to you right now"
      body={`An open shift is yours to apply for in the first ${feed.windows.open_shift_minutes} minutes after its house publishes the day, and only at a house you have worked in the last ${feed.windows.regular_days} days. A shift somebody called off is open to everyone for up to ${feed.windows.call_off_hours} hours, and closes ${feed.windows.call_off_before_start_minutes} minutes before it starts.`} />
  }
  return (
    <ul className="grid gap-2">
      {feed.available.map((o) => (
        <li key={`${o.location}|${o.key}`} data-ref={o.ref}
          className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3',
            focusRef && o.ref === focusRef && FOCUS_RING)}>
          <span className="w-[80px] shrink-0 text-[12.5px] font-semibold text-text-1">
            {dayLabel(o.col_iso, today)}
          </span>
          <span className="w-[100px] shrink-0 text-[12.5px] text-text-2">{o.house}</span>
          <span className="min-w-0 flex-1 text-[13px] text-text-1">
            {o.shift}
            <span className="block text-[11px] leading-4 text-text-3">
              {o.kind === 'call_off' ? 'A shift somebody called off' : 'An open shift'}
              {o.window.reserved && ` · reserved for ${o.house}'s staff until ${clockOf(o.window.closes_at)}`}
              {o.applicants > 0 && ` · ${o.applicants} already applied`}
            </span>
            {o.needs_training_approval && (
              <span className="mt-1 flex items-start gap-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                <GraduationCap size={11} className="mt-0.5 shrink-0" /> {o.ist.why}
              </span>
            )}
            <TrainingNote training={o.training} className="mt-0.5" />
            <ShiftFacts card={feed.shifts?.[o.ref]} nowMs={nowMs} today={today} />
          </span>
          <Countdown closesAt={o.window.closes_at} nowMs={nowMs} />
          {feed.shifts?.[o.ref] && <DetailsButton onClick={() => onOpen(o.ref)} />}
          <OnCalendar location={o.location} shiftRef={o.ref} />
          <button disabled={busy === o.key} onClick={() => onApply(o)}
            className={cn(BTN, 'bg-primary text-on-primary hover:bg-primary-hover')}>
            {busy === o.key ? <Loader2 size={13} className="animate-spin" /> : <Hand size={13} />}
            Apply
          </button>
        </li>
      ))}
    </ul>
  )
}

/* ── what is waiting on this reader ──────────────────────────────────────── */

type Act = (key: string, path: string, body: unknown, said: string) => void

function WaitingOnYou({ feed, rows, busy, act, focusRef, today, nowMs, onOpen }: {
  feed: Feed; rows: RequestRow[]; busy: string; act: Act; focusRef: string
  today: string; nowMs: number; onOpen: (r: RequestRow) => void
}) {
  if (!rows.length) {
    return <EmptyState title="Nothing is waiting on you"
      body="Swaps to accept, trainings to take on and open shifts to decide appear here the moment they are yours to answer." />
  }
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.id} data-ref={r.ref}
          className={cn('rounded-lg border-2 border-amber-500 bg-amber-500/[0.05] px-4 py-3',
            focusRef && r.ref === focusRef && FOCUS_RING)}>
          <Row r={r} feed={feed} busy={busy} act={act} today={today} nowMs={nowMs} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

/* ── this reader's own upcoming shifts, to transfer ──────────────────────── */

/** The reader's own shifts, each with Transfer where the relay allows it (shift_handoff.my_shifts). */
function MyShifts({ feed, today, busy, act, onChanged }: {
  feed: Feed; today: string; busy: string; act: Act; onChanged: () => void
}) {
  const [open, setOpen] = useState('')
  if (!feed.me) {
    return <EmptyState title="This account is not on a roster"
      body="Your shifts are found by the name the schedule spells. Ask your manager to connect this account to it." />
  }
  if (feed.my_shifts_why) {
    return (
      <p className="rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
        {feed.my_shifts_why}. This screen is not saying you have none.
      </p>
    )
  }
  const shifts = feed.my_shifts ?? []
  if (!shifts.length) {
    return <EmptyState title="No upcoming shifts on the house calendars"
      body="Your next three weeks of shifts appear here, each with a Transfer button." />
  }
  return (
    <ul className="grid gap-2">
      {shifts.map((s) => {
        const key = `${s.location}|${s.col_iso}`
        return (
          <li key={key} className="rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="w-[80px] shrink-0 text-[12.5px] font-semibold text-text-1">
                {dayLabel(s.col_iso, today)}
              </span>
              <span className="w-[100px] shrink-0 text-[12.5px] text-text-2">{s.house}</span>
              <span className="min-w-0 flex-1 text-[13px] text-text-1">
                {s.value}
                {!s.may_transfer && s.why && !s.offer && (
                  <span className="block text-[11px] leading-4 text-text-3">{s.why}</span>
                )}
              </span>
              {s.may_transfer && open !== key && (
                <button className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
                  onClick={() => setOpen(key)}>
                  <ArrowRightLeft size={13} /> Transfer
                </button>
              )}
            </div>
            {s.offer && (
              <HandoffCard h={s.offer} busy={busy === s.offer.id} className="mt-2"
                onAnswer={(h, word) => act(h.id, ANSWER_PATH,
                  { handoff_id: h.id, word }, word === 'yes' ? 'Answered' : 'Answered no')}
                onWithdraw={(h) => act(h.id, WITHDRAW_PATH,
                  { handoff_id: h.id }, 'Transfer withdrawn — the shift stays yours')} />
            )}
            {open === key && (
              <TransferPicker location={s.location} colIso={s.col_iso} dayLabel={dayLabel(s.col_iso, today)}
                onCancel={() => setOpen('')}
                onOffered={(offer) => {
                  setOpen('')
                  toast({ type: 'success', title: 'Transfer offered',
                          body: `${offer.to_staff} has to accept, and ${offer.approval?.why || 'the house manager approves'}. The shift is yours until both say yes.` })
                  onChanged()
                }} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ── the call-offs, for everybody, with their history ────────────────────── */

function CallOffs({ feed, shifts, nowMs, today, focusRef, onOpen }: {
  feed: Feed; shifts: PoolShift[]; nowMs: number; today: string; focusRef: string
  onOpen: (ref: string) => void
}) {
  if (!shifts.length) {
    return <EmptyState title={feed.call_offs.length ? 'Nothing matches those cuts' : 'No call-offs on the books'}
      body="Every call-off the platform reads appears here with its window, who applied and what the house manager decided." />
  }
  return (
    <ul className="grid gap-2">
      {shifts.map((s) => (
        <li key={`${s.location}|${s.key}`} data-ref={s.ref}
          className={cn('rounded-lg border border-border bg-surface px-4 py-3',
            focusRef && s.ref === focusRef && FOCUS_RING)}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-[80px] shrink-0 text-[12.5px] font-semibold text-text-1">
              {dayLabel(s.col_iso, today)}
            </span>
            <span className="w-[100px] shrink-0 text-[12.5px] text-text-2">{s.house}</span>
            <span className="min-w-0 flex-1 text-[13px] text-text-1">{s.value}</span>
            <Chip tint={s.state === 'filled' ? 'mint' : s.state === 'open' ? 'amber' : 'slate'}>
              {shiftStateWord(s.state, s.window)}
            </Chip>
            {s.state === 'open' && <Countdown closesAt={s.window.closes_at} nowMs={nowMs} />}
            {feed.shifts?.[s.ref] && <DetailsButton onClick={() => onOpen(s.ref)} />}
            <OnCalendar location={s.location} shiftRef={s.ref} />
          </div>
          {/* who called off and why reach managers only (server-cut) */}
          {feed.shifts?.[s.ref] ? (
            <ShiftFacts card={feed.shifts[s.ref]} nowMs={nowMs} today={today} />
          ) : (
            <p className="mt-1 text-[11.5px] leading-[17px] text-text-3">
              {s.called_off_by
                ? <>Called off by <span className="font-medium text-text-2">{s.called_off_by}</span></>
                : 'Somebody called off'}
              {' · '}{shiftStateLabel(s.state, s.window)}
              {s.filled_by && <> · taken by <span className="font-medium text-text-2">{s.filled_by}</span></>}
            </p>
          )}
          {feed.shifts?.[s.ref] && !feed.shifts[s.ref].called_off && (
            <p className="mt-0.5 text-[11.5px] leading-[17px] text-text-3">Somebody called off</p>
          )}
          <History applicants={s.history ?? s.applicants} />
        </li>
      ))}
    </ul>
  )
}

/* ── the open shifts of the houses this reader manages ───────────────────── */

function HouseShifts({ feed, shifts, nowMs, today, busy, act, focusRef, onOpen }: {
  feed: Feed; shifts: PoolShift[]; nowMs: number; today: string; busy: string; act: Act; focusRef: string
  onOpen: (ref: string) => void
}) {
  const [place, setPlace] = useState('all')
  const houses = useMemo(() => [...new Set(shifts.map((s) => s.house))].sort(), [shifts])
  const list = shifts.filter((s) => place === 'all' || s.house === place)
  if (!shifts.length) {
    return <EmptyState title="No shift is open anywhere"
      body="Every OPEN row on a house calendar and every shift a call-off leaves behind appears here, with its window and its applicants." />
  }
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Select value={place} onChange={setPlace} all="Every house" options={houses} />
        <span className="text-[12px] text-text-3">{list.length} shift{list.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="grid gap-2">
        {list.map((s) => {
          // THE WHOLE COMPANY'S POOL IS THEIRS TO READ; THIS HOUSE'S DECISION MAY NOT BE.
          const here = decidesHere(feed, s.location)
          return (
          <li key={`${s.location}|${s.key}`} data-ref={s.ref}
            className={cn('rounded-lg border bg-surface px-4 py-3',
              s.state === 'closed' && s.applicants.length ? 'border-amber-500' : 'border-border',
              focusRef && s.ref === focusRef && FOCUS_RING)}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-[80px] shrink-0 text-[12.5px] font-semibold text-text-1">
                {dayLabel(s.col_iso, today)}
              </span>
              <span className="w-[100px] shrink-0 text-[12.5px] text-text-2">{s.house}</span>
              <span className="min-w-0 flex-1 text-[13px] text-text-1">
                {s.value}
                <span className="block text-[11px] text-text-3">
                  {s.kind === 'call_off' ? 'A shift somebody called off' : 'An open shift'}
                  {' · '}{shiftStateLabel(s.state, s.window)}
                </span>
              </span>
              {s.state === 'open' && <Countdown closesAt={s.window.closes_at} nowMs={nowMs} />}
              <Chip tint={s.state === 'filled' ? 'mint' : s.state === 'open' ? 'amber' : 'slate'}>
                {shiftStateWord(s.state, s.window)}
              </Chip>
              {feed.shifts?.[s.ref] && <DetailsButton onClick={() => onOpen(s.ref)} />}
              <OnCalendar location={s.location} shiftRef={s.ref} />
            </div>
            <ShiftFacts card={feed.shifts?.[s.ref]} nowMs={nowMs} today={today} />
            {s.filled_by ? (
              <p className="mt-1.5 text-[12px] text-text-2">
                <Check size={11} className="mr-1 inline" />
                <span className="font-medium text-text-1">{s.filled_by}</span> has it
                <span className="text-text-3"> · {s.filled_how === 'approved' ? 'applied and approved'
                  : s.filled_how === 'assigned' ? 'assigned by the house manager' : 'first-come'}
                  {s.decided_by && ` · ${s.decided_by}`}</span>
              </p>
            ) : s.applicants.length ? (
              <ul className="mt-2 grid gap-1.5">
                {s.applicants.map((a) => {
                  /* disabled when the trainer is working then; the door refuses it */
                  const blocked = approveBlockedBy(a)
                  return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <Avatar name={a.person} size="xs" />
                    <span className="text-[12.5px] font-medium text-text-1">{a.person}</span>
                    <span className="text-[11.5px] text-text-3">
                      {a.week_hours}h that week · applied {clockOf(a.at)}
                      {a.via && a.via !== 'app' && ` · by ${a.via}`}
                    </span>
                    {a.state === 'needs_training_approval' && (
                      <Chip tint="peach">Needs training approval</Chip>
                    )}
                    <RehearsalMark on={a.rehearsal} />
                    {here ? (
                      <button className={cn(BTN, 'ml-auto bg-primary text-on-primary hover:bg-primary-hover')}
                        /* no decision while applications are open */
                        disabled={busy === a.id || Boolean(blocked) || s.state === 'open'}
                        title={blocked || (s.state === 'open'
                          ? 'Applications are still open — the decision is yours when they close' : undefined)}
                        onClick={() => act(a.id, '/hub-lanes/shift-requests/decide',
                          { ...shiftHandle(s), person: a.person },
                          `${a.person} takes the shift`)}>
                        {busy === a.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Approve
                      </button>
                    ) : (
                      <span className="ml-auto text-[11px] text-text-3">
                        {s.manager ? `${s.manager} decides` : "this house's manager decides"}
                      </span>
                    )}
                    {a.ist_ok === false && <TrainingNote training={a.training} className="w-full pl-7" />}
                  </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-1.5 text-[12px] text-text-3">
                Nobody has applied
                {s.state !== 'open' && ' — assign somebody from the house calendar'}
              </p>
            )}
            <History applicants={s.history ?? []} />
          </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[11.5px] text-text-3">
        {/* THE LIMIT IS SAID TO THE READER WHO HAS ONE. It used to be drawn
            only for somebody who manages nothing — so the one person who
            needed it, a house manager reading twelve houses they do not
            decide in, was the one who never saw it. */}
        You are reading the whole company. Approving is the house manager's — the hotline
        calendar's ** row for that house
        {feed.sees_reasons
          ? ', and yours everywhere.'
          : feed.manages.length
            ? `, which here is ${feed.manages.join(', ')}.`
            : '.'}
      </p>
    </>
  )
}

/* ── the cumulative list ─────────────────────────────────────────────────── */

function AllRequests({ feed, rows, busy, act, today, focusRef, nowMs, onOpen }: {
  feed: Feed; rows: RequestRow[]; busy: string; act: Act; today: string; focusRef: string
  nowMs: number; onOpen: (r: RequestRow) => void
}) {
  const groups = useMemo(() => groupByDay(rows), [rows])
  if (!rows.length) {
    return <EmptyState title="Nothing matches those cuts"
      body="The list keeps every request the company has ever made, settled ones included. Widen a filter to find it." />
  }
  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
            {dayLabel(g.day, today)}
          </h2>
          <ul className="grid gap-1.5">
            {g.rows.map((r) => (
              <li key={r.id} data-ref={r.ref}
                className={cn('rounded-lg border border-border bg-surface px-4 py-2.5',
                  focusRef && r.ref === focusRef && FOCUS_RING)}>
                <Row r={r} feed={feed} busy={busy} act={act} today={today} nowMs={nowMs} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Row({ r, feed, busy, act, today, nowMs, onOpen }: {
  r: RequestRow; feed: Feed; busy: string; act: Act; today: string; nowMs: number
  onOpen: (r: RequestRow) => void
}) {
  const can = actionsFor(r, feed, codeOf)
  const card = r.ref && r.kind !== 'swap' && r.kind !== 'ist_approval' ? feed.shifts?.[r.ref] : undefined
  const opens = Boolean(card) || r.kind === 'swap' || r.kind === 'ist_approval'
  // disabled when the trainer is working then; the relay refuses it
  const blocked = approveBlockedBy(r)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Avatar name={r.person || r.from_staff || '—'} size="xs" />
      <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-text-2">
        <span className="font-medium text-text-1">{r.person || r.from_staff}</span>
        {r.kind === 'swap' ? (
          <> — {r.from_staff} is giving the <span className="font-medium text-text-1">{r.shift}</span> shift
            at {r.house} on {r.col_iso} to {r.to_staff}</>
        ) : r.kind === 'ist_approval' ? (
          <> — <span className="font-medium text-text-1">{r.shift}</span> at {r.house} on {r.col_iso}</>
        ) : (
          <> — <span className="font-medium text-text-1">{r.shift}</span> at {r.house} on {r.col_iso}</>
        )}
        <span className="block text-[11px] leading-4 text-text-3">
          {KIND_LABEL[r.kind] ?? r.kind}
          {r.via === 'sms' && ' · by text'}
          {r.why && ` · ${r.why}`}
          {r.decided_by && ` · ${r.decided_by}`}
          {r.kind === 'swap' && (
            <> · staff {r.staff_state}{r.staff_via ? ` (${r.staff_via})` : ''} · manager{' '}
              {r.manager_state}{r.manager_via ? ` (${r.manager_via})` : ''} · director{' '}
              {(r.director_state ?? 'pending').replace(/_/g, ' ')}{r.director_via ? ` (${r.director_via})` : ''}</>
          )}
          {typeof r.week_hours === 'number' && r.week_hours > 0 && ` · ${r.week_hours}h that week`}
        </span>
        {/* a text that reached nobody is never "asked" */}
        {r.kind === 'swap' && r.approval && (
          <span className="block text-[11px] leading-4 text-text-2">
            {waitingLine({ state: r.state, staff_state: r.staff_state ?? '', manager_state: r.manager_state ?? '',
                           to_staff: r.to_staff ?? '', approval: r.approval, house_manager: r.house_manager ?? '',
                           why: r.why,
                           /* the third consent travels too, or the line asks for it forever */
                           director_state: r.director_state, directors: r.directors })}
            {r.approval.why && r.state === 'pending' ? ` · ${r.approval.why}` : ''}
          </span>
        )}
        {r.kind === 'swap' && r.state === 'pending' && r.asks && (
          [askLine(r.asks.staff, r.to_staff ?? ''),
           askLine(r.asks.manager, r.approval?.mode === 'above' ? 'The directors' : (r.house_manager || 'The house manager')),
           askLine(r.asks.director, r.directors?.length ? r.directors.join(' and ') : 'The director')]
            .filter(Boolean).map((line) => (
              <span key={line} className="block text-[10.5px] leading-[14px] text-text-3">{line}</span>
            ))
        )}
        {r.kind === 'swap' && r.first_shift?.needed && r.state === 'pending' && (
          <span className="flex items-start gap-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
            <GraduationCap size={11} className="mt-0.5 shrink-0" />
            {r.first_shift.request_state === 'approved'
              ? 'A first shift here — the training is approved'
              : 'A first shift here — approving the transfer takes the house manager\'s training on'}
          </span>
        )}
        {r.kind !== 'swap' && <TrainingNote training={r.training} className="mt-0.5" />}
        {r.kind === 'ist_approval' && r.state === 'approved' && (
          <span className="flex items-center gap-1 text-[11px] leading-4 text-text-3">
            <GraduationCap size={11} className="shrink-0" />
            {r.trainer ? `${r.trainer} trains` : 'Who trains was not written down on this approval'}
          </span>
        )}
        <RehearsalMark on={r.rehearsal} words className="mt-0.5" />
        {card ? <ShiftFacts card={card} nowMs={nowMs} today={today} /> : <CellFacts r={r} today={today} />}
      </span>
      <RehearsalMark on={r.rehearsal} />
      <Chip tint={STATE_TINT[r.state] ?? 'slate'}>{STATE_LABEL[r.state] ?? r.state}</Chip>
      {opens && <DetailsButton onClick={() => onOpen(r)} />}
      {can.withdraw && (
        <button className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
          disabled={busy === r.id}
          onClick={() => act(r.id, '/hub-lanes/shift-requests/withdraw',
            { request_id: r.id }, 'Taken off the list')}>
          <X size={13} /> Withdraw
        </button>
      )}
      {can.decide && (
        <button className={cn(BTN, 'bg-primary text-on-primary hover:bg-primary-hover')}
          disabled={busy === r.id || Boolean(blocked)}
          title={blocked || undefined}
          onClick={() => act(r.id, '/hub-lanes/shift-requests/decide',
            { ...shiftHandle(r), person: r.person },
            `${r.person} takes the shift`)}>
          <Check size={13} /> Approve
        </button>
      )}
      {can.training && (
        <span className="flex gap-1.5">
          <button className={cn(BTN, 'bg-primary text-on-primary hover:bg-primary-hover')}
            disabled={busy === r.id || Boolean(blocked)}
            title={blocked || undefined}
            onClick={() => act(r.id, '/hub-lanes/shift-requests/training',
              { request_id: r.id, word: 'yes' },
              r.training?.trains
                ? `Training approved — ${r.training.trains} trains`
                : 'Training approved — it is yours to own')}>
            <GraduationCap size={13} /> Approve the training
          </button>
          <button className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
            disabled={busy === r.id}
            onClick={() => act(r.id, '/hub-lanes/shift-requests/training',
              { request_id: r.id, word: 'no' },
              'Not approved — nothing moved')}>
            <X size={13} /> Not approved
          </button>
        </span>
      )}
      {/* the relay works out the side from the session */}
      {/* ONLY THE ONE TAKING THE SHIFT ACCEPTS IT: a manager and a director APPROVE, and a
          button that says "Accept" to a director tells them they are taking somebody's shift. */}
      {can.answerSwap && (
        <span className="flex gap-1.5">
          <button className={cn(BTN, 'bg-primary text-on-primary hover:bg-primary-hover')}
            disabled={busy === r.id}
            onClick={() => act(r.id, ANSWER_PATH,
              { handoff_id: r.id, word: 'yes' },
              can.answerSwap === 'staff' ? 'Shift accepted' : 'Transfer approved')}>
            <Check size={13} /> {can.answerSwap === 'staff' ? 'Accept' : 'Approve'}
          </button>
          <button className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
            disabled={busy === r.id}
            onClick={() => act(r.id, ANSWER_PATH,
              { handoff_id: r.id, word: 'no' },
              can.answerSwap === 'staff' ? 'Passed' : 'Not approved')}>
            <X size={13} /> {can.answerSwap === 'staff' ? 'Pass' : 'Not approve'}
          </button>
        </span>
      )}
      {can.withdrawSwap && (
        <button className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
          disabled={busy === r.id}
          onClick={() => act(r.id, WITHDRAW_PATH,
            { handoff_id: r.id }, 'Transfer withdrawn — the shift stays where it was')}>
          <Undo2 size={13} /> Withdraw
        </button>
      )}
    </div>
  )
}

// Who asked, who answered, when, and by which road.
function History({ applicants }: { applicants: { id: string; person: string; state: string; at: string; via: string; decided_by: string; decided_at: string; rehearsal?: boolean }[] }) {
  if (!applicants?.length) return null
  return (
    <ul className="mt-2 border-t border-border pt-1.5">
      {applicants.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-1.5 text-[11px] leading-[17px] text-text-3">
          <span>
            <span className="text-text-2">{a.person}</span>
            {' · '}{STATE_LABEL[a.state] ?? a.state}
            {' · '}{clockOf(a.at) || a.at}
            {a.via && a.via !== 'app' && ` · by ${a.via}`}
            {a.decided_by && ` · ${a.decided_by}`}
          </span>
          <RehearsalMark on={a.rehearsal} />
        </li>
      ))}
    </ul>
  )
}

/* ── the time off, joined from Calendar Builder ──────────────────────────── */

/** The time-off tab; an unreadable source says so rather than listing nobody. */
function TimeOff({ feed, rows, shown, cuts, setCuts, today, onOpen }: {
  feed: Feed; rows: TimeOffRow[]; shown: TimeOffRow[]; cuts: TimeOffCuts
  setCuts: (fn: (c: TimeOffCuts) => TimeOffCuts) => void; today: string; onOpen: (t: TimeOffRow) => void
}) {
  const choices = useMemo(() => timeOffCutsFrom(rows), [rows])
  const t = feed.time_off
  if (!t) {
    return <EmptyState title="The time off is not in this answer"
      body="The relay that answered does not join the time-off requests yet. It will once it is restarted with this version." />
  }
  if (!t.readable) {
    return (
      <p className="rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
        The time-off requests could not be read ({t.why}). This screen is not saying nobody is off.
      </p>
    )
  }
  const directorsNote = timeOffDirectorsNote(t)
  return (
    <>
      {directorsNote && (
        <p role="alert" className={cn('mb-4 rounded-lg border-2 px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1',
          t.directors_readable === false ? 'border-danger bg-danger/[0.05]' : 'border-amber-500 bg-amber-500/[0.06]')}>
          {directorsNote}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={cuts.q ?? ''} onChange={(q) => setCuts((c) => ({ ...c, q }))}
          className="w-full max-w-full sm:w-[240px]" placeholder="Search person, house…" />
        <Select value={cuts.house ?? 'all'} onChange={(house) => setCuts((c) => ({ ...c, house }))}
          all="Every house" options={choices.houses} />
        <Select value={cuts.person ?? 'all'} onChange={(person) => setCuts((c) => ({ ...c, person }))}
          all="Everybody" options={choices.people} />
        <Select value={cuts.state ?? 'all'} onChange={(state) => setCuts((c) => ({ ...c, state }))}
          all="Any state" options={choices.states} label={(s) => STATE_LABEL[s] ?? s} />
        <input type="date" value={cuts.day && cuts.day !== 'all' ? cuts.day : ''}
          aria-label="Off on this day"
          onChange={(e) => setCuts((c) => ({ ...c, day: e.target.value || 'all' }))}
          className="h-9 rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary" />
        <span className="ml-auto text-[12px] text-text-3">
          {shown.length} of {rows.length}
          {feed.whole_company ? ' · the whole company'
            : feed.manages.length ? ` · your own, and the staff of ${feed.manages.join(', ')}`
            : ' · your own'}
        </span>
      </div>
      {!shown.length ? (
        <EmptyState title={rows.length ? 'Nothing matches those cuts' : 'No time off on file'}
          body="Every time off request of the last four months and ahead appears here, with its approvals and the shifts it touches. Requests are filed and decided in the Time Off app." />
      ) : (
        <ul className="grid gap-2">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface px-4 py-3">
              <Avatar name={r.person} size="xs" />
              <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-text-2">
                <span className="font-medium text-text-1">{r.person}</span>
                {' — '}{dayLabel(r.start, today)} → {dayLabel(r.end, today)} · {r.days} day{r.days === 1 ? '' : 's'}
                <span className="block text-[11px] leading-4 text-text-3">
                  {(r.house_labels ?? r.houses).length ? (r.house_labels ?? r.houses).join(', ') : 'on no drawn calendar'}
                  {r.calendar_name && ` · calendar ${r.calendar_name}`}
                  {r.asked && ` · asked ${ohioDateTime(r.asked) || r.asked}`}
                  {r.ref && ` · ${r.ref}`}
                </span>
                <span className="block text-[11px] leading-4 text-text-3">
                  {timeOffLegLine('House manager', r.hm)} · {timeOffLegLine('Director', r.dir)}
                </span>
                <span className="block text-[11px] leading-4 text-text-3">{displacedLine(r)}</span>
              </span>
              {r.test_mode && <Chip tint="amber">Filed in test mode</Chip>}
              {r.status
                ? <Chip tint={TIME_OFF_STATUS_TINT[r.status] ?? 'slate'}>{TIME_OFF_STATUS_LABEL[r.status] ?? r.status}</Chip>
                : <Chip tint={STATE_TINT[r.state] ?? 'slate'}>{STATE_LABEL[r.state] ?? r.state}</Chip>}
              {r.link && (
                <Link to={r.link}
                  className={cn(BTN, 'border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1')}>
                  Open in Time Off
                </Link>
              )}
              <DetailsButton onClick={() => onOpen(r)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/* ── house managers and above ────────────────────────────────────────────── */

function Attendance({ feed }: { feed: Feed }) {
  const p = feed.panels
  if (!p) return null
  return (
    <div className="grid gap-4">
      {!p.readable && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500 bg-amber-500/[0.06] px-4 py-2.5 text-[12px] leading-[18px] text-text-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
          {p.why}. These panels are not saying there was nothing.
        </p>
      )}
      <Panel title="Late calls" icon={Clock}
        empty="Nobody has called to say they would be late."
        rows={p.late_calls.map((r) => ({
          key: `${r.person}|${r.day}|${r.shift}`, left: r.person,
          mid: `${r.house} · ${r.day} · ${r.shift}`,
          right: r.told_at ? `told ${r.told_at}` : r.source }))} />
      <Panel title="No show, no call" icon={AlertTriangle}
        empty="Nobody has missed a shift without saying so."
        note="Only a shift the clock was READ for, past the hour, with a name the clock knows and nothing said by a human. 'Not entered yet' is never counted here."
        rows={p.no_show_no_call.map((r) => ({
          key: `${r.person}|${r.day}|${r.shift}`, left: r.person,
          mid: `${r.house} · ${r.day} · ${r.shift}`,
          right: r.checked_at ? `checked ${clockOf(r.checked_at)}` : '' }))} />
      <Panel title="Who took the latest open shifts" icon={Users}
        empty="No open shift has been taken yet."
        rows={p.took_open.map((r) => ({
          key: `${r.location}|${r.col_iso}|${r.person}`, left: r.person,
          mid: `${r.house} · ${r.col_iso} · ${r.shift}`,
          right: `${r.how}${r.decided_by ? ` · ${r.decided_by}` : ''}` }))} />
      <Panel title="Who took the latest call-off shifts" icon={Users}
        empty="No call-off shift has been taken yet."
        rows={p.took_call_off.map((r) => ({
          key: `${r.location}|${r.col_iso}|${r.person}`, left: r.person,
          mid: `${r.house} · ${r.col_iso} · ${r.shift}`,
          right: `${r.how}${r.decided_by ? ` · ${r.decided_by}` : ''}` }))} />
    </div>
  )
}

function Panel({ title, icon: Icon, rows, empty, note }: {
  title: string; icon: typeof Clock; empty: string; note?: string
  rows: { key: string; left: string; mid: string; right: string }[]
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-2 px-4 py-2.5">
        <Icon size={14} className="text-text-3" />
        <h2 className="text-[13px] font-semibold text-text-1">{title}</h2>
        <span className="text-[12px] text-text-3">· {rows.length}</span>
      </header>
      {note && <p className="px-4 pb-2 text-[11px] leading-4 text-text-3">{note}</p>}
      {rows.length === 0 ? (
        <p className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">{empty}</p>
      ) : (
        <ul className="border-t border-border">
          {rows.slice(0, 25).map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="w-[160px] shrink-0 text-[12.5px] font-medium text-text-1">{r.left}</span>
              <span className="min-w-0 flex-1 text-[12px] text-text-2">{r.mid}</span>
              <span className="text-[11.5px] text-text-3">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
