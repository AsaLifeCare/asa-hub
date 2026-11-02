// SWAPS — a tab of Calendar Builder, beside Builder, Houses, Staff Schedule and Requests.
// THE SHIFT IS PICKED FIRST, and everything else follows from it: the shift names the house, the house names the…
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowRightLeft, Check, Loader2, Lock, MessageSquare, Printer, RefreshCw,
  Search, Share2, ShieldCheck, Undo2, X,
} from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SearchInput from '@/components/shared/SearchInput'
import ExportMenu from '@/components/shared/ExportMenu'
import EmptyState from '@/components/shared/EmptyState'
import Avatar from '@/components/shared/Avatar'
import { share } from '@/stores/useShareStore'
import { toast } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { onLiveEvent } from '@/lib/snapshotClient'
import { ohioDateTime, ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { useBuilderRefresh } from '@/pages/features/calendarbuilder/builderRefresh'
import { HOUSECAL_LIVE_EVENT } from './houseCalTypes'
import { LaneError, lane, post } from './laneFetch'
import { ANSWER_PATH, OFFER_PATH, WITHDRAW_PATH, candidatesUrl } from './handoffActions'
import TrainingNote from './TrainingNote'
import RehearsalMark from './RehearsalMark'
import {
  ABOVE_ONE, candidateTags, splitCandidates, waitingLine,
  type HandoffView, type MyShift, type TransferCandidate, type TransferList,
} from './requestsLogic'
import {
  EACH_DOOR_LINE, SWAP_EXPORT_COLUMNS, checksFor, dayWords, directorSeat, directorsWarning, filterSwaps, seatsOf,
  shiftLabel,
  stillOwed, swapCutsFrom, swapExportRows,
  type Seat, type SwapCuts, type SwapsFeed,
} from './swapsLogic'

export const SWAPS_PATH = '/hub-lanes/shift-handoff/swaps'

const BTN = 'flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all disabled:opacity-50'
const ICON_BTN = 'grid h-9 w-9 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'
const FIELD = 'h-9 w-full rounded-md border border-border bg-surface px-2 text-[12.5px] text-text-1 outline-none focus:border-primary'

/** One labelled row of the form: the label on the left, the value on the right. */
function Field({ label, children, note }: {
  label: string; children: React.ReactNode; note?: React.ReactNode
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-text-3">{label}</span>
      <div className="min-w-0">
        {children}
        {note}
      </div>
    </div>
  )
}

/** A name the screen did not choose and cannot change: the lock says why. */
function Locked({ name, pill, why }: { name: string; pill: string; why?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Lock size={12} className="shrink-0 text-text-3" />
      {name ? <Avatar name={name} size="xs" /> : null}
      <span className="text-[13px] text-text-1">{name || '—'}</span>
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold text-text-3">{pill}</span>
      {why && <span className="w-full text-[11px] leading-4 text-text-3">{why}</span>}
    </div>
  )
}

export default function ShiftSwapsPage({ embedded, initial }: {
  embedded?: boolean
  /** a feed already read (the tests draw the screen with one) */
  initial?: SwapsFeed
} = {}) {
  const [feed, setFeed] = useState<SwapsFeed | null>(initial ?? null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')
  const today = useMemo(() => ohioToday(), [])

  /** One read at a time: a ring that arrives mid-read is read once more after. */
  const reading = useRef({ busy: false, again: false })
  const load = useCallback(() => {
    const r = reading.current
    if (r.busy) { r.again = true; return }
    r.busy = true
    lane<SwapsFeed>(SWAPS_PATH)
      .then((d) => { setFeed(d); setFailed('') })
      // A screen that cannot read says so; it never draws an empty list from a failed read.
      .catch((err) => setFailed(err instanceof Error ? err.message : 'could not be read'))
      .finally(() => {
        r.busy = false
        if (r.again) { r.again = false; load() }
      })
  }, [])

  useEffect(() => { load() }, [load])
  useBuilderRefresh(load)
  useEffect(() => {
    const offRing = onLiveEvent(HOUSECAL_LIVE_EVENT, load)
    const offOpen = onLiveEvent('open', load)
    return () => { offRing(); offOpen() }
  }, [load])
  useEffect(() => {
    const every = setInterval(load, 30_000)
    return () => clearInterval(every)
  }, [load])

  const act = useCallback(async (key: string, path: string, body: unknown, said: string) => {
    setBusy(key)
    try {
      // AN ANSWER THE RELAY DID NOT RECORD IS NOT AN ANSWER: the door says 200 with `changed: false` when that…
      const got = await post<{ changed?: boolean }>(path, body)
      if (got && got.changed === false) {
        toast({ type: 'warning', title: 'Nothing was recorded',
                body: 'That answer had already been given — the swap keeps the name that gave it.' })
      } else {
        toast({ type: 'success', title: said })
      }
      load()
      void useNotificationStore.getState().fetchAll({ force: true })
    } catch (err) {
      toast({ type: 'danger', title: 'Not done',
              body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }, [load])

  const [cuts, setCuts] = useState<SwapCuts>({ q: '', house: 'all', person: 'all', state: 'all' })
  const history = feed?.history ?? []
  const shown = useMemo(() => filterSwaps(history, cuts), [history, cuts])
  const choices = useMemo(() => swapCutsFrom(history), [history])
  const waiting = useMemo(
    () => history.filter((h) => h.state === 'pending'
      && (h.mine || h.may_accept || h.may_approve || h.may_approve_director || h.may_withdraw)),
    [history],
  )
  const out = useMemo(() => swapExportRows(shown), [shown])

  const outputs = (
    <>
      <ExportMenu filename="shift-swaps" columns={SWAP_EXPORT_COLUMNS} rows={out} />
      <button type="button" aria-label="Share this view" title="Share this view" className={ICON_BTN}
        onClick={() => share({
          title: 'Swaps', subtitle: `${out.length} swap${out.length === 1 ? '' : 's'} — as shown on screen`,
          rows: out, columns: SWAP_EXPORT_COLUMNS, filename: 'shift-swaps', icon: 'arrow-right-left',
        })}>
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
          title="Swaps"
          subtitle="Hand a shift to somebody else — the one taking it, the house manager and the director each say yes"
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
        <div className="mb-3 flex items-center justify-end gap-1">{outputs}</div>
      )}

      {failed && (
        <p className="mb-3 rounded-lg border-2 border-danger bg-danger/[0.05] px-4 py-2.5 text-[12.5px] leading-[18px] text-text-1">
          The swaps could not be read ({failed}). This screen is not saying there are none.
        </p>
      )}
      {feed === null && !failed && (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Reading the company&apos;s swaps…
        </p>
      )}

      {feed && (
        <div className="grid gap-4 lg:grid-cols-2">
          <HandItOver feed={feed} today={today} onOffered={load} />
          <WaitingOn feed={feed} rows={waiting} busy={busy} act={act} />
        </div>
      )}

      {feed && (
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold text-text-1">
            Every swap in the company
            <span className="ml-2 text-[12px] font-normal text-text-3">
              {shown.length} of {history.length}
              {feed.whole_company ? ' · the whole company' : ' · what your badge allows'}
            </span>
          </h2>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={cuts.q ?? ''} onChange={(q) => setCuts((c) => ({ ...c, q }))}
              className="w-full max-w-full sm:w-[260px]" placeholder="Search person, house, shift…" />
            <Select value={cuts.house ?? 'all'} onChange={(house) => setCuts((c) => ({ ...c, house }))}
              all="Every house" options={choices.houses} />
            <Select value={cuts.person ?? 'all'} onChange={(person) => setCuts((c) => ({ ...c, person }))}
              all="Everybody" options={choices.people} />
            <Select value={cuts.state ?? 'all'} onChange={(state) => setCuts((c) => ({ ...c, state }))}
              all="Any state" options={choices.states}
              label={(s) => (s === 'pending' ? 'Waiting' : s === 'done' ? 'Done' : 'Ended')} />
          </div>
          <History rows={shown} today={today} total={history.length} />
        </section>
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

/* ── card one: hand a shift to somebody else ─────────────────────────────── */

function HandItOver({ feed, today, onOffered }: {
  feed: SwapsFeed; today: string; onOffered: () => void
}) {
  /** the reader's own shifts first, then the shifts of the houses they manage */
  const shifts = useMemo(() => {
    const mine = feed.my_shifts.filter((s) => s.may_transfer)
    const theirs = feed.house_shifts.filter(
      (s) => s.may_transfer && !mine.some((m) => m.location === s.location && m.col_iso === s.col_iso
        && m.employee === s.employee))
    return [...mine, ...theirs]
  }, [feed])
  const [key, setKey] = useState('')
  const picked = useMemo(() => shifts.find((s) => cellKey(s) === key) ?? null, [shifts, key])
  const [list, setList] = useState<TransferList | null>(null)
  const [listWhy, setListWhy] = useState('')
  /** the relay's own word for why the SHIFT was refused, so the checks can say which failed */
  const [listCode, setListCode] = useState('')
  const [q, setQ] = useState('')
  const [taker, setTaker] = useState<TransferCandidate | null>(null)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState('')

  /** somebody else's shift is opened as that house's manager, so the giver travels */
  const otherPersons = Boolean(picked && picked.employee && picked.employee !== feed.me)

  useEffect(() => {
    setList(null); setListWhy(''); setListCode(''); setTaker(null); setRefusal(''); setQ('')
    if (!picked) return
    let live = true
    lane<TransferList>(candidatesUrl(picked.location, picked.col_iso,
      otherPersons ? picked.employee : ''))
      .then((d) => { if (live) setList(d) })
      // A LIST THAT COULD NOT BE READ IS SAID — never drawn as "nobody can take it".
      .catch((err) => {
        if (!live) return
        setListWhy(err instanceof Error ? err.message : 'the server did not answer')
        setListCode(err instanceof LaneError ? err.reason : '')
      })
    return () => { live = false }
  }, [picked, otherPersons])

  const checks = checksFor(taker, list?.ist, listCode)
  const seat = directorSeat(list?.directors ?? feed.directors)
  const manager = list?.approval.names.join(' or ')
    || (list?.approval.mode === 'above' ? ABOVE_ONE : '')

  const askAll = async () => {
    if (!picked || !taker || sending) return
    setSending(true)
    setRefusal('')
    try {
      await post<HandoffView>(OFFER_PATH, {
        location: picked.location, col_iso: picked.col_iso, to_staff: taker.name,
        ...(otherPersons ? { from_staff: picked.employee } : {}),
      })
      // WHAT LEFT IS NOT WHAT ARRIVED: test mode, the quiet window or a switched-off situation may hold a text, so…
      toast({ type: 'success', title: 'Opened',
              body: 'The asks go out through Smart Comms. The shift stays where it is until all three say yes.' })
      setKey(''); setTaker(null)
      onOffered()
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : 'Try again.')
    } finally {
      setSending(false)
    }
  }

  const free = list ? splitCandidates(list.candidates, q).free : []
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-label="Hand a shift to somebody else">
      <h2 className="text-[13px] font-semibold text-text-1">Hand a shift to somebody else</h2>
      {feed.my_shifts_why && (
        <p className="mt-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[11.5px] leading-4 text-text-1">
          {feed.my_shifts_why}. This is not saying you have none.
        </p>
      )}
      {feed.house_shifts_why && (
        <p className="mt-2 rounded-md border border-amber-500 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] leading-4 text-text-2">
          {feed.house_shifts_why}.
        </p>
      )}

      <div className="mt-3 grid gap-3">
        <Field label="The shift">
          <select value={key} onChange={(e) => setKey(e.target.value)} className={FIELD}
            aria-label="The shift to hand over">
            <option value="">Pick a shift…</option>
            {shifts.map((s) => (
              <option key={cellKey(s)} value={cellKey(s)}>
                {shiftLabel(s, today)}{s.employee && s.employee !== feed.me ? ` · ${s.employee}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="From"
          note={picked ? (
            <span className="mt-0.5 block text-[11px] leading-4 text-text-3">from the shift</span>
          ) : undefined}>
          {picked ? (
            <span className="flex items-center gap-2">
              <Avatar name={picked.employee || feed.me} size="xs" />
              <span className="text-[13px] text-text-1">{picked.employee || feed.me}</span>
            </span>
          ) : <span className="text-[12.5px] text-text-3">the shift names them</span>}
        </Field>

        <Field label="To">
          {!picked ? (
            <span className="text-[12.5px] text-text-3">pick a shift first</span>
          ) : listWhy ? (
            <span className="flex items-start gap-1.5 text-[12px] leading-4 text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Who can take it could not be read — {listWhy}.
            </span>
          ) : !list ? (
            <span className="flex items-center gap-1.5 text-[12px] text-text-3">
              <Loader2 size={13} className="animate-spin" /> Finding who can take it…
            </span>
          ) : (
            <>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
                <input value={taker ? taker.name : q} readOnly={Boolean(taker)}
                  onChange={(e) => setQ(e.target.value)} placeholder="Search a name…"
                  aria-label="Who takes the shift"
                  className={cn(FIELD, 'pl-7', taker && 'font-semibold')} />
                {taker && (
                  <button type="button" aria-label="Pick somebody else"
                    onClick={() => { setTaker(null); setQ('') }}
                    className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
                    <X size={13} />
                  </button>
                )}
              </div>
              {!taker && (
                free.length === 0 ? (
                  <p className="mt-1.5 text-[12px] leading-5 text-text-2">
                    {q ? 'Nobody by that name can take it.' : 'Nobody can take this shift right now.'}
                  </p>
                ) : (
                  <ul className="scroll-thin mt-1.5 grid max-h-[180px] gap-1 overflow-y-auto pr-0.5"
                    role="listbox" aria-label="People who can take it">
                    {free.map((c) => (
                      <li key={c.name}>
                        <button type="button" role="option" aria-selected={false}
                          onClick={() => { setTaker(c); setRefusal('') }}
                          className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left hover:bg-surface-2">
                          <Avatar name={c.name} size="xs" />
                          <span className="min-w-0">
                            <span className="clamp-1 block text-[12px] font-medium text-text-1">{c.name}</span>
                            {candidateTags(c, list.house).map((t) => (
                              <span key={t} className={cn('clamp-1 block text-[10.5px] leading-[14px]',
                                t.startsWith('first shift') ? 'text-amber-700 dark:text-amber-400' : 'text-text-3')}>
                                {t}
                              </span>
                            ))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
              {taker?.needs_training && <TrainingNote training={taker.training} className="mt-1" />}
            </>
          )}
        </Field>

        <Field label="House manager">
          <Locked name={manager} pill="automatic · the house"
            why={list?.approval.why} />
        </Field>

        <Field label="Director">
          <Locked name={seat.name} pill="automatic · the list" why={seat.why} />
        </Field>
      </div>

      {/* the three refusals, run by the relay BEFORE anybody is asked */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
        {checks.map((c) => (
          <li key={c.key}
            className={cn('flex items-center gap-1 text-[11.5px]',
              c.ok === true ? 'text-mint-700 dark:text-mint-400'
                : c.ok === false ? 'text-danger' : 'text-text-3')}
            title={c.why || undefined}>
            {c.ok === true ? <Check size={11} /> : c.ok === false ? <X size={11} /> : <ShieldCheck size={11} />}
            {c.label}
          </li>
        ))}
      </ul>
      {checks.some((c) => c.why && c.ok !== true) && (
        <p className="mt-1 text-[11px] leading-4 text-text-3">
          {checks.filter((c) => c.why && c.ok !== true).map((c) => c.why).join(' · ')}
        </p>
      )}

      <button type="button" onClick={() => void askAll()}
        disabled={!picked || !taker || sending || !seat.askable}
        className={cn(BTN, 'mt-3 h-9 w-full justify-center bg-primary text-on-primary hover:bg-primary-hover')}>
        {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
        Ask all three
      </button>
      <p className="mt-1.5 text-[11px] leading-4 text-text-3">
        Nothing moves on the calendar yet. The one taking it, the house manager and the director are
        asked at once — here, and through Smart Comms — and the shift moves when all three have said yes.
      </p>
      {refusal && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Not asked — {refusal}
        </p>
      )}
    </section>
  )
}

function cellKey(s: MyShift): string {
  return `${s.location}|${s.col_iso}|${s.employee}`
}

/* ── card two: waiting on ────────────────────────────────────────────────── */

type Act = (key: string, path: string, body: unknown, said: string) => void

const SEAT_TINT: Record<Seat['state'], string> = {
  agreed: 'bg-tint-mint text-tint-fg-mint',
  refused: 'bg-tint-pink text-tint-fg-pink',
  waiting: 'bg-tint-amber text-tint-fg-amber',
  asked: 'bg-surface-2 text-text-3',
  none: 'bg-surface-2 text-text-3',
}

function WaitingOn({ feed, rows, busy, act }: {
  feed: SwapsFeed; rows: HandoffView[]; busy: string; act: Act
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-label="Waiting on">
      <h2 className="text-[13px] font-semibold text-text-1">Waiting on</h2>
      {!rows.length ? (
        <EmptyState title="No swap of yours is waiting"
          body="A swap you opened, one you were offered, and one waiting on your approval all appear here, with what each of the four has said." />
      ) : (
        <ul className="mt-3 grid gap-3">
          {rows.map((h) => (
            <li key={h.id} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[12.5px] leading-5 text-text-1">
                <span className="font-semibold">{h.from_staff}</span> hands the{' '}
                <span className="font-semibold">{h.value}</span> shift at {h.house} on {h.col_iso} to{' '}
                <span className="font-semibold">{h.to_staff}</span>.
              </p>
              <RehearsalMark on={h.rehearsal} words className="mt-1" />
              <p className="mt-0.5 text-[11.5px] leading-4 text-text-2">{stillOwed(h)}</p>
              {h.state === 'pending' && h.why && (
                <p className="mt-0.5 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                  {h.why.charAt(0).toUpperCase() + h.why.slice(1)}.
                </p>
              )}
              <ul className="mt-2 grid gap-1">
                {seatsOf(h).map((s) => (
                  <li key={s.role} className="flex flex-wrap items-center gap-2">
                    <Avatar name={s.name} size="xs" />
                    <span className="min-w-0 flex-1 text-[12px] text-text-1">
                      {s.name}
                      <span className="text-text-3"> · {s.part}</span>
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', SEAT_TINT[s.state])}>
                      {s.line}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-text-3">
                <MessageSquare size={11} className="mt-0.5 shrink-0" /> {EACH_DOOR_LINE}
              </p>
              <p className="mt-1 text-[10.5px] text-text-3">Ref {h.id}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(h.may_accept || h.may_approve || h.may_approve_director) && (
                  <>
                    <button disabled={busy === h.id} className={cn(BTN, 'bg-primary text-on-primary hover:bg-primary-hover')}
                      onClick={() => act(h.id, ANSWER_PATH, { handoff_id: h.id, word: 'yes' },
                        h.may_accept ? 'Shift accepted' : 'Approved')}>
                      {busy === h.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      {h.may_accept ? 'Accept' : 'Approve'}
                    </button>
                    <button disabled={busy === h.id} className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
                      onClick={() => act(h.id, ANSWER_PATH, { handoff_id: h.id, word: 'no' },
                        h.may_accept ? 'Passed' : 'Not approved')}>
                      <X size={13} /> {h.may_accept ? 'Pass' : 'Not approve'}
                    </button>
                  </>
                )}
                {h.may_withdraw && (
                  <button disabled={busy === h.id} className={cn(BTN, 'border border-border bg-surface text-text-1 hover:bg-surface-2')}
                    onClick={() => act(h.id, WITHDRAW_PATH, { handoff_id: h.id },
                      'Swap withdrawn — the shift stays where it was')}>
                    <Undo2 size={13} /> Withdraw
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {directorsWarning(feed.directors) && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-500 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] leading-4 text-text-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          {directorsWarning(feed.directors)}
        </p>
      )}
    </section>
  )
}

/* ── the company's swaps, newest first ───────────────────────────────────── */

function History({ rows, today, total }: { rows: HandoffView[]; today: string; total: number }) {
  if (!rows.length) {
    return <EmptyState title={total ? 'Nothing matches those cuts' : 'No swap on the books'}
      body="Every swap the company has made stays here with what each of the four said, so a swap is never only in somebody's inbox." />
  }
  return (
    <ul className="grid gap-1.5">
      {rows.map((h) => (
        <li key={h.id} className="rounded-lg border border-border bg-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="w-[90px] shrink-0 text-[12.5px] font-semibold text-text-1">
              {dayWords(h.col_iso, today)}
            </span>
            <span className="w-[100px] shrink-0 text-[12.5px] text-text-2">{h.house}</span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-text-2">
              <span className="font-medium text-text-1">{h.from_staff}</span> → {' '}
              <span className="font-medium text-text-1">{h.to_staff}</span>
              <span className="text-text-3"> · {h.value}</span>
              <RehearsalMark on={h.rehearsal} className="ml-1.5" />
              <span className="block text-[11px] leading-4 text-text-3">
                {waitingLine(h)}
                {h.created_at ? ` · opened ${ohioDateTime(h.created_at) || h.created_at}` : ''}
              </span>
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
              h.state === 'done' ? 'bg-tint-mint text-tint-fg-mint'
                : h.state === 'dead' ? 'bg-tint-pink text-tint-fg-pink'
                  : 'bg-tint-amber text-tint-fg-amber')}>
              {h.state === 'done' ? 'Done' : h.state === 'dead' ? 'Ended' : 'Waiting'}
            </span>
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[4px]">
            {seatsOf(h).map((s) => (
              <li key={s.role} className="text-[10.5px] leading-4 text-text-3">
                <span className="text-text-2">{s.name}</span> · {s.part} · {s.line}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
