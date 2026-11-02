// Activity: what happened around this person, in five views — the Timeline (notes, ISTs, requirements, uploads…
// A stretch no store holds anything for is drawn as a gap with its dates, never as silence.
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarCheck, CalendarDays, ClipboardCheck, Eye, FileCheck2, FileUp, GraduationCap, Loader2, Lock, NotebookPen,
  PhoneCall, Siren, type LucideIcon,
} from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { ohioTime } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import {
  ACTIVITY_VIEWS, SHIFT_SOURCE_LABEL, activityOf, callsByDay, counterpartLabel, dateWords, hoursWords, olderCursor, patternWords,
  readRefusal, secsWords, sectionWords, shiftsOf, spanWords, stampWords, textsOf, threadItems, threadOrder, transcriptsOf,
  type ActivityEvent, type ActivityKind, type ActivityView, type RosterRow, type StaffActivity, type StaffAsk, type StaffShifts,
  type StaffTexts, type StaffTranscripts, type TextMessage,
} from '../staffModel'
import {
  readActivity, readKey, readShifts, readTexts, readTranscripts, useStaffRead, type ReadState,
} from '../useStaffRead'
import { EmptyNote, ReadLine, WhyNote } from '../StaffParts'

export default function ActivitySection({ row, view, onView, onAsk }: {
  row: RosterRow
  view: ActivityView
  onView: (view: ActivityView) => void
  onAsk: (ask: StaffAsk) => void
}) {
  const wantsActivity = view === 'timeline' || view === 'visits'
  const activity = useStaffRead(wantsActivity ? readKey('staffProfileActivity', row.key) : null, () => readActivity(row.key), activityOf)
  const shifts = useStaffRead(view === 'shifts' ? readKey('staffProfileShifts', row.key) : null, () => readShifts(row.key), shiftsOf)
  const transcripts = useStaffRead(view === 'transcripts' ? readKey('staffProfileTranscripts', row.key) : null,
    () => readTranscripts(row.key), transcriptsOf)
  const [category, setCategory] = useState('')
  return (
    <div className="grid gap-4" data-activity={view}>
      <ViewTabs view={view} onView={onView} />
      {view === 'timeline' && <TimelineView activity={activity} onRetry={activity.reload} />}
      {view === 'visits' && <VisitsView activity={activity} onRetry={activity.reload} />}
      {view === 'shifts' && <ShiftsView shifts={shifts} onRetry={shifts.reload} />}
      {view === 'texts' && <TextsPane staff={row.key} />}
      {view === 'transcripts' && (
        <TranscriptsView transcripts={transcripts} category={category} onCategory={setCategory}
          onOpen={(id) => onAsk({ kind: 'transcript', id })} onRetry={transcripts.reload} />
      )}
    </div>
  )
}

