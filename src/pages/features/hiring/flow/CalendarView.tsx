// FLOW · CALENDAR — extracted verbatim from FlowPage.tsx.
// What is scheduled, and who is waiting to be.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { format } from 'date-fns'
import {
  CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, Clock, DoorClosed,
  DoorOpen, FileCheck2, Loader2, Mail, Phone, RotateCcw, UserRound, X, type LucideIcon,
} from 'lucide-react'
import Card from '@/components/shared/Card'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'
import { ohioWall } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import {
  type ArchivedRow, type FlowRow, type FlowEvent, STAGES, usePhases,
  todayKey, profileRoute, inputCls, btnCls, EVENT_TYPES,
  EVENT_TINT, MISSING_SPEC,
} from './shared'

// SCHEDULING WITHOUT LEAVING THE LINE.
function InlineSchedule({ cid, name, email, type, onFull, onSaved }: {
  cid: string
  name: string
  // Whether a letter can go at all — with no address the server answers `no_email` and the day is simply written.
  email?: string
  type: string
  onFull: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  // An interview is never scheduled from here: it needs a location and an interviewer, so this row hands it to the…
  const needsForm = type === 'in_person_interview'
  // THE LETTER IS ANNOUNCED BEFORE THE PRESS, never only in the toast afterwards.
  const rehearsal = /^\s*\[test\]/i.test(name)
  const willMail = !!email
  const promise = !willMail
    ? `No e-mail on file for ${name} — the day is written and nobody is told.`
    : rehearsal
      ? `A rehearsal card: the day is written and the letter goes to the testers — ${name} never receives it.`
      : `The day is written AND ${name} is e-mailed as asa-hub, at ${email}. `
        + 'It stays quiet only if the hiring_event_scheduled switch is off in Smart Comms, '
        + 'or they were already told about this exact day and time.'
  const save = async () => {
    if (!date || busy) return
    setBusy(true)
    try {
      const d = await gasAction<{ mail: { emailed: boolean; reason?: string; redirected?: boolean } }>(
        'hiringScheduleCreate',
        { candidate_id: cid, event_type: type, date, time, location: '', with_name: '', notes: '' },
      )
      toast({
        type: 'success',
        title: 'Scheduled',
        body: d.mail?.emailed
          ? (d.mail.redirected ? 'Rehearsal: the e-mail went to the testers.' : `${name} was e-mailed as asa-hub.`)
          : 'Saved; nobody was e-mailed.',
      })
      onSaved()
    } catch (e) {
      toast({ type: 'danger', title: 'Not scheduled', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }
  if (needsForm) {
    return (
      <button
        onClick={onFull}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-on-primary"
      >
        <CalendarDays size={12} /> Schedule
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-text-1 outline-none focus:border-primary"
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-text-1 outline-none focus:border-primary"
      />
      <button
        onClick={() => void save()}
        disabled={!date || busy}
        title={date ? promise : 'Choose a day first'}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-on-primary disabled:opacity-40"
      >
        {busy ? 'Saving…' : willMail ? 'Save & tell them' : 'Save'}
      </button>
      {!willMail && (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-warning" title={promise}>
          <Mail size={11} /> nobody is told
        </span>
      )}
      <button onClick={onFull} title="Open the full form — location, who sits in, notes" className="text-text-3 hover:text-text-1">
        <CalendarDays size={13} />
      </button>
    </span>
  )
}

export function CalendarSection({ rows, events, archived, writer, onSchedule, onSaved }: {
  rows: FlowRow[]
  events: FlowEvent[] | null
  // The people who LEFT — read lazily by the page, and `false` when that read failed, which is a different thing…
  archived: ArchivedRow[] | null | false
  writer: boolean
  onSchedule: (cid: string, name: string, type: string) => void
  /** Re-read the events after an inline save — the queue empties itself. */
  onSaved: () => void
}) {
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  // the interview invite link (InterviewFlow.gs) — outcomes arrive NAMED
  const [inviting, setInviting] = useState('')
  const sendInvite = async (cid: string, name: string) => {
    setInviting(cid)
    try {
      const d = await gasAction<{ invited: boolean; reason?: string }>('interviewInviteSend', { candidate_id: cid })
      if (d.invited) {
        toast({ type: 'success', title: 'Invite sent', body: `The link is personal to ${name}.` })
      } else if (d.reason === 'situation_off') {
        toast({ type: 'info', title: 'Not sent', body: 'The interview_invite switch is off in Smart Comms.' })
      } else if (d.reason === 'no_email_no_phone') {
        toast({ type: 'info', title: 'Not sent', body: `${name} has no e-mail or phone on file — nobody can receive the link.` })
      } else if (d.reason === 'no_link_secret') {
        toast({ type: 'info', title: 'Not sent', body: 'Set the INTERVIEW_LINK_SECRET Script Property first.' })
      } else if (d.reason === 'already_told') {
        toast({ type: 'info', title: 'Already invited today', body: `${name} already received their link today.` })
      } else {
        toast({ type: 'info', title: 'Not sent', body: d.reason || 'The invite did not go out.' })
      }
    } catch (e) {
      toast({ type: 'danger', title: 'Not sent', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setInviting('')
    }
  }

  if (events === null) {
    return <p className="flex items-center gap-2 py-10 text-[13px] text-text-3"><Loader2 size={15} className="animate-spin" /> Reading the calendar…</p>
  }

  // THE INBOX DERIVATION LEFT WITH THE QUEUE.

  // ── the month ──
  const first = new Date(cursor.y, cursor.m, 1)
  const startOffset = first.getDay()
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const today = todayKey()
  const byDate: Record<string, FlowEvent[]> = {}
  for (const ev of events) {
    if (!ev.date) continue
    ;(byDate[ev.date] = byDate[ev.date] ?? []).push(ev)
  }

  return (
    <div className="space-y-3">
      {/* THE QUEUE IS NOT A SECOND LIST ANY MORE — the calendar was showing
          people at the top and again at the bottom. It listed the three people
          waiting on a date; the journey below listed everybody — so those three
          were drawn twice, and the same person could be read as two. The
          journey already says which milestone has no date and already offers to
          set it, so what the queue really was is a FILTER, and that is what it
          is now: the count sits on the journey's own header and narrows it. */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))} className={btnCls}><ChevronLeft size={13} /></button>
            <p className="w-40 text-center text-[13.5px] font-bold text-text-1">{monthLabel}</p>
            <button onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))} className={btnCls}><ChevronRight size={13} /></button>
          </div>
          <div className="flex items-center gap-3 text-[11.5px] text-text-3">
            {EVENT_TYPES.map((t) => (
              <span key={t.id} className="flex items-center gap-1">
                <span className={cn('h-2 w-2 rounded-full', TINT_BG[EVENT_TINT[t.id]])} />
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-bold uppercase tracking-wide text-text-3">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }, (_, i) => {
            const dayNum = i - startOffset + 1
            if (dayNum < 1 || dayNum > daysInMonth) {
              return <div key={i} className="min-h-[72px] border-b border-r border-border/40 bg-surface-2/30" />
            }
            const dateKey = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
            const dayEvents = byDate[dateKey] ?? []
            return (
              <div key={i} className={cn('min-h-[72px] border-b border-r border-border/40 p-1', dateKey === today && 'bg-primary-soft/40')}>
                <p className={cn('mb-0.5 text-right text-[11px] font-semibold', dateKey === today ? 'text-primary' : 'text-text-3')}>{dayNum}</p>
                {dayEvents.slice(0, 3).map((ev) => (
                  // THE WHOLE CHIP IS THE GRIP, not the name inside it: the chip truncates, and text-overflow only…
                  <DragPerson
                    key={ev.id}
                    name={ev.name}
                    id={ev.candidate_id}
                    type="staff"
                    subtitle={ev.type_label}
                    className="block"
                  >
                    <div
                      title={`${ev.name} · ${ev.type_label}${ev.time ? ' · ' + ev.time : ''}${ev.location ? ' · ' + ev.location : ''}`}
                      className={cn('mb-0.5 truncate rounded px-1 py-0.5 text-[10.5px] font-semibold', TINT_BG[EVENT_TINT[ev.type] ?? 'blue'], TINT_FG[EVENT_TINT[ev.type] ?? 'blue'])}
                    >
                      {ev.time && <span className="mr-1 opacity-70">{ev.time}</span>}
                      {ev.name}
                    </div>
                  </DragPerson>
                ))}
                {dayEvents.length > 3 && <p className="text-[10px] text-text-3">+{dayEvents.length - 3} more</p>}
              </div>
            )
          })}
        </div>
      </Card>

      <JourneySection
        onInvite={sendInvite}
        inviting={inviting}
        rows={rows}
        events={events}
        archived={archived}
        writer={writer}
        onSchedule={onSchedule}
        onSaved={onSaved}
      />
    </div>
  )
}

// ------------------------------------------------------------------ BLOCK 3 · THE JOURNEY — every conclusion, per…

// THE LIST OF CONCLUSIONS.
type Tone = 'settled' | 'open' | 'closed'

const TONE_TINT: Record<Tone, ExtendedTintName> = {
  settled: 'mint',
  open: 'amber',
  closed: 'slate',
}

type Milestone = {
  // The declared numbering, so the order is the process's and not this component's.
  n: number
  label: string
  Icon: LucideIcon
  tone: Tone
  /** The day, printed — '' when the record has none, and then `said` says so. */
  when: string
  /** ALWAYS written. There is no empty milestone row on this screen. */
  said: string
  /** The one milestone this list can write. */
  offerInterview?: boolean
  /** The other one: the first day of somebody standing at Ready to start. */
  offerStart?: boolean
}

// A milestone's day, printed.
function dayText(v?: string): string {
  const d = ohioWall(String(v ?? '').trim())
  return d ? format(d, 'MMM d, yyyy') : ''
}

// Where somebody stands, as a number.
function stageRank(id: string): number {
  const i = STAGES.findIndex((s) => s.id === id)
  return i < 0 ? STAGES.length : i
}

/** Their whole journey, in the process's order. */
function milestonesFor(r: FlowRow, events: FlowEvent[]): Milestone[] {
  const out: Milestone[] = []
  const rank = stageRank(r.stage)

  // 1 — entered the process.
  const appliedForm = dayText(r.application?.appliedAt)
  const applied = appliedForm || dayText(r.appliedAt)
  out.push(applied
    ? {
      n: 1, label: 'Entered the process', Icon: UserRound, tone: 'settled', when: applied,
      said: appliedForm
        ? 'They signed and sent the application form on this day' +
          (r.application?.status && r.application.status !== 'signed'
            ? ` — the envelope reads ${r.application.status}.`
            : '.') +
          (dayText(r.appliedAt) && dayText(r.appliedAt) !== appliedForm
            ? ` Their card here was created on ${dayText(r.appliedAt)}.`
            : '')
        : 'Their row was created on this day. Everything below is counted from here.',
    }
    : {
      n: 1, label: 'Entered the process', Icon: UserRound, tone: 'open', when: '',
      said: 'Their row carries no creation date. That is a hole in the record and not a step they skipped — every candidate is supposed to have this one.',
    })

  /* 2 — the phone screen, and whether they passed. */
  const screened = dayText(r.screenDate)
  const result = String(r.screenResult ?? '').trim().toLowerCase()
  const status = String(r.screenStatus ?? '').trim().toLowerCase()
  const screen = { n: 2, label: 'Phone screen', Icon: Phone } as const
  if (result === 'skipped' || status === 'skipped') {
    out.push({
      ...screen, tone: 'settled', when: screened,
      said: 'The phone screen was skipped. Nobody was called, and the process went on without it.',
    })
  } else if (result === 'advance') {
    out.push({
      ...screen, tone: 'settled', when: screened,
      said: screened
        ? 'They were called and they passed — the screen says Advance.'
        : 'They were called and they passed — the screen says Advance — but no day was ever recorded for the call.',
    })
  } else if (result === 'decline') {
    out.push({
      ...screen, tone: 'closed', when: screened,
      said: screened
        ? 'They were called and the answer was no — the screen says Decline.'
        : 'They were called and the answer was no — the screen says Decline — with no day recorded for the call.',
    })
  } else if (screened) {
    out.push({
      ...screen, tone: 'open', when: screened,
      said: 'The call is on record for this day. Nobody has written down how it went.',
    })
  } else if (rank > stageRank('phone-screen')) {
    // PAST THE PHASE WITH NOTHING WRITTEN: they plainly got through it, so saying "not called yet" would be the…
    out.push({
      ...screen, tone: 'settled', when: '',
      said: 'The call happened — they are past this phase — but neither a day nor an outcome was recorded for it.',
    })
  } else if (r.stage === 'phone-screen') {
    out.push({ ...screen, tone: 'open', when: '', said: 'They are in this phase. No call has been recorded for them yet.' })
  } else {
    out.push({ ...screen, tone: 'open', when: '', said: 'They have not been called yet.' })
  }

  // 3 — the in-person interview.
  const interviews = events
    .filter((ev) => ev.candidate_id === r.id && ev.type === 'in_person_interview' && ev.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const iv = interviews[interviews.length - 1]
  const ivm = { n: 3, label: 'In-person interview', Icon: CalendarDays } as const
  if (iv) {
    const bits: string[] = []
    if (iv.time) bits.push(iv.time)
    if (iv.with_name) bits.push('with ' + iv.with_name)
    if (iv.location) bits.push('at ' + iv.location)
    const detail = bits.length ? ' — ' + bits.join(', ') : ''
    out.push({
      ...ivm, tone: 'settled', when: dayText(iv.date),
      said: iv.date < todayKey()
        // The calendar knows a day was booked; nothing here knows the room was walked into, so this sentence must…
        ? `It was on the calendar for this day${detail}. Whether it was actually held is not something the calendar records.`
        : `It is on the calendar${detail}.`,
    })
  } else if (rank > stageRank('interview')) {
    out.push({
      ...ivm, tone: 'closed', when: '',
      said: 'They are past the interview and nothing was ever put on the calendar for it. There is nothing left to schedule.',
    })
  } else if (r.stage === 'interview') {
    out.push({
      ...ivm, tone: 'open', when: '', offerInterview: true,
      said: 'They are in this phase and no interview is on the calendar yet.',
    })
  } else {
    out.push({
      ...ivm, tone: 'open', when: '',
      said: 'Nothing is on the calendar for them. They have not reached this phase yet.',
    })
  }

  // 4 — the New Hire Package.
  const signed = dayText(r.packetSignedAt)
  const packet = String(r.packet?.state ?? '')
  // Renamed with the chip: the envelope this reads is the APPLICATION form — 194 of the 195 in the mirror — and…
  const pkm = { n: 4, label: 'Application form', Icon: FileCheck2 } as const
  if (signed) {
    out.push({
      ...pkm, tone: 'settled', when: signed,
      said: packet === 'waived'
        ? 'Somebody attached the signed packet by hand on this day.'
        : 'The packet was signed in Dropbox Sign on this day.',
    })
  } else if (packet === 'signed') {
    out.push({ ...pkm, tone: 'settled', when: '', said: 'The packet is signed in Dropbox Sign. The day it was signed is not on the record.' })
  } else if (packet === 'waived') {
    out.push({ ...pkm, tone: 'settled', when: '', said: 'Somebody attached the signed packet by hand. No day came with it.' })
  } else if (packet === 'unsigned') {
    out.push({ ...pkm, tone: 'open', when: '', said: 'Their envelope exists and has not been signed. This is the one that holds them back.' })
  } else if (packet === 'ambiguous') {
    out.push({ ...pkm, tone: 'open', when: '', said: 'More than one card fits that envelope, so a person has to say which. Until somebody does, there is no signing day to show.' })
  } else if (rank < stageRank('onboarding') && (packet === 'unknown' || !packet)) {
    // 'not found' IS the honest answer for most of the roster and PacketChip says so — but on somebody who has not…
    out.push({ ...pkm, tone: 'open', when: '', said: 'No envelope has gone out to them yet.' })
  } else if (packet === 'unknown') {
    out.push({ ...pkm, tone: 'open', when: '', said: 'No envelope matched this person. That is usually ours to fix rather than a document they owe.' })
  } else {
    out.push({ ...pkm, tone: 'open', when: '', said: 'No packet state is on their record at all — nothing has been looked up for them yet.' })
  }

  // 5 — waiting for onboarding.
  const onboarded = (r.checklist ?? []).some((c) => c.id === 'onboarding-complete' && c.status === 'done')
  if (r.stage === 'onboarding' && !onboarded) {
    const w = r.onboardingWindow
    const until = dayText(w?.until)
    if (w?.open === false) {
      out.push({
        n: 5, label: 'Waiting for onboarding', Icon: DoorClosed, tone: 'open', when: until,
        said: String(w.reason ?? '') || 'Their onboarding window has closed. They cannot get back into the portal until somebody extends it.',
      })
    } else if (until) {
      out.push({
        n: 5, label: 'Waiting for onboarding', Icon: DoorOpen, tone: 'open', when: until,
        said: 'They can finish in the onboarding portal until this day'
          + (w?.anchored_on ? `, counted from ${w.anchored_on}.` : '.'),
      })
    } else {
      out.push({
        n: 5, label: 'Waiting for onboarding', Icon: DoorOpen, tone: 'open', when: '',
        said: 'They are in onboarding. No portal deadline is anchored to their row, so there is no day to show.',
      })
    }
  }

  /* 6 — parked at Ready to start, and the first day the phase owes. */
  if (r.stage === 'ready') {
    // HOW LONG THEY HAVE STOOD THERE — the real answer when the platform wrote the move (stageSince, off…
    const parked = r.daysAtStage
    const days = r.daysInStage
    const counted = parked != null
      ? ` They have stood at Ready since ${dayText(r.stageSince)} — ${parked} day${parked === 1 ? '' : 's'}.`
      : days == null
        ? ' The record does not say for how long.'
        : ` Nobody wrote the day they reached Ready, so there is no length to give: their row was last touched ${days} day${days === 1 ? '' : 's'} ago, which counts something else.`
    // WHICH DATE THIS PHASE OWES IS DECLARED ONCE (MISSING_SPEC), and the line that says it is missing is the line…
    const starts = events
      .filter((ev) => ev.candidate_id === r.id && ev.type === 'start_date' && ev.date)
      .sort((a, b) => a.date.localeCompare(b.date))
    const started = starts.length ? dayText(starts[starts.length - 1].date) : ''
    out.push(started
      ? {
        n: 6, label: 'Parked at Ready to start', Icon: Clock, tone: 'settled', when: started,
        said: 'Their first day is on the calendar. They wait on the manager until then.' + counted,
      }
      : {
        n: 6, label: 'Parked at Ready to start', Icon: Clock, tone: 'open', when: '',
        offerStart: MISSING_SPEC[r.stage]?.schedule === 'start_date',
        said: 'They are waiting on the manager, and no first day is on the calendar for them.' + counted,
      })

    // 7 — parked too long, and what the platform did about it.
    const told = r.parked?.notices ?? 0
    if (told > 0) {
      const of = r.parked?.of ?? 0
      out.push({
        n: 7, label: 'Parked too long', Icon: Mail, tone: 'open',
        when: dayText(r.parked?.lastAt),
        said: `Nobody had scheduled them, so the deciders were told — ${told} time${told === 1 ? '' : 's'}, the last on this day — and the clock was renewed each time.`
          + (of > 0 && told >= of
            ? ' That was the last one: the platform has now said it as often as it may, and it will not say it again for this stay.'
            : ' It stops by itself the moment they leave Ready to start.'),
      })
    }
  }

  return out
}

/** The journey of somebody who left. Two facts is all the archive holds. */
function archivedMilestones(a: ArchivedRow): Milestone[] {
  const applied = dayText(a.applied_at)
  const left = dayText(a.archived_at)
  const why = String(a.archived_reason ?? '').trim()
  return [
    applied
      ? {
        n: 1, label: 'Entered the process', Icon: UserRound, tone: 'settled', when: applied,
        said: 'Their row was created on this day.',
      }
      : {
        n: 1, label: 'Entered the process', Icon: UserRound, tone: 'open', when: '',
        said: 'Their row carries no creation date, so there is no day to open this journey with.',
      },
    {
      n: 8, label: 'Excluded from the process', Icon: X, tone: 'closed', when: left,
      said: left
        ? (why ? `The reason written on the row reads: “${why}”.` : 'No reason was written on the row.')
        : (why ? `They were taken off the board — the reason reads: “${why}” — with no day recorded.` : 'They were taken off the board. Neither a day nor a reason was written down.'),
    },
  ]
}

/** One person, their pips, and — when it is opened — their whole record. */
function JourneyPerson({
  id, name, email, pill, tint, days, milestones, tail, archived, writer, open, onToggle, onSchedule, onSaved,
  onInvite, inviting,
}: {
  id: string
  name: string
  /** Carried only so a row that can send a letter can SAY so before it does. */
  email?: string
  pill: string
  tint: ExtendedTintName
  days: string
  milestones: Milestone[]
  /** The closing sentence for a journey this list cannot read to the end. */
  tail?: string
  /** They are in the Archive already — the half of this list that left. */
  archived?: boolean
  writer: boolean
  open: boolean
  onToggle: () => void
  onSchedule: (cid: string, name: string, type: string) => void
  onSaved: () => void
  onInvite?: (cid: string, name: string) => void
  inviting?: string
}) {
  const navigate = useNavigate()
  // THE WAY OUT OF THE PROCESS, AND THE WAY BACK — each person's dropdown carries the option to remove them, which…
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const setArchived = async (next: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await gasAction('talentArchive', { candidate_ids: [id], archived: next }, { timeoutMs: 120000 })
      toast({
        type: 'success',
        title: next ? `${name} left the process` : `${name} is back in the process`,
        body: next
          ? 'Their row is archived — the record is kept whole, and the Archive is where it is read.'
          : 'They are on the board again, at the stage their record last carried.',
      })
      setAsking(false)
      onSaved()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was changed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      {/* THE WHOLE LINE OPENS, not a 14px chevron — the queue above already
          treats a row as one target, and the name inside it stops the press
          because a name is a door of its own. */}
      <div
        onClick={onToggle}
        title={open ? 'Close their record' : 'Open their record'}
        className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 hover:bg-surface-2/50"
      >
        <ChevronRight size={14} className={cn('shrink-0 text-text-3 transition-transform duration-150', open && 'rotate-90')} />
        {/* a name is a door, and the icon beside it is round — every person on
            this platform is drawn the same way */}
        <span
          onClick={(e) => { e.stopPropagation(); navigate(profileRoute(id)) }}
          title="Open the full profile"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
        >
          <DragPerson name={name} id={id} type="staff" subtitle={pill} className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar src="" name={name} size="sm" />
            <span className="truncate text-[13px] text-text-1 hover:text-primary">{name}</span>
          </DragPerson>
        </span>
        {/* THE WHOLE JOURNEY AT A GLANCE — one pip per milestone, in order,
            so a closed line still says something without being opened. */}
        <span className="flex shrink-0 items-center gap-1">
          {milestones.map((m) => (
            <span
              key={m.n}
              title={`${m.n}. ${m.label}${m.when ? ' · ' + m.when : ''} — ${m.said}`}
              className={cn('h-2 w-2 rounded-full', TINT_BG[TONE_TINT[m.tone]])}
            />
          ))}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', TINT_BG[tint], TINT_FG[tint])}>{pill}</span>
        {days && <span className="shrink-0 text-[11.5px] tabular-nums text-text-3">{days}</span>}
      </div>
      {open && (
        <div className="border-t border-border/40 bg-surface-2/40 px-3 py-2.5">
          <ol className="ml-1">
            {milestones.map((m, i) => (
              <li key={m.n} className="flex gap-2.5">
                <span className="flex flex-col items-center">
                  <span className={cn(
                    'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full',
                    TINT_BG[TONE_TINT[m.tone]], TINT_FG[TONE_TINT[m.tone]],
                  )}>
                    <m.Icon size={12} strokeWidth={2.4} />
                  </span>
                  {/* the rail joins one milestone to the next, so the last has none */}
                  {i < milestones.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
                </span>
                <div className="min-w-0 flex-1 pb-3">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[12.5px] font-semibold text-text-1">{m.label}</span>
                    {m.when
                      ? <span className="text-[12px] tabular-nums text-text-2">{m.when}</span>
                      : <span className="text-[11px] uppercase tracking-wide text-text-3">no date on record</span>}
                  </p>
                  <p className={cn('text-[12px] leading-[1.55]', m.tone === 'open' ? 'italic text-text-3' : 'text-text-2')}>
                    {m.said}
                  </p>
                  {/* THE SAME AFFORDANCE THE QUEUE OFFERS, not a second one:
                      InlineSchedule hands an interview to the full form,
                      because hiringScheduleCreate refuses one without a room
                      and a person to hold it. */}
                  {m.offerInterview && writer && (
                    <span className="mt-1.5 inline-flex">
                      {onInvite && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onInvite(id, name) }}
                          disabled={inviting === id}
                          title="Send them their own link to pick a day from the interviewer's"
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-50"
                        >
                          {inviting === id ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Send invite
                        </button>
                      )}
                      <InlineSchedule
                        cid={id}
                        name={name}
                        email={email}
                        type="in_person_interview"
                        onFull={() => onSchedule(id, name, 'in_person_interview')}
                        onSaved={onSaved}
                      />
                    </span>
                  )}
                  {/* THE FIRST DAY, SET ON THE LINE THAT ASKS FOR IT. Unlike an
                      interview this needs no room and no interviewer, so it is
                      the one date this list can finish by itself — and the
                      button says out loud that a letter leaves with it. */}
                  {m.offerStart && writer && (
                    <span className="mt-1.5 inline-flex">
                      <InlineSchedule
                        cid={id}
                        name={name}
                        email={email}
                        type="start_date"
                        onFull={() => onSchedule(id, name, 'start_date')}
                        onSaved={onSaved}
                      />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {tail && <p className="mt-1 text-[11.5px] italic leading-[1.55] text-text-3">{tail}</p>}

          {writer && (
            <div className="mt-2 border-t border-border/40 pt-2">
              {archived ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11.5px] text-text-3">
                    Already in the Archive — that is what puts them on this half of the list.
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); void setArchived(false) }}
                    disabled={busy}
                    title="Put them back on the board, at the stage their record last carried"
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Put back in the process
                  </button>
                </div>
              ) : asking ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-text-2">
                    Remove {name} from the process? Their row goes to the Archive — nothing is deleted, and
                    it can be put back from there.
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setAsking(false) }}
                      className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void setArchived(true) }}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md bg-danger px-2.5 py-1 text-[12px] font-semibold text-on-primary disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Remove
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setAsking(true) }}
                  title="Archive their row — they leave the board and the record is kept"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2"
                >
                  <X size={12} /> Remove from the process
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Somebody the calendar is WAITING ON: any milestone of theirs that is open and carries no day.
function waitingOnADate(ms: Milestone[]): boolean {
  return ms.some((m) => m.tone === 'open' && !m.when)
}

function JourneySection({ rows, events, archived, writer, onSchedule, onSaved, onInvite, inviting }: {
  rows: FlowRow[]
  events: FlowEvent[]
  archived: ArchivedRow[] | null | false
  writer: boolean
  onSchedule: (cid: string, name: string, type: string) => void
  onSaved: () => void
  // THE INVITE IS STEP 17 OF THE PROCESS, not a convenience: it sends the candidate their own signed link to pick a…
  onInvite: (cid: string, name: string) => void
  inviting: string
}) {
  const [open, setOpen] = useState('')
  const { label: STAGE_LABEL, tint: STAGE_TINT } = usePhases()

  // IN THE ORDER OF THE HIRING PROCESS — where somebody stands first, their name second.
  const [onlyWaiting, setOnlyWaiting] = useState(false)
  const all = useMemo(() => rows
    .slice()
    .sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.name.localeCompare(b.name))
    .map((r) => ({ row: r, milestones: milestonesFor(r, events) })), [rows, events])
  const waitingCount = useMemo(() => all.filter((p) => waitingOnADate(p.milestones)).length, [all])
  const people = onlyWaiting ? all.filter((p) => waitingOnADate(p.milestones)) : all

  const gone = useMemo(() => {
    if (!Array.isArray(archived)) return []
    const live = new Set(rows.map((r) => r.id))
    return archived
      // TWO POPULATIONS COME BACK FROM THAT READ and only one of them left the process: the Archive also lists…
      .filter((a) => a.archived && !live.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ row: a, milestones: archivedMilestones(a) }))
  }, [archived, rows])

  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[8px]', TINT_BG.lavender, TINT_FG.lavender)}>
          <CheckCircle2 size={13} />
        </span>
        <p className="text-[13px] font-semibold text-text-1">The journey</p>
        <p className="min-w-0 flex-1 truncate text-[12px] text-text-3">
          One line per person: what has already happened to them, in the order it happens.
        </p>
        {/* the old queue, as a lens over the same list */}
        {waitingCount > 0 && (
          <button
            onClick={() => setOnlyWaiting((v) => !v)}
            title={onlyWaiting ? 'Show everybody again' : 'Show only the people a date is missing for'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-bold transition-colors',
              onlyWaiting ? 'bg-warning text-white' : cn(TINT_BG.amber, TINT_FG.amber),
            )}
          >
            <Clock size={11} /> {waitingCount} waiting on a date
          </button>
        )}
        <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', TINT_BG.lavender, TINT_FG.lavender)}>
          {people.length + (onlyWaiting ? 0 : gone.length)}
        </span>
      </div>

      {people.length === 0 && (
        <p className="px-3 py-4 text-[12.5px] italic text-text-3">
          {onlyWaiting ? 'Every active phase has its date.' : 'Nobody is in the process right now.'}
        </p>
      )}
      <div className="divide-y divide-border/60">
        {people.map(({ row, milestones }) => (
          <JourneyPerson
            key={row.id}
            id={row.id}
            name={row.name}
            email={row.email}
            pill={STAGE_LABEL[row.stage] ?? row.stage}
            tint={STAGE_TINT[row.stage] ?? 'blue'}
            days={row.daysInStage == null ? '' : `${row.daysInStage}d`}
            milestones={milestones}
            writer={writer}
            open={open === row.id}
            onToggle={() => setOpen(open === row.id ? '' : row.id)}
            onSchedule={onSchedule}
            onSaved={onSaved}
            onInvite={onInvite}
            inviting={inviting}
          />
        ))}
      </div>

      {/* ── the eighth fact: the people who left ──
          They are not in the candidates slice at all, so this half of the list
          comes from the Archive's own read and carries its own three states. */}
      <div className="flex items-center gap-2 border-y border-border bg-surface-2/40 px-3 py-1.5">
        <X size={12} className="shrink-0 text-text-3" />
        <p className="text-[12px] font-semibold text-text-2">Left the process</p>
        <p className="min-w-0 flex-1 truncate text-[11.5px] text-text-3">
          {archived === null
            ? (writer ? 'Reading the archive…' : 'Only admins and managers may read the archive, so this half of the list stays closed here.')
            : archived === false
              ? 'The archive could not be read. That is not an empty archive — it is a read that failed, and the difference matters.'
              : gone.length === 0
                ? 'Nobody has been excluded from the process.'
                : `${gone.length} ${gone.length === 1 ? 'person' : 'people'}, each with the day they left and the reason on their row.`}
        </p>
      </div>
      <div className="divide-y divide-border/60">
        {gone.map(({ row, milestones }) => (
          <JourneyPerson
            key={row.id}
            id={row.id}
            name={row.name}
            pill="Excluded"
            tint="slate"
            days=""
            archived
            milestones={milestones}
            tail="Everything between those two days — the screen, the interview, the packet — lives on a row this list can no longer read: an excluded person leaves the candidates slice entirely. Their profile still carries the whole record."
            writer={writer}
            open={open === row.id}
            onToggle={() => setOpen(open === row.id ? '' : row.id)}
            onSchedule={onSchedule}
            onSaved={onSaved}
            onInvite={onInvite}
            inviting={inviting}
          />
        ))}
      </div>
    </Card>
  )
}

