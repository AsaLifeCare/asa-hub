// Calendar Builder · Smart Comms — who could cover, why, and what we would say.
// This screen stands in front of the Builder: on the combined know-how of Smart Comms and Behavior Support, the…
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Clock, ExternalLink,
  MessageSquareText, RefreshCw, ShieldQuestion, UserRound,
} from 'lucide-react'
import { Link } from 'react-router'
import Card, { CardHeader } from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { Badge } from '@/components/shared/Badge'
import Avatar from '@/components/shared/Avatar'
import { TINT_FG } from '@/lib/tints'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'
import {
  useCoverageData,
  type CoverageCallOff, type CoverageCandidate, type CoverageVacancy, type RosterProfile,
} from './useCoverageData'

// '2026-09-12' → 'Sat, Sep 12' — local-noon parse, never `new Date(iso)` (the day-only off-by-one the platform…
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  if (!m) return String(iso ?? '') || '—'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Hours as the desk reads them: "0.5h", "14h". */
function fmtH(h: number | null): string {
  if (h === null || h === undefined) return '—'
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

/** '2026-09-01T14:30' → '2:30 PM'. Parsed off the string, never `new Date(iso)`. */
function fmtClock(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso ?? ''))
  if (!m) return ''
  const h = Number(m[1])
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m[2] === '00' ? `${h12} ${suffix}` : `${h12}:${m[2]} ${suffix}`
}

// WHAT THE DOUBLE-BOOKING ACTUALLY ASKS OF THE PERSON, in hours and houses.
function stretch(group: CoverageVacancy[]): {
  from: string; to: string; hours: number; houses: string[]; overlap: number | null
} | null {
  if (group.length < 2) return null
  const at = (iso: string): number | null => {
    const t = Date.parse(String(iso ?? '').length === 16 ? `${iso}:00` : iso)
    return Number.isNaN(t) ? null : t
  }
  const starts = group.map((v) => at(v.starts_at))
  const ends = group.map((v) => at(v.ends_at))
  if (starts.some((s) => s === null) || ends.some((e) => e === null)) return null
  const from = Math.min(...(starts as number[]))
  const to = Math.max(...(ends as number[]))
  const first = group.find((v) => at(v.starts_at) === from)
  const last = group.find((v) => at(v.ends_at) === to)
  if (!first || !last) return null
  return {
    from: fmtClock(first.starts_at),
    to: fmtClock(last.ends_at),
    hours: Math.round(((to - from) / 3_600_000) * 10) / 10,
    houses: [...new Set(group.map((v) => v.house).filter(Boolean))],
    overlap: group[0].conflict_overlap_hours,
  }
}

// THE WORDS, COMPOSED HERE AND SENT BY NOBODY.
function draftMessage(v: CoverageVacancy, c: CoverageCandidate): string {
  const first = c.name.split(' ')[0] || c.name
  const when = fmtDay(v.date)
  return (
    `Hi ${first} — ${v.house} needs someone for ${v.text} on ${when}. ` +
    `You are not on the calendar anywhere that hour. Are you able to take it? ` +
    `Nothing is booked until you say yes and a manager puts it on the grid.`
  )
}

type Tab = 'conflicts' | 'open' | 'people'

export default function CoverageTab() {
  return <CoverageTabBody />
}

