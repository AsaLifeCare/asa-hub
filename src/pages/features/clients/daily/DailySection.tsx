// Daily — what the DSPs said about this client on the hotline, day by day.
// ONE PAGE IS ONE DAY — the little group of notes belonging to a day stands together, and paging moves to the next…
import { useMemo } from 'react'
import { CalendarDays, Clock, MapPin, User } from 'lucide-react'
import DragPerson from '@/components/shared/DragPerson'
import Pager from '@/components/shared/Pager'
import { ohioTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import type { DailyNote, DoorReason } from './dailyApi'
import { useClientDaily } from './useClientDaily'
import { type DailyLook, useDailyPlace } from './useDailyPlace'
import {
  type DailyCall,
  DAILY_FILTERS, callTimeDisputedLine, categoryLabel, countNotes, dayCountLine, dayPagerNoun,
  nearLine, nearSpellings, scheduleReadOf, similarLine, unmatchedLine,
} from './grouping'

type Look = DailyLook

const LOOKS: Record<Look, {
  loading: string
  empty: string
  note: string
  retry: string
  day: string
  dayCount: string
  /** the bounded area the day's reports scroll inside — see the header note */
  box: string
  call: string
  // the report's own header, stuck to the top of the box while its notes scroll under it — it carries the box's own…
  callHead: string
  /** the report's notes, under that header */
  callBody: string
  head: string
  icon: number
  chip: string
  pill: string
  text: string
  muted: string
  tab: string
}> = {
  record: {
    loading: 'text-[14px] text-text-3',
    empty: 'text-[13.5px] text-text-3',
    note: 'rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-3',
    retry: 'rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-text-2 hover:bg-surface-2',
    day: 'flex items-center gap-2 text-[13px] font-semibold text-text-2',
    dayCount: 'text-[12.5px] font-normal text-text-3',
    box: 'scroll-thin max-h-[440px] space-y-2 overflow-y-auto rounded-lg border border-border p-2',
    call: 'rounded-md bg-surface-2',
    callHead: 'sticky top-0 z-10 rounded-t-md bg-surface-2 px-3 pb-1.5 pt-2.5',
    callBody: 'space-y-1.5 px-3 pb-2.5',
    head: 'text-[13px] text-text-2',
    icon: 14,
    chip: 'rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] text-text-3',
    pill: 'rounded-full bg-tint-amber px-2.5 py-0.5 text-[11.5px] font-medium text-tint-fg-amber',
    text: 'text-[13.5px] leading-6 text-text-2',
    muted: 'text-[12.5px] text-text-3',
    tab: 'px-3 py-1 text-[12.5px]',
  },
  unique: {
    loading: 'text-[13.5px] text-text-3',
    empty: 'text-[13px] text-text-3',
    note: 'rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text-3',
    retry: 'rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-text-2 hover:bg-surface-3',
    day: 'flex items-center gap-1.5 text-[12px] font-semibold tabular-nums text-text-3',
    dayCount: 'text-[11.5px] font-normal text-text-3',
    box: 'scroll-thin max-h-[360px] space-y-2 overflow-y-auto rounded-lg border border-border p-2',
    call: 'rounded-md bg-surface',
    callHead: 'sticky top-0 z-10 rounded-t-md bg-surface px-3 pb-1.5 pt-2',
    callBody: 'space-y-1.5 px-3 pb-2',
    head: 'text-[12.5px] text-text-2',
    icon: 13,
    chip: 'rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-text-3',
    pill: 'rounded-full bg-tint-amber px-2 py-0.5 text-[10.5px] font-medium text-tint-fg-amber',
    text: 'text-[13px] leading-5 text-text-2',
    muted: 'text-[12px] text-text-3',
    tab: 'px-2.5 py-1 text-[12px]',
  },
}

const NO_NOTES: DailyNote[] = []
const NO_CLIENTS: readonly string[] = []

/** The relay's sentence, ending as a sentence ends. */
function sentence(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

// What a refusal or a failure says, picked by the status first and the door's reason second.
function troubleOf(status: number, reason: DoorReason | '', client: string): { says: string; retry: boolean } {
  if (status === 401) {
    return { says: 'Your session has ended — sign in again to read the daily notes.', retry: false }
  }
  if (status === 403) {
    switch (reason) {
      case 'session':
        return {
          says: 'This account is not in the access record yet, so the daily notes stay closed — try again later; signing in again will not change it.',
          retry: true,
        }
      case 'restricted':
        return { says: 'The daily notes are not open to this account.', retry: false }
      case 'stale':
        return {
          says: 'Access to the daily notes could not be checked just now — the access record is too old to vouch for it.',
          retry: true,
        }
      case 'unreadable':
        return {
          says: 'Access to the daily notes could not be checked just now — the access record could not be read.',
          retry: true,
        }
      default:
        return { says: 'The daily notes are not open to your badge.', retry: false }
    }
  }
  if (status === 503) {
    return { says: 'The daily notes could not be read just now.', retry: true }
  }
  if (status === 404) {
    return { says: `The daily notes door does not find ${client} in the client list.`, retry: true }
  }
  return { says: 'The daily notes could not be read.', retry: true }
}

// @param clients every client's name as the clients slice spells it — how a spelling close to this client is told…
export default function DailySection({ client, look, clients = NO_CLIENTS }: {
  client: string
  look: Look
  clients?: readonly string[]
}) {
  const L = LOOKS[look]
  const { state, retry } = useClientDaily(client, true)

  const notes = state.phase === 'ok' ? state.data.notes : NO_NOTES
  const schedule = scheduleReadOf(state.phase === 'ok' ? state.data.sources.schedule : undefined)
  const spellings = state.phase === 'ok' ? state.data.unmatched.spellings : null
  const counts = useMemo(() => countNotes(notes), [notes])
  const near = useMemo(() => nearSpellings(spellings, client, clients), [spellings, client, clients])
  // the filter and the page outlive this section, which the accordion (Unique) and the dropdown (Record) unmount…
  const { filter, setFilter, days, pager } = useDailyPlace(look, client, notes, schedule)

  const retryButton = (
    <button type="button" onClick={retry} className={L.retry}>
      Try again
    </button>
  )

  if (state.phase === 'off' || state.phase === 'loading') {
    return <p className={L.loading}>Reading the daily notes…</p>
  }

  if (state.phase === 'error') {
    const t = troubleOf(state.status, state.reason, client)
    const relay = sentence(state.message)
    return (
      <div className="space-y-2">
        <p className={L.note}>
          {t.says}
          {relay && relay !== t.says ? <span className="mt-1 block text-[12px] text-text-3">{relay}</span> : null}
        </p>
        {t.retry && retryButton}
      </div>
    )
  }

  const { sources, unmatched } = state.data
  const problems: string[] = []
  if (!sources.notes?.ok) {
    problems.push(sources.notes?.error
      ? `The daily notes book could not be read — ${sentence(sources.notes.error)}`
      : 'The door did not say whether the daily notes book was read.')
  }
  if (!sources.clients?.ok) {
    problems.push(sources.clients?.error
      ? `The client list could not be read — ${sentence(sources.clients.error)} Notes that name ${client} may be missing here.`
      : `The door did not say whether the client list was read, so notes that name ${client} may be missing here.`)
  }
  // a read again may bring back what failed; a schedule copy that keeps failing is said once, with no button that…
  const retryable = problems.length > 0 || schedule === 'unread'
  if (schedule === 'partial') {
    // the relay's own sentence already says which copies failed and what it did
    problems.push(sources.schedule?.error
      ? `Part of the schedule could not be read — ${sentence(sources.schedule.error)}`
      : 'Part of the schedule could not be read, so a shift only the missing part holds shows by call time.')
  } else if (schedule === 'unread') {
    problems.push(sources.schedule?.error
      ? `The schedule could not be read — ${sentence(sources.schedule.error)} Shifts are placed by call time.`
      : 'The schedule could not be read, so shifts are placed by call time.')
  }
  const everyoneRead = !!sources.notes?.ok && !!sources.clients?.ok
  const unmatchedRows = unmatched.rows ?? 0
  const nearRows = near.reduce((a, s) => a + s.rows, 0)

  return (
    <div className="space-y-3">
      {problems.length > 0 && (
        <div className="space-y-2">
          {problems.map((p) => <p key={p} className={L.note}>{p}</p>)}
          {retryable && retryButton}
        </div>
      )}

      {near.length > 0 && <p className={L.note}>{nearLine(near)}</p>}

      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Which daily notes" className="inline-flex items-center gap-0.5 rounded-full bg-surface-3 p-0.5">
            {DAILY_FILTERS.map((f) => {
              const active = f.id === filter
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full font-medium transition-colors',
                    L.tab,
                    active ? 'bg-surface text-text-1 shadow-1' : 'text-text-3 hover:text-text-2',
                  )}
                >
                  {f.label}
                  <span className={cn('tabular-nums', active ? 'text-text-2' : 'text-text-3')}>
                    {counts[f.id].toLocaleString('en-US')}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!notes.length ? (
        everyoneRead ? <p className={L.empty}>No note was matched to {client} by name.</p> : null
      ) : !days.length ? (
        <p className={L.empty}>
          {filter === 'daily'
            ? `No note naming ${client} is a daily status note.`
            : `Every note naming ${client} is a daily status note.`}
        </p>
      ) : (
        <div className="space-y-3">
          {pager.slice.map((d) => (
            <section key={d.day || 'undated'} className="space-y-2">
              {/* the day's header stays out of the scrolling area, so the date
                  a reader is on is still on screen at the bottom of a long day */}
              <p className={L.day}>
                <CalendarDays size={L.icon} className="shrink-0 text-text-3" />
                {d.title}
                <span className={L.dayCount}>{dayCountLine(d)}</span>
              </p>
              <div className={L.box}>
                {d.calls.map((c) => <CallBlock key={c.key} call={c} client={client} look={look} />)}
              </div>
            </section>
          ))}
          {/* "days", NOT "notes": the filter tabs directly above count NOTES
              (one row per thing said) and this counts the DAYS the pager walks.
              `dayPagerNoun` is what keeps that honest on the last page, which
              may be the notes the book gave no day for and is not a day. */}
          <Pager {...pager} onPage={pager.setPage} noun={dayPagerNoun(days)} />
        </div>
      )}

      {unmatchedRows > 0 && <p className={L.muted}>{unmatchedLine(unmatchedRows, client, nearRows)}</p>}
    </div>
  )
}

function CallBlock({ call, client, look }: { call: DailyCall; client: string; look: Look }) {
  const L = LOOKS[look]
  const s = call.shift
  // THE TIME IS ON THE SCREEN, not in a tooltip.
  const disputed = call.readings > 1
  const fromDisputedClock = disputed && s.byCallTime
  const calledAt = disputed || !call.callAt ? '' : ohioTime(call.callAt)
  const timeSaid = calledAt ? `Called ${calledAt}` : call.readings === 0 ? 'Time not recorded' : ''
  const shiftText = fromDisputedClock ? '' : [s.label, s.window, s.began].filter(Boolean).join(' · ')
  const when = [timeSaid, shiftText].filter(Boolean).join(' · ')
  return (
    <div className={L.call}>
      <div className={L.callHead}>
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', L.head)}>
          {when ? (
            <span className="flex items-center gap-1.5">
              <Clock size={L.icon} className="shrink-0 text-text-3" />
              {when}
            </span>
          ) : null}
          <span className="flex min-w-0 items-center gap-1.5">
            <User size={L.icon} className="shrink-0 text-text-3" />
            {call.dsp ? (
              <DragPerson name={call.dsp} id={call.dsp} type="staff" subtitle={`Daily note · ${client}`}>
                {call.dsp}
              </DragPerson>
            ) : (
              <span className="text-text-3">DSP not named</span>
            )}
          </span>
          {s.elsewhere ? (
            <span className="flex items-center gap-1.5">
              <MapPin size={L.icon} className="shrink-0 text-text-3" />
              at {s.elsewhere}
            </span>
          ) : null}
          {s.hedge && !fromDisputedClock ? <span className="text-text-3">{s.hedge}</span> : null}
          {s.bySpelling ? <span className="text-text-3">schedule name matched by spelling</span> : null}
        </div>
        {disputed ? (
          <p className={cn('mt-1', L.muted)}>{callTimeDisputedLine(call.readings, s.byCallTime)}</p>
        ) : null}
        {call.similar ? <p className={cn('mt-1', L.muted)}>{similarLine(call.similar.writtenAs)}</p> : null}
      </div>
      <div className={L.callBody}>
        {call.notes.map((n) => {
          const notDaily = n.kind === 'not_daily'
          return (
            <div
              key={n.id}
              className={cn('border-l-[3px] py-0.5 pl-2.5', notDaily ? 'border-l-tint-fg-amber' : 'border-l-border')}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={L.chip}>{categoryLabel(n)}</span>
                {notDaily ? <span className={L.pill}>Not daily</span> : null}
              </div>
              {n.response ? (
                <p className={cn('mt-1 whitespace-pre-line', L.text)}>{n.response}</p>
              ) : (
                <p className={cn('mt-1', L.muted)}>The note carries no words.</p>
              )}
              {n.client_match === 'similar' && !call.similar ? (
                <p className={cn('mt-0.5', L.muted)}>{similarLine(n.written_as)}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