// ------------------------------------------------------------------ the schedule modal — the write, and the e-mail…

export function ScheduleModal({ rows, initial, onClose, onDone }: {
  rows: FlowRow[]
  initial: { cid: string; name: string; type: string }
  onClose: () => void
  onDone: () => void
}) {
  const { label: STAGE_LABEL } = usePhases()
  const [cid, setCid] = useState(initial.cid)
  const [type, setType] = useState(initial.type || 'in_person_interview')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [location, setLocation] = useState('')
  const [withName, setWithName] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const candidate = rows.find((r) => r.id === cid)
  // the legacy required both for an in-person interview, and it was right: an interview without a room or a person…
  const needsDetails = type === 'in_person_interview'
  const ready = !!cid && !!date && (!needsDetails || (location.trim() && withName.trim()))

  const save = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const d = await gasAction<{ event: FlowEvent; mail: { emailed: boolean; reason?: string; redirected?: boolean } }>(
        'hiringScheduleCreate',
        { candidate_id: cid, event_type: type, date, time, location: location.trim(), with_name: withName.trim(), notes: notes.trim() },
      )
      const mail = d.mail
      toast({
        type: 'success',
        title: 'Scheduled',
        body: mail?.emailed
          ? (mail.redirected ? 'Rehearsal: the e-mail went to the testers.' : 'The candidate was e-mailed as asa-hub.')
          : mail?.reason === 'situation_off'
            ? 'No e-mail: the hiring_event_scheduled switch is off in Smart Comms.'
            : mail?.reason === 'no_email'
              ? 'No e-mail on file for this candidate.'
              : mail?.reason === 'already_told'
                ? 'Already e-mailed about this day — not repeated.'
                : 'Saved; the e-mail did not go out.',
      })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not scheduled', body: e instanceof Error ? e.message : 'Try again.' })
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-2" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-1">Schedule</h2>
          <button onClick={onClose} className="text-text-3 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="space-y-2.5">
          <select value={cid} onChange={(e) => setCid(e.target.value)} className={inputCls} autoFocus={!initial.cid}>
            <option value="">Choose a candidate…</option>
            {rows.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
              <option key={r.id} value={r.id}>{r.name} — {STAGE_LABEL[r.stage] ?? r.stage}</option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            {EVENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2.5">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </div>
          {needsDetails && (
            <div className="grid grid-cols-2 gap-2.5">
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location *" className={inputCls} />
              <input value={withName} onChange={(e) => setWithName(e.target.value)} placeholder="Interviewer *" className={inputCls} />
            </div>
          )}
          {!needsDetails && (
            <div className="grid grid-cols-2 gap-2.5">
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" className={inputCls} />
              <input value={withName} onChange={(e) => setWithName(e.target.value)} placeholder="With" className={inputCls} />
            </div>
          )}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the e-mail (optional)" rows={2} className={inputCls} />
          {/* WHAT THE PRESS SENDS, SAID BEFORE IT IS PRESSED. The warning half
              of this has always been here; the other half — that a real letter
              leaves in the hub's own voice when there IS an address — was only
              ever reported in the toast afterwards, which is the wrong order
              for something a candidate reads. */}
          {candidate && !candidate.email && (
            <p className="flex items-center gap-1.5 text-[12px] text-warning"><Mail size={12} /> No e-mail on file — the schedule saves, nobody is mailed.</p>
          )}
          {candidate?.email && (
            <p className="flex items-start gap-1.5 text-[12px] text-text-3">
              <Mail size={12} className="mt-[3px] shrink-0" />
              <span>
                {/^\s*\[test\]/i.test(candidate.name)
                  ? 'A rehearsal card — the letter goes to the testers, never to the person named.'
                  : <>Scheduling e-mails <span className="font-semibold text-text-2">{candidate.email}</span> as asa-hub about this day, unless the hiring_event_scheduled switch is off or they were already told about it.</>}
              </span>
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnCls}>Cancel</button>
          <button
            onClick={() => void save()}
            disabled={!ready || busy}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary disabled:opacity-40"
          >
            {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