export function ViewTabs({ view, onView }: { view: ActivityView; onView: (view: ActivityView) => void }) {
  return (
    <div role="tablist" aria-label="Activity" className="scroll-thin flex gap-1.5 overflow-x-auto pb-1" data-views="">
      {ACTIVITY_VIEWS.map((v) => {
        const on = v.id === view
        return (
          <button key={v.id} type="button" role="tab" aria-selected={on} onClick={() => onView(v.id)} data-view={v.id}
            className={cn('shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition-colors',
              on ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-border bg-surface text-text-2 hover:bg-surface-2')}>
            {v.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- timeline ---------- */

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  visit: Eye, note: NotebookPen, ist_assigned: GraduationCap, ist_done: ClipboardCheck, requirement: CalendarCheck, upload: FileUp,
  upload_confirmed: FileCheck2, incident: Siren, scheduled: CalendarDays, hr_view: Lock,
}

const KIND_TINT: Record<ActivityKind, string> = {
  visit: 'bg-surface-2 text-text-2', note: 'bg-tint-lavender text-tint-fg-lavender', ist_assigned: 'bg-tint-blue text-tint-fg-blue',
  ist_done: 'bg-tint-mint text-tint-fg-mint', requirement: 'bg-tint-amber text-tint-fg-amber', upload: 'bg-tint-blue text-tint-fg-blue',
  upload_confirmed: 'bg-tint-mint text-tint-fg-mint', incident: 'bg-tint-danger text-tint-fg-danger',
  scheduled: 'bg-tint-lavender text-tint-fg-lavender', hr_view: 'bg-surface-2 text-text-2',
}

function EventRow({ e }: { e: ActivityEvent }) {
  const Icon = KIND_ICON[e.kind]
  // a visit names the section opened
  const detail = e.kind === 'visit' && e.detail ? `Opened ${sectionWords(e.detail)}` : e.detail
  return (
    <li className="flex gap-3 py-3" data-event={e.kind}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', KIND_TINT[e.kind])}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-text-1">{e.title}</p>
        {detail && <p className="mt-0.5 text-[12.5px] leading-5 text-text-2">{detail}</p>}
        <p className="mt-0.5 text-[11.5px] text-text-3">{[e.by, stampWords(e.at)].filter(Boolean).join(' · ')}</p>
      </div>
    </li>
  )
}

export function TimelineView({ activity, onRetry }: { activity: ReadState<StaffActivity>; onRetry: () => void }) {
  const a = activity.data
  return (
    <SectionCard title="Timeline" sub="What changed around this person in the last year, newest first.">
      <div className="grid gap-2">
        <ReadLine state={activity} what="the activity" onRetry={onRetry} />
        {a && <WhyNote why={a.why} degraded={a.degraded} />}
        {a && a.events.length === 0 && <EmptyNote>Nothing is on record for this person in the last year.</EmptyNote>}
        {a && a.events.length > 0 && (
          <ul className="scroll-thin max-h-[560px] divide-y divide-border overflow-y-auto pr-1" data-timeline="">
            {a.events.map((e, i) => <EventRow key={`${e.at}-${i}`} e={e} />)}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

/* ---------- visits ---------- */

export function VisitsView({ activity, onRetry }: { activity: ReadState<StaffActivity>; onRetry: () => void }) {
  const a = activity.data
  return (
    <SectionCard title="Who visited this profile"
      sub={a && a.visitsTotal !== null ? `${a.visitsTotal} visit${a.visitsTotal === 1 ? '' : 's'} on record.` : undefined}>
      <div className="grid gap-2">
        <ReadLine state={activity} what="the visits" onRetry={onRetry} />
        {a && <WhyNote why={a.why} degraded={a.degraded} />}
        {a && a.visits.length === 0 && <EmptyNote>No visit to this profile is on record yet.</EmptyNote>}
        {a && a.visits.length > 0 && (
          <ul className="scroll-thin max-h-[560px] divide-y divide-border overflow-y-auto pr-1" data-visits="">
            {a.visits.map((v, i) => (
              <li key={`${v.at}-${i}`} className="flex items-center gap-3 py-2.5" data-visit={v.section}>
                <Avatar name={v.visitor || '?'} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-text-1">{v.visitor || 'Someone'}</p>
                  <p className="text-[12px] text-text-3">Opened {sectionWords(v.section) || 'the profile'}</p>
                </div>
                <span className="shrink-0 text-[12px] text-text-3">{stampWords(v.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

/* ---------- shifts ---------- */

const DESIGNATION: Record<string, string> = { hm: 'HM', lead: 'Lead' }

export function ShiftsView({ shifts, onRetry }: { shifts: ReadState<StaffShifts>; onRetry: () => void }) {
  const s = shifts.data
  const names = new Map((s?.houses ?? []).map((h) => [h.code, h.home_name]))
  const house = (code: string) => names.get(code) || code
  const sourceWhy = s ? [
    !s.sources.archive.readable ? `Calendar Archive: ${s.sources.archive.why || 'not read'}` : '',
    !s.sources.punches.readable ? `PSI punches: ${s.sources.punches.why || 'not read'}` : '',
  ].filter(Boolean) : []
  return (
    <div className="grid gap-5" data-shifts="">
      <ReadLine state={shifts} what="the shifts" onRetry={onRetry} />
      {s && <WhyNote why={s.why} degraded={s.degraded || sourceWhy.length > 0} />}
      {sourceWhy.map((w) => <p key={w} className="text-[12px] text-text-3" data-source-why="">{w}</p>)}
      {s && (
        <>
          <SectionCard title="Scheduled" sub="The Calendar Archive's rows ahead of today.">
            {s.patterns.length === 0 && s.upcoming.length === 0 && <EmptyNote>No shift ahead is on the Calendar Archive.</EmptyNote>}
            {s.patterns.length > 0 && (
              <ul className="mb-3 grid gap-1.5" data-patterns="">
                {s.patterns.map((p, i) => (
                  <li key={`${p.house}-${i}`} className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-text-1">
                    Scheduled — {patternWords(p, house(p.house))}
                    {(p.from || p.to) && <span className="ml-1.5 text-[11.5px] text-text-3">{spanWords({ from: p.from, to: p.to })}</span>}
                  </li>
                ))}
              </ul>
            )}
            {s.upcoming.length > 0 && (
              <ul className="scroll-thin max-h-[260px] divide-y divide-border overflow-y-auto pr-1" data-upcoming="">
                {s.upcoming.map((d, i) => (
                  <li key={`${d.date}-${i}`} className="flex items-center gap-3 py-2 text-[13px]">
                    <span className="w-[110px] shrink-0 tabular-nums text-text-2">{dateWords(d.date)}</span>
                    <span className="min-w-0 flex-1 text-text-1">{house(d.house)}</span>
                    <span className="shrink-0 text-text-3">{hoursWords(d.start, d.end)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Worked" sub="The last 180 days, newest first.">
            {s.gaps.length > 0 && (
              <div className="mb-3 grid gap-1" data-gaps="">
                {s.gaps.map((g) => (
                  <p key={`${g.from}-${g.to}`} className="rounded-md bg-tint-amber px-3 py-1.5 text-[12px] text-tint-fg-amber">
                    The Calendar Archive holds no rows at all from {spanWords(g)} — a gap in the record, not days off.
                  </p>
                ))}
              </div>
            )}
            {s.days.length === 0 ? <EmptyNote>No worked shift names this person in the last 180 days.</EmptyNote> : (
              <ul className="scroll-thin max-h-[420px] divide-y divide-border overflow-y-auto pr-1" data-days="">
                {s.days.map((d, i) => (
                  <li key={`${d.date}-${d.house}-${i}`} className="flex items-center gap-3 py-2 text-[13px]" data-day={d.date}>
                    <span className="w-[110px] shrink-0 tabular-nums text-text-2">{dateWords(d.date)}</span>
                    <span className="min-w-0 flex-1 text-text-1">
                      {house(d.house)}
                      {d.designation && <span className="ml-1.5 rounded-full bg-tint-lavender px-1.5 text-[10.5px] font-semibold text-tint-fg-lavender">{DESIGNATION[d.designation]}</span>}
                    </span>
                    <span className="shrink-0 text-text-3">{hoursWords(d.start, d.end)}</span>
                    {d.source && <span className="hidden shrink-0 text-[11px] text-text-3 sm:inline">{SHIFT_SOURCE_LABEL[d.source]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}

/* ---------- texts ---------- */

type Older = { key: string; messages: TextMessage[]; more: boolean | null; busy: boolean; error: string }

function TextsPane({ staff }: { staff: string }) {
  const [picked, setPicked] = useState('')
  const texts = useStaffRead(readKey('staffProfileTexts', staff, picked), () => readTexts(staff, picked), textsOf)
  const current = texts.data?.with || picked
  const threadKey = `${staff}|${current}`
  const [older, setOlder] = useState<Older>({ key: '', messages: [], more: null, busy: false, error: '' })
  const mine = useMemo<Older>(() => (older.key === threadKey ? older : { key: threadKey, messages: [], more: null, busy: false, error: '' }),
    [older, threadKey])

  const loadOlder = useCallback(() => {
    const held = [...(texts.data?.messages ?? []), ...mine.messages]
    const before = olderCursor(held)
    if (!before) return
    setOlder({ ...mine, busy: true, error: '' })
    readTexts(staff, current, before)
      .then((raw) => {
        const page = textsOf(raw)
        setOlder((o) => (o.key === threadKey ? { ...o, messages: [...o.messages, ...page.messages], more: page.more, busy: false } : o))
      })
      .catch((err: unknown) => {
        setOlder((o) => (o.key === threadKey ? { ...o, busy: false, error: err instanceof Error ? err.message : String(err) } : o))
      })
  }, [texts.data, mine, staff, current, threadKey])

  return (
    <TextsView texts={texts} older={mine.messages} more={mine.more ?? texts.data?.more ?? false} olderBusy={mine.busy}
      olderError={mine.error} onPick={(id) => setPicked(id)} onOlder={loadOlder} onRetry={texts.reload} />
  )
}

export function TextsView({ texts, older, more, olderBusy, olderError, onPick, onOlder, onRetry }: {
  texts: ReadState<StaffTexts>
  older: TextMessage[]
  more: boolean
  olderBusy: boolean
  olderError: string
  onPick: (id: string) => void
  onOlder: () => void
  onRetry: () => void
}) {
  const t = texts.data
  const thread = t ? threadOrder(older, t.messages) : []
  const items = t ? threadItems(thread, t.coverage.gaps) : []
  const current = t?.counterparts.find((c) => c.id === t.with) ?? null
  return (
    <SectionCard title="Texts" sub={t && (t.coverage.from || t.coverage.to)
      ? `Texts on file from ${spanWords({ from: t.coverage.from, to: t.coverage.to })}.` : undefined}>
      <div className="grid gap-3">
        <ReadLine state={texts} what="the texts" onRetry={onRetry} />
        {t && <WhyNote why={t.why} degraded={t.degraded} />}
        {t && t.coverage.gaps.length > 0 && (
          <div className="grid gap-1" data-text-gaps="">
            {t.coverage.gaps.map((g) => (
              <p key={`${g.from}-${g.to}`} className="rounded-md bg-tint-amber px-3 py-1.5 text-[12px] text-tint-fg-amber">
                No text is on file in any store from {spanWords(g)} — a gap in the record, not silence.
              </p>
            ))}
          </div>
        )}
        {t && t.counterparts.length === 0 && (
          <EmptyNote>
            No text on a company line names this person's numbers
            {t.phonesMatched === 0 ? ' — no phone of theirs is on file to match.' : '.'}
          </EmptyNote>
        )}
        {t && t.counterparts.length > 0 && (
          <>
            <div role="tablist" aria-label="Conversations" className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-counterparts="">
              {t.counterparts.map((c) => {
                const on = c.id === t.with
                return (
                  <button key={c.id} type="button" role="tab" aria-selected={on} onClick={() => onPick(c.id)} data-counterpart={c.id}
                    className={cn('flex min-w-[168px] shrink-0 flex-col items-start rounded-[14px] border px-3 py-2 text-left transition-colors',
                      on ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2')}>
                    <span className={cn('clamp-1 text-[13px] font-semibold', on ? 'text-primary' : 'text-text-1')}>{counterpartLabel(c)}</span>
                    <span className="clamp-1 text-[11.5px] text-text-3">
                      {[c.owner, c.count !== null ? `${c.count} text${c.count === 1 ? '' : 's'}` : '', dateWords(c.lastAt)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="scroll-thin flex max-h-[520px] min-h-[240px] flex-col gap-2 overflow-y-auto rounded-[16px] border border-border bg-surface-2/40 p-3"
              data-thread={t.with}>
              {more && (
                <button type="button" onClick={onOlder} disabled={olderBusy} data-older=""
                  className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60">
                  {olderBusy && <Loader2 size={12} className="animate-spin" />} Load earlier
                </button>
              )}
              {olderError && <p role="alert" className="text-center text-[12px] text-[var(--danger)]">Earlier texts could not be read: {readRefusal(olderError)}</p>}
              {thread.length === 0 && <p className="m-auto text-[12.5px] text-text-3">No text with {current ? counterpartLabel(current) : 'this line'} is on file.</p>}
              {items.map((it, i) => <ThreadLine key={it.kind === 'msg' ? it.msg.id : `${it.kind}-${i}`} item={it} />)}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

function ThreadLine({ item }: { item: ReturnType<typeof threadItems>[number] }): ReactNode {
  if (item.kind === 'day') {
    return <p className="my-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3" data-thread-day={item.day}>{dateWords(item.day)}</p>
  }
  if (item.kind === 'gap') {
    return (
      <p className="my-1 rounded-md bg-tint-amber px-3 py-1.5 text-center text-[11.5px] text-tint-fg-amber" data-thread-gap="">
        Nothing on file from {spanWords(item.gap)}
      </p>
    )
  }
  const m = item.msg
  const out = m.dir === 'out'
  return (
    <div className={cn('flex flex-col gap-0.5', out ? 'items-end' : 'items-start')} data-msg={m.dir}>
      <p className={cn('max-w-[82%] whitespace-pre-wrap break-words rounded-[16px] px-3.5 py-2 text-[13px] leading-5',
        out ? 'rounded-br-[6px] bg-primary-soft text-text-1' : 'rounded-bl-[6px] border border-border bg-surface text-text-1')}>
        {m.body || <span className="text-text-3">(no words — a picture or an empty text)</span>}
      </p>
      <span className="px-1 text-[10.5px] text-text-3">{[out ? m.by : '', ohioTime(m.at)].filter(Boolean).join(' · ')}</span>
    </div>
  )
}

/* ---------- transcripts ---------- */

export function TranscriptsView({ transcripts, category, onCategory, onOpen, onRetry }: {
  transcripts: ReadState<StaffTranscripts>
  category: string
  onCategory: (c: string) => void
  onOpen: (callId: string) => void
  onRetry: () => void
}) {
  const t = transcripts.data
  const groups = t ? callsByDay(t.calls, category) : []
  return (
    <SectionCard title="Call transcripts" sub={t ? `${t.calls.length} call${t.calls.length === 1 ? '' : 's'} with this person's numbers.` : undefined}>
      <div className="grid gap-3">
        <ReadLine state={transcripts} what="the transcripts" onRetry={onRetry} />
        {t && <WhyNote why={t.why} degraded={t.degraded} />}
        {t && t.gaps.length > 0 && (
          <div className="grid gap-1" data-transcript-gaps="">
            {t.gaps.map((g) => (
              <p key={`${g.from}-${g.to}`} className="rounded-md bg-tint-amber px-3 py-1.5 text-[12px] text-tint-fg-amber">
                No transcript is on file from {spanWords(g)} — a gap in the record, not a quiet stretch.
              </p>
            ))}
          </div>
        )}
        {t && t.categories.length > 0 && (
          <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Categories" data-categories="">
            {[{ name: '', count: t.calls.length as number | null }, ...t.categories].map((c) => {
              const on = c.name === category
              return (
                <button key={c.name || 'all'} type="button" role="tab" aria-selected={on} onClick={() => onCategory(c.name)}
                  data-category={c.name || 'all'}
                  className={cn('shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                    on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text-2 hover:bg-surface-2')}>
                  {c.name || 'All'}{c.count !== null ? ` · ${c.count}` : ''}
                </button>
              )
            })}
          </div>
        )}
        {t && t.calls.length === 0 && <EmptyNote>No call transcript carries this person's numbers.</EmptyNote>}
        {t && t.calls.length > 0 && groups.length === 0 && <EmptyNote>No call is filed under this category.</EmptyNote>}
        {groups.length > 0 && (
          <div className="scroll-thin max-h-[520px] overflow-y-auto rounded-[16px] border border-border" data-calls="">
            {groups.map((g) => (
              <div key={g.day}>
                <p className="sticky top-0 z-[1] border-b border-border bg-surface-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  {g.day}
                </p>
                <ul className="divide-y divide-border">
                  {g.calls.map((c) => (
                    <li key={c.callId}>
                      <button type="button" onClick={() => onOpen(c.callId)} data-call={c.callId}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/60">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue">
                          <PhoneCall size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-text-1">
                            {[ohioTime(c.at), c.direction ? c.direction[0].toUpperCase() + c.direction.slice(1) : '', c.line ? formatPhoneDisplay(c.line) : ''].filter(Boolean).join(' · ')}
                          </span>
                          <span className="block text-[11.5px] text-text-3">
                            {[secsWords(c.secs), c.turns !== null ? `${c.turns} turns` : '', c.kind, ...c.categories].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