// THE CALL-OFFS THIS PERIOD, AT THE TOP (package 2).
function CallOffBlock({ rows }: { rows: CoverageCallOff[] | null }) {
  const newest = useMemo(() => {
    if (!rows) return null
    const day = (r: CoverageCallOff) => String(r.shift_date || r.recorded_at || '').slice(0, 10)
    return [...rows]
      .filter((r) => day(r) && (r.person_name || r.person_key))
      .sort((a, b) => (day(b) > day(a) ? 1 : day(b) < day(a) ? -1 : 0))
      .slice(0, 8)
  }, [rows])

  if (!rows) {
    return (
      <Card className="mb-4 flex items-start gap-2.5">
        <CalendarClock size={15} className={cn('mt-0.5 shrink-0', TINT_FG.slate)} />
        <p className="text-[12.5px] leading-[1.55] text-text-2">
          The call-off book did not answer here, so this block is empty for a reason and not
          because nobody called off. The Hotline screen reads the same book directly.
        </p>
      </Card>
    )
  }

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-text-1">
          Call-offs on record {newest && newest.length ? `— newest ${newest.length}` : ''}
        </p>
        <p className="text-[11.5px] text-text-3">{rows.length} in the book</p>
      </div>
      {!newest || !newest.length ? (
        <p className="mt-2 text-[12.5px] leading-[1.55] text-text-3">
          The book is readable and holds no call-off with a day on it.
        </p>
      ) : (
        <ul className="mt-2.5 divide-y divide-border">
          {newest.map((r, i) => (
            <li key={String(r.id || i)} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
              <span className="text-[12.5px] font-semibold text-text-1">
                {String(r.person_name || r.person_key || 'somebody the row does not name')}
              </span>
              <span className="text-[12px] text-text-2">
                {String(r.shift_date || '').slice(0, 10) || 'no day on the row'}
              </span>
              {String(r.house || '').trim() ? (
                <span className="text-[12px] text-text-3">{String(r.house).trim()}</span>
              ) : (
                <span className="text-[12px] text-text-3">no house resolved</span>
              )}
              <span className="ml-auto text-[11.5px] text-text-3">
                {String(r.subject_state || '').trim() || 'recorded'}
                {String(r.source || '').trim() ? ` · ${String(r.source).trim()}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-[11.5px] leading-[17px] text-text-3">
        No reason is printed here: that is the caller&apos;s own account of her morning. A{' '}
        <span className="font-semibold text-text-2">C/O</span> written straight into the calendar is
        <span className="font-semibold text-text-2"> calendar only</span> — it is not in this book and
        nobody was told about it.
      </p>
    </Card>
  )
}

function CoverageTabBody() {
  const { vacancies, profiles, callOffs, loading, stale, noDoor, reload } = useCoverageData()
  const [tab, setTab] = useState<Tab>('conflicts')

  // THE DIAL, READ AND NEVER ASSUMED.
  const [dial, setDial] = useState('')
  const [dialRead, setDialRead] = useState(false)
  const [dialPending, setDialPending] = useState(true)

  const readDial = useCallback(async () => {
    setDialPending(true)
    try {
      const board = await gasAction<{ dial?: string }>('commBoard', {}, { timeoutMs: 120_000 })
      setDial(String(board.dial ?? ''))
      setDialRead(true)
    } catch {
      setDialRead(false)
    } finally {
      setDialPending(false)
    }
  }, [])
  useEffect(() => { void readDial() }, [readDial])

  // ONE CARD PER PERSON, not one per collision.
  const conflicts = useMemo(() => {
    const byConflict = new Map<string, CoverageVacancy[]>()
    for (const v of vacancies ?? []) {
      if (!v.conflict_id) continue
      const list = byConflict.get(v.conflict_id)
      if (list) list.push(v)
      else byConflict.set(v.conflict_id, [v])
    }
    const byPerson = new Map<string, CoverageVacancy[][]>()
    for (const group of byConflict.values()) {
      const head = group[0]
      const key = head.kind === 'not_a_staffing_question'
        ? `~${head.conflict_id}`          // never merged under a person's name
        : (head.held_by || `~${head.conflict_id}`)
      const held = byPerson.get(key)
      if (held) held.push(group)
      else byPerson.set(key, [group])
    }
    return [...byPerson.values()]
      .map((groups) => groups.sort((a, b) => a[0].date.localeCompare(b[0].date)))
      .sort((a, b) => a[0][0].date.localeCompare(b[0][0].date))
  }, [vacancies])

  // Family time, set aside rather than dropped.
  const familyTime = useMemo(
    () =>
      (vacancies ?? []).filter(
        (v) =>
          v.kind === 'not_a_staffing_question' &&
          /^\s*family\s*$/i.test(String(v.held_by ?? '')),
      ),
    [vacancies],
  )

  const shown = useMemo(
    () =>
      conflicts.filter(
        (groups) => !/^\s*family\s*$/i.test(String(groups[0][0].held_by ?? '')),
      ),
    [conflicts],
  )

  const opens = useMemo(
    () => (vacancies ?? []).filter((v) => v.kind === 'open_cell'),
    [vacancies],
  )

  const answered = shown.filter((gs) => gs.some((g) => g.some((v) => v.qualified > 0))).length
  const openAnswered = opens.filter((v) => v.qualified > 0).length
  const period = vacancies?.[0]

  return (
    <div className="pb-10">
      {/* THE HEADLINE. Three numbers and the sentence that keeps them honest:
          a conflict is an excess, not a gap. */}
      <div className="mb-4 rounded-[16px] bg-detail-hero p-5 shadow-2 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-3">
          <Figure
            label="Double-bookings"
            value={vacancies ? conflicts.length : null}
            sub={vacancies ? `${answered} have somebody who could take a released cell` : 'nothing has answered yet'}
          />
          <Figure
            label="Shifts with nobody on them"
            value={vacancies ? opens.length : null}
            sub={vacancies ? `${openAnswered} have at least one name` : 'nothing has answered yet'}
          />
          <Figure
            label="People on the roster"
            value={profiles ? profiles.length : null}
            sub={period ? `${period.period_from} → ${period.period_to}` : 'the period has not answered'}
          />
        </div>
        <p className="mt-4 text-[12.5px] leading-[1.6] text-white/75">
          Not one of the double-bookings is an unfilled shift — every one is the same name in two
          places, so &ldquo;filling&rdquo; it means clearing or trimming one of two cells, and only then is there a
          shift for somebody else. The shifts that genuinely need a person are the OPEN rows.
          Nothing on this screen assigns anybody: it proposes a name, a person decides, and the
          Builder&apos;s draft cell (Calendar Builder → Builder) is still the only way a roster changes.
        </p>
      </div>

      {/* THE CALL-OFFS THEMSELVES, ABOVE EVERYTHING ELSE (package 2: "call-off
          block at the top of the first page"). The rest of this screen answers
          "who could cover"; this answers "cover WHAT" — the absences the
          platform recorded, newest first, with the day they are about and
          whether anybody was told. No reason is printed: that is the caller's
          own account of her morning and it has no business on a scheduling
          board. */}
      <CallOffBlock rows={callOffs} />

      {/* WHAT WOULD ACTUALLY HAPPEN IF SOMEBODY ACTED ON THIS. */}
      <Card className="mb-4 flex flex-wrap items-start gap-2.5">
        <MessageSquareText size={15} className={cn('mt-0.5 shrink-0', TINT_FG.violet)} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            {dialPending ? (
              <>Reading the comms dial…</>
            ) : dialRead ? (
              dial === 'send' ? (
                <>
                  The comms dial says <strong className="text-text-1">send</strong>: cleared threads
                  are handed to the transport. Nothing is handed over from <em>this</em> screen — the
                  words below are a draft for a person to use, and no message leaves here.
                </>
              ) : (
                <>
                  The comms dial says <strong className="text-text-1">{dial || 'off'}</strong> — the
                  lane works everything out and hands nothing over. Even on <em>send</em> nothing
                  would leave this screen: the words below are a draft for a person to read out, not
                  a queued message.
                </>
              )
            ) : (
              <>
                The comms dial did not answer, so this page will not say what it is set to. What it
                can say either way: nothing is sent from here. The words below are a draft for a
                person to use.
              </>
            )}
          </p>
        </div>
        <Link
          to="/app/smartcomms/overview"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          Smart Comms <ExternalLink size={12} />
        </Link>
      </Card>

      {noDoor && (
        <Card className="mb-4 flex items-start gap-2.5">
          <AlertTriangle size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            The coverage reading has no door on this deployment yet. It reads the{' '}
            <code className="font-stat">coverageSuggestions</code> and{' '}
            <code className="font-stat">rosterProfile</code> slices, and neither answered — so this
            screen is showing nothing rather than an empty roster. A refusal here is deliberate: a
            lane that cannot load its own ladder must not fall back to a ranking of its own.
          </p>
        </Card>
      )}

      {stale && (
        <Card className="mb-4 flex items-start gap-2.5">
          <Clock size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            Nothing answered just now — this is the last reading this tab held. A cell may have
            moved on the grid since, which would change who is free.
          </p>
        </Card>
      )}

      {/* THE EMPLOYMENT CHECK, SAID ONCE. Every vacancy row carries the same
          check, so it is read off the first one rather than drawn 38 times. */}
      {period && <EmploymentBanner check={gateOf(period).check} />}

      {/* the tabs — the app's underline bar, with counts */}
      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {([
          ['conflicts', 'Double-bookings', vacancies ? conflicts.length : null],
          ['open', 'Shifts with nobody', vacancies ? opens.length : null],
          ['people', 'People', profiles ? profiles.length : null],
        ] as [Tab, string, number | null][]).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors sm:px-4',
              tab === id ? cn('border-current', TINT_FG.primary) : 'border-transparent text-text-3 hover:text-text-2',
            )}
          >
            {label}
            <span className="ml-1.5 font-stat text-[11.5px] opacity-70">{count ?? '—'}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => reload()}
          className="ml-auto mb-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && !vacancies && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[140px] w-full" />)}
        </div>
      )}

      {tab === 'conflicts' && vacancies && (
        shown.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title="No double-bookings in this period"
              body="Every rostered cell belongs to one person at one hour. This is computed over the same absolute clock the Builder's chip uses, so the two cannot drift apart."
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {shown.map((groups) => <ConflictBlock key={groups[0][0].conflict_id} groups={groups} />)}
            {/* SET ASIDE, AND SAID SO. Family time is not a staffing question —
                the client is with their own family and no caregiver is wanted —
                so those cells are not drawn as conflicts. They are counted here
                because a row that silently vanishes is the failure this screen
                exists to prevent, and because somebody will one day want to
                know the cells were seen and understood rather than missed. */}
            {familyTime.length > 0 && (
              <p className="px-1 text-[12px] leading-[1.5] text-text-3">
                {familyTime.length} further cell{familyTime.length === 1 ? ' is' : 's are'} family
                time — the client is with their own family and no caregiver is needed — so
                {familyTime.length === 1 ? ' it is' : ' they are'} not drawn as a conflict.
              </p>
            )}
          </div>
        )
      )}

      {tab === 'open' && vacancies && (
        opens.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              title="No open shift in this period"
              body="No OPEN row carries hours with nobody on it. Beyond this period there is no roster at all yet — the grid stops at the last day above, so there is nothing further ahead to suggest into until the desk rolls the dates forward."
            />
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {opens.map((v) => <VacancyCard key={v.id} v={v} />)}
            </div>
            <p className="mt-4 px-1 text-[12px] leading-[1.6] text-text-3">
              These are the shifts the next calendar inherits. There is no roster after{' '}
              {period ? fmtDay(period.period_to) : 'the last day of this period'} anywhere in this
              estate — not on the grid, not in the mirror — so the same ladder has nothing further
              ahead to rank against until the desk rolls the period forward or runs the generator.
              Saying that is better than drawing an empty week and calling it next month.
            </p>
          </>
        )
      )}

      {tab === 'people' && (
        profiles === null ? (
          <Card padded={false}>
            <EmptyState
              title={vacancies ? 'The roster profile is not served to this seat' : 'The roster profile did not answer'}
              body={
                vacancies
                  ? 'The suggestions answered and this did not, which on this platform means one thing: rosterProfile is served to administrators only. It is one row per person saying how much they work, what they wrote about their own week and what is expired against their name — a reading about named people, and not something a screen’s audience inherits by accident. The suggestions beside it are about shifts.'
                  : 'rosterProfile is a second slice and it did not reply, so nothing is drawn here rather than a page of people with every fact blank.'
              }
            />
          </Card>
        ) : (
          <PeopleList profiles={profiles} />
        )
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Figure({ label, value, sub }: { label: string; value: number | null; sub: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="font-stat text-[44px] leading-none text-white">{value ?? '—'}</p>
      <p className="mt-1 text-[12px] leading-[1.45] text-white/60">{sub}</p>
    </div>
  )
}

/* ---------- one double-booking, and its two possible releases ---------- */

function ConflictBlock({ groups }: { groups: CoverageVacancy[][] }) {
  const head = groups[0][0]
  const placeholder = head.kind === 'not_a_staffing_question'
  // The count is of COLLISIONS, not of cells: two cells are one double-booking and saying "four" about two would be…
  const times = groups.length
  const title = placeholder
    ? head.headline
    : times === 1
      ? `${head.held_by} is booked twice`
      : `${head.held_by} is booked twice on ${times} dates`
  // Over several collisions one overlap figure would be a lie by selection, so the badge carries the worst of them…
  const overlaps = groups
    .map((g) => g[0].conflict_overlap_hours)
    .filter((h): h is number => h !== null)
  const worst = overlaps.length ? Math.max(...overlaps) : null
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="p-5 pb-3">
        <CardHeader
          title={title}
          sub={head.shape}
          extra={
            <Badge
              label={
                worst === null
                  ? 'overlap'
                  : times > 1
                    ? `up to ${worst.toFixed(2)}h overlap`
                    : `${worst.toFixed(2)}h overlap`
              }
              tint={placeholder ? 'peach' : 'pink'}
            />
          }
        />
      </div>
      {placeholder ? (
        <div className="border-t border-border px-5 py-4">
          <p className="flex items-start gap-2 text-[12.5px] leading-[1.55] text-text-2">
            <ShieldQuestion size={15} className={cn('mt-0.5 shrink-0', TINT_FG.slate)} />
            {head.why_empty} Nobody is proposed, and that is the answer rather than a gap in one.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group[0].conflict_id}>
            {/* A date rule only where there is more than one collision — over a
                single one it would be furniture around nothing. */}
            {/* THE DEMAND, IN WORDS, ON EVERY COLLISION — not just a decimal.
                Drawn even on a single-collision card, because the span is the
                thing a person has to picture and the overlap alone hides it. */}
            {(() => {
              const s = stretch(group)
              return (
                <div className="border-t border-border bg-surface-2 px-5 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
                    {fmtDay(group[0].date)}
                  </p>
                  {s ? (
                    <p className="mt-1 text-[12.5px] leading-[1.5] text-text-2">
                      <span className="font-semibold text-text-1">
                        {s.from} to {s.to}
                      </span>{' '}
                      — {fmtH(s.hours)} end to end
                      {s.houses.length > 1
                        ? `, across ${s.houses.length} houses (${s.houses.join(' and ')})`
                        : `, at ${s.houses[0] || 'one house'}`}
                      {s.overlap !== null && (
                        <>
                          {' · '}
                          <span className={TINT_FG.pink}>
                            {s.overlap.toFixed(2)}h in both places at once
                          </span>
                        </>
                      )}
                      . That is a double.
                    </p>
                  ) : (
                    <p className="mt-1 text-[12.5px] text-text-3">
                      The two cells carry a time this page could not read, so the stretch is not
                      stated rather than guessed at.
                    </p>
                  )}
                </div>
              )
            })()}
            <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
              {group
                .slice()
                .sort((a, b) => a.conflict_side.localeCompare(b.conflict_side))
                .map((v) => (
                  <div key={v.id} className="bg-surface p-4">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
                      If this cell is released
                    </p>
                    <p className="text-[13.5px] font-semibold text-text-1">
                      {v.text} · {v.house}
                    </p>
                    <p className="mb-3 text-[12px] text-text-3">
                      {fmtDay(v.date)} · {fmtH(v.hours)}
                      {v.is_in_the_past && ' · already behind us'}
                    </p>
                    <Candidates v={v} />
                  </div>
                ))}
            </div>
          </div>
        ))
      )}
    </Card>
  )
}

/* ---------- one open shift ---------- */

function VacancyCard({ v }: { v: CoverageVacancy }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-text-1">
            {v.house} · {v.text}
          </p>
          <p className="text-[12px] text-text-3">
            {fmtDay(v.date)} · {fmtH(v.hours)} · grid row {v.sheet_row}
            {v.is_in_the_past && ' · already behind us'}
          </p>
        </div>
        <Badge
          label={v.qualified ? `${v.qualified} could take it` : 'nobody clears every fact'}
          tint={v.qualified ? 'mint' : 'amber'}
        />
      </div>
      <div className="px-4 py-3">
        <Candidates v={v} />
      </div>
    </Card>
  )
}

// ---------- the employment fact, and the only thing it is allowed to do ---- THE LINE THIS DRAWS.
type EmploymentCheck = {
  state?: string
  as_of?: string
  facts_read?: number
  prose_refused_on_rows?: number
  // Columns the gate did not expect and dropped — the two lanes' contracts drifting, which is quiet where the prose…
  unknown_columns_on_rows?: number
  // Rows the gate read and could NOT classify.
  facts_unreadable?: number
  /** Confident facts whose person matched nobody the ladder proposed. */
  facts_reached_nobody?: number
  people_withheld?: number
  withheld?: { name: string; because: string }[]
  unsure?: string[]
  unsure_facts?: number
}

function gateOf(v: CoverageVacancy): {
  withheld: { name: string; because: string }[]
  unsure: string[]
  check: EmploymentCheck
} {
  const raw = v as unknown as {
    withheld?: { name: string; because: string }[]
    employment_unsure?: string[]
    employment_check?: EmploymentCheck
  }
  return {
    withheld: Array.isArray(raw.withheld) ? raw.withheld : [],
    unsure: Array.isArray(raw.employment_unsure) ? raw.employment_unsure : [],
    check: raw.employment_check ?? {},
  }
}

// Per shift: the names the employment fact took off THIS list, and the names it was unsure about.
function EmploymentNote({ v }: { v: CoverageVacancy }) {
  const { withheld, unsure } = gateOf(v)
  if (withheld.length === 0 && unsure.length === 0) return null
  return (
    <div className="mt-2 space-y-1.5">
      {withheld.map((w) => (
        <p key={w.name} className="flex gap-2 text-[11.5px] leading-[1.5] text-text-3">
          <UserRound size={12} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <span>
            <span className="font-semibold text-text-2">{w.name}</span> is not offered this shift:{' '}
            {w.because}. This is the only thing the Staff Issues tracker is allowed to say here —
            it did not move anybody up or down the list above.
          </span>
        </p>
      ))}
      {unsure.length > 0 && (
        <p className="flex gap-2 text-[11.5px] leading-[1.5] text-text-3">
          <ShieldQuestion size={12} className={cn('mt-0.5 shrink-0', TINT_FG.blue)} />
          <span>
            The tracker is unclear about whether {unsure.join(', ')} still work
            {unsure.length === 1 ? 's' : ''} here. Unclear is not a verdict, so
            {unsure.length === 1 ? ' that name stays' : ' those names stay'} in the list exactly
            where the roster put {unsure.length === 1 ? 'it' : 'them'} — a person should check
            before anybody acts on it.
          </span>
        </p>
      )}
    </div>
  )
}

// Once at the top of the tab: did the employment check run, what did it do, and is the digest shipping words it was…
function EmploymentBanner({ check }: { check: EmploymentCheck }) {
  const ran = check.state === 'ran'
  const withheld = check.withheld ?? []
  const prose = check.prose_refused_on_rows ?? 0
  const drifted = check.unknown_columns_on_rows ?? 0
  const unsureFacts = check.unsure_facts ?? 0
  const unreadable = check.facts_unreadable ?? 0
  const orphaned = check.facts_reached_nobody ?? 0
  // silent only when nothing at all is to say — "unsure, so removed nobody" still gets a banner
  if (ran && withheld.length === 0 && prose === 0 && drifted === 0 &&
      unsureFacts === 0 && unreadable === 0 && orphaned === 0) return null
  return (
    <Card className="mb-4 flex items-start gap-2.5">
      {withheld.length > 0 ? (
        <UserRound size={15} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
      ) : (
        <ShieldQuestion size={15} className={cn('mt-0.5 shrink-0', TINT_FG.blue)} />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        {!ran && (
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            The employment check could not run — the <code className="font-stat">employmentFacts</code>{' '}
            slice has not been written, so nothing was read about whose employment has ended or who
            is suspended. It did not decide that everybody is employed, and it did not decide that
            anybody is gone: the lists below are the roster&apos;s own answer, unchanged, and a
            person who no longer works here could still be proposed on them.
          </p>
        )}
        {ran && withheld.length > 0 && (
          <>
            <p className="text-[12.5px] leading-[1.55] text-text-2">
              {withheld.length === 1 ? 'One person is' : `${withheld.length} people are`} held out of
              the suggestions below on an employment fact{check.as_of ? ` read ${check.as_of}` : ''}.
              Nothing else from the Staff Issues tracker reaches this screen — not the situation, not
              the follow-up, not the wording of an action, and no count of anybody&apos;s rows. Two
              people who both still work here come out of this ladder in exactly the order they came
              out in before this check existed.
            </p>
            <ul className="space-y-0.5">
              {withheld.map((w) => (
                <li key={w.name} className="text-[11.5px] leading-[1.5] text-text-3">
                  <span className="font-semibold text-text-2">{w.name}</span> — {w.because}. If that
                  is wrong, the tracker is where it is corrected; this screen only reads it.
                </li>
              ))}
            </ul>
          </>
        )}
        {ran && withheld.length === 0 && (
          <p className="text-[12.5px] leading-[1.55] text-text-2">
            The employment check ran{check.as_of ? ` on the reading of ${check.as_of}` : ''} and held
            nobody out of the suggestions below. Nothing from the Staff Issues tracker orders this
            list — not the situation, not the follow-up, not the wording of an action, and no count
            of anybody&apos;s rows.
          </p>
        )}
        {/* OUTSIDE the withheld branch on purpose. An unclear reading about a
            real person is the case a human is most needed for, and it used to
            print only when somebody ELSE had been confidently removed. */}
        {ran && unsureFacts > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-text-3">
            {unsureFacts} reading{unsureFacts === 1 ? ' was' : 's were'} unclear and removed nobody —
            unclear is not a verdict, and a wrong one takes a person&apos;s shifts away on a guess.
            Anyone the tracker was unclear about is still in the lists below, exactly where the
            roster put them, and is named on the shifts they appear on.
          </p>
        )}
        {ran && unreadable > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-text-3">
            {unreadable} row{unreadable === 1 ? '' : 's'} of that reading could not be understood
            here at all — no verdict this screen knows, or no resolved identity to attach one to.
            {check.facts_read ? ` ${check.facts_read} row${check.facts_read === 1 ? ' was' : 's were'} read in total.` : ''}{' '}
            That is a reading that could not look, not a tracker with nothing to say, and somebody
            should fix it before this check is relied on.
          </p>
        )}
        {ran && orphaned > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-text-3">
            {orphaned} employment fact{orphaned === 1 ? '' : 's'} named somebody who is not proposed
            anywhere in this period, so {orphaned === 1 ? 'it' : 'they'} removed nobody. That is
            usually right, and it is also what a name spelled differently in the two books looks
            like — which is why it is counted here instead of passing in silence.
          </p>
        )}
        {drifted > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-text-3">
            {drifted} row{drifted === 1 ? '' : 's'} carried a column this screen does not expect. It
            was dropped unread — nothing from it reached the ladder — but the two sides have drifted
            apart and somebody has to look.
          </p>
        )}
        {prose > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-text-3">
            {prose} row{prose === 1 ? '' : 's'} of that slice also carried the tracker&apos;s prose or
            a count. It was refused at the door and never reached the ladder — said here rather than
            trimmed in silence, because a lane that starts sending the words is a thing somebody has
            to go and fix.
          </p>
        )}
      </div>
    </Card>
  )
}

/* ---------- the ranked people, and the reason each one is there ---------- */

function Candidates({ v }: { v: CoverageVacancy }) {
  const [open, setOpen] = useState<string | null>(null)
  if (v.qualified === 0) {
    return (
      <div className="rounded-md bg-surface-2 px-3 py-2.5">
        <p className="text-[12.5px] leading-[1.55] text-text-2">
          {v.why_empty || 'Nobody on this roster clears every hard fact for this shift.'}
        </p>
        {v.why_not.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {v.why_not.map((w) => (
              <li key={w.because} className="text-[11.5px] text-text-3">
                <span className="font-stat">{w.people}</span> — {w.because}
              </li>
            ))}
          </ul>
        )}
        <EmploymentNote v={v} />
      </div>
    )
  }
  return (
    <>
      <p className="mb-2 text-[11.5px] text-text-3">
        <span className="font-stat text-text-2">{v.qualified}</span> of{' '}
        <span className="font-stat text-text-2">{v.considered}</span> people on the roster clear
        every hard fact. Ordered by the rest either side of the shift — a fact from the roster that
        answers for everybody — then alphabetically. Nothing soft moved anybody.
        {gateOf(v).withheld.length > 0 && (
          <>
            {' '}
            {gateOf(v).withheld.length} further name
            {gateOf(v).withheld.length === 1 ? ' was' : 's were'} held out of that count on an
            employment fact and {gateOf(v).withheld.length === 1 ? 'is' : 'are'} named below, not
            silently dropped.
          </>
        )}
      </p>
      <ul className="space-y-1.5">
        {v.candidates.map((c) => (
          <li key={c.person_key}>
            <button
              type="button"
              onClick={() => setOpen(open === c.person_key ? null : c.person_key)}
              className="flex w-full items-start gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <Avatar name={c.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-text-1">{c.name}</span>
                  <Badge
                    label={c.rest_hours === null ? 'nothing else rostered' : `${fmtH(c.rest_hours)} rest`}
                    tint={c.rest_hours === null || c.rest_hours >= 12 ? 'mint' : 'amber'}
                  />
                  {c.reach === 'in person' ? (
                    <Badge label="ask in person" tint="peach" />
                  ) : (
                    <Badge label={`by ${c.reach}`} tint="blue" />
                  )}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-[1.5] text-text-3">
                  {c.reasons[1] ?? c.reasons[0]}
                </span>
              </span>
              <span className="mt-0.5 shrink-0 text-text-3">
                {open === c.person_key ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>

            {open === c.person_key && (
              <div className="mt-1 space-y-2.5 rounded-md bg-surface-2 px-3 py-2.5">
                {/* THE LADDER, IN THE ORDER IT WAS APPLIED. A suggestion whose
                    reason cannot be read is not a suggestion. */}
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
                    Why this name, in the order the facts were applied
                  </p>
                  <ol className="space-y-0.5">
                    {c.reasons.map((r, i) => (
                      <li key={i} className="flex gap-2 text-[12px] leading-[1.5] text-text-2">
                        <span className="font-stat text-text-3">{i + 1}</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* SOFT, BESIDE AND NEVER INSIDE THE ORDER. */}
                {c.cautions.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
                      Beside it — none of this moved them up or down
                    </p>
                    <ul className="space-y-0.5">
                      {c.cautions.map((x, i) => (
                        <li key={i} className="flex gap-2 text-[12px] leading-[1.5] text-text-2">
                          <AlertTriangle size={12} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* THE WORDS. Drawn, never queued. */}
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
                    What Smart Comms would say — nothing is sent from here
                  </p>
                  <p className="rounded-md border border-border bg-surface px-2.5 py-2 text-[12.5px] leading-[1.55] text-text-1">
                    {draftMessage(v, c)}
                  </p>
                  <p className="mt-1 text-[11.5px] text-text-3">
                    {c.reach === 'in person'
                      ? 'No phone and no email on file, so there is no channel to say it on — this one is a conversation.'
                      : `Would go by ${c.reach}${c.reach_window ? ` · their window ${c.reach_window}` : ''}.`}{' '}
                    Consent still decides whether a person may be contacted at all.
                  </p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {v.also.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-[1.5] text-text-3">
          Also clear, with less rest either side:{' '}
          {v.also.map((a) => `${a.name} (${fmtH(a.rest_hours)})`).join(' · ')}. Nobody who clears
          every fact is hidden — a name dropped off the end of a list is a name the desk cannot see.
        </p>
      )}

      {v.why_not.length > 0 && (
        <p className="mt-1.5 text-[11.5px] leading-[1.5] text-text-3">
          The rest were refused:{' '}
          {v.why_not.map((w) => `${w.people} ${w.because}`).join(' · ')}.
        </p>
      )}

      <EmploymentNote v={v} />
    </>
  )
}

/* ---------- the people, hard facts and soft signals kept apart ---------- */

function PeopleList({ profiles }: { profiles: RosterProfile[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const needle = q.trim().toLowerCase()
  const shown = profiles.filter(
    (p) => !needle || `${p.name} ${p.fact_stated_shifts} ${p.fact_stated_note}`.toLowerCase().includes(needle),
  )
  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a person…"
        className="mb-3 h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary/50 sm:w-[280px]"
      />
      <Card padded={false} className="overflow-hidden">
        <ul>
          {shown.map((p) => (
            <li key={p.id} className="border-b border-border last:border-0">
              <button
                type="button"
                onClick={() => setOpen(open === p.id ? null : p.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
              >
                <Avatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13.5px] font-semibold text-text-1">{p.name}</span>
                    {p.fact_stated_bars && <Badge label={p.fact_stated_bars} tint="lavender" />}
                    {p.soft_preference_contradicted && <Badge label="roster contradicts it" tint="amber" />}
                    {p.fact_expired_blocking && <Badge label={`expired ${p.fact_expired_blocking}`} tint="pink" />}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-text-3">
                    {p.fact_shifts_rostered} shifts · {p.fact_hours_rostered}h · {p.fact_days_rostered} days ·{' '}
                    {p.fact_house_blocks} house block{p.fact_house_blocks === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="mt-0.5 shrink-0 text-text-3">
                  {open === p.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>

              {open === p.id && (
                <div className="space-y-3 bg-surface-2/50 px-4 pb-4 pt-1">
                  <Group
                    icon={<CalendarClock size={13} className={TINT_FG.primary} />}
                    title="Hard facts — the only things that rank"
                    items={[
                      ['Rostered', `${p.fact_shifts_rostered} shifts, ${p.fact_hours_rostered}h over ${p.fact_days_rostered} days (${p.fact_first_day} → ${p.fact_last_day})`],
                      ['House blocks', `${p.fact_house_blocks} — the count, not the codes: a house code stands 1:1 with a client's home, and this row is about a worker. The grid and the Hours tab name them, because those are roster cells.`],
                      ['They wrote', p.fact_stated_shifts || (p.fact_preference_reading === 'on_file' ? 'nothing in the shifts column' : 'no preference row on file — silence, not permission')],
                      ['Note on their row', p.fact_stated_note || '—'],
                      ['Stated bars that parse', p.fact_stated_bars || 'none'],
                      ['Weekend pool', `${p.fact_weekend_pool || '—'} — nothing in this estate says what the pools mean`],
                      ['Extra shifts', p.fact_pickup],
                      ['Time off asked for', p.fact_requests_touching_period ? p.fact_request_days : 'none touching this period'],
                      ['Credentials', p.fact_qualification_reading === 'counted'
                        ? `${p.fact_expired_blocking ? `expired: ${p.fact_expired_blocking}` : 'nothing expired that tells one person from another'}${p.fact_expiring_soon ? ` · expiring: ${p.fact_expiring_soon}` : ''}`
                        : 'no credentials row — unknown, which is not unqualified'],
                      ['Registry re-checks', p.fact_expired_shared_by_whole_roster
                        ? `${p.fact_expired_shared_by_whole_roster} — out of date for every person on this roster, so it separates nobody and bars nobody`
                        : '—'],
                      ['Training', p.fact_training_why || '—'],
                      ['In-service owed', p.fact_ist_owed === null ? '—' : String(p.fact_ist_owed)],
                      ['Reachable', p.fact_reach_route_on_file ? p.fact_reach_reading : 'no contact route on file — ask in person'],
                    ]}
                  />
                  <Group
                    icon={<AlertTriangle size={13} className={TINT_FG.amber} />}
                    title="Soft signals — annotation only, and none of this ever ordered a list"
                    items={[
                      ['Longest run', `${p.soft_longest_run_days} days in a row`],
                      ['Busiest week', `${p.soft_busiest_week_hours}h from ${p.soft_busiest_week_start || '—'}`],
                      ['Overnights', String(p.soft_overnights_rostered)],
                      ['Two cells in one day', p.soft_back_to_back_days || 'none'],
                      ['Roster against their own words', p.soft_preference_contradicted || 'nothing they wrote is contradicted'],
                      ['Call-offs recorded, all time', p.soft_call_off_reading === 'counted'
                        ? `${p.soft_call_offs_recorded_all_time} absence(s), and ${p.soft_late_shows_all_time} late show(s) — a late show is a shift they worked and is never added to the absences`
                        : 'none recorded, which is not the same sentence as never absent'],
                      ['Attendance books', p.soft_attendance_books || (p.soft_attendance_rate_state === 'not_served_here'
                        ? 'the punch-record reading is not served on this deployment'
                        : '—')],
                      ['Where the strain figures come from', p.soft_strain_measured_from],
                    ]}
                  />
                  <Group
                    icon={<ShieldQuestion size={13} className={TINT_FG.slate} />}
                    title="What this record deliberately does not carry"
                    items={[
                      ['Behaviour’s schedule verdict', p.refused_behaviour_schedule_verdict],
                      ['Platform use', p.refused_site_measurements],
                      ['Call-off prose', p.refused_call_off_prose],
                      ['Client identity', p.refused_client_identity],
                      ['Absence rate', p.refused_absence_rate_as_a_rank],
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {shown.length === 0 && (
        <p className="mt-3 px-1 text-[12px] text-text-3">Nobody on the roster matches that.</p>
      )}
      <p className="mt-3 px-1 text-[12px] leading-[1.6] text-text-3">
        <UserRound size={12} className="mr-1 inline align-[-1px]" />
        Only people the published grid names appear here. Somebody the roster has never heard of is
        unknown to this reading — not available, and not unreliable — so they are given no row that
        would read as an answer about them.
      </p>
    </>
  )
}

function Group({ icon, title, items }: { icon: ReactNode; title: string; items: [string, string][] }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">
        {icon} {title}
      </p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,180px)_1fr]">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[11.5px] leading-[1.5] text-text-3">{k}</dt>
            <dd className="mb-1 text-[12px] leading-[1.5] text-text-1 sm:mb-0">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
