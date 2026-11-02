// Shift Person Full Profile — a large slide-up modal opened from a shift card's "Open full profile" action (card…
// Unique per-person view: · header band — avatar, name, role, mono stat chips (shifts / houses / overshifts / next)…
import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import {
  ArrowUpRight,
  Droplets,
  Dumbbell,
  MapPin,
  MessageCircle,
  Minus,
  Moon,
  Pill,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react'
import { houses, houseById, rosterDate, shiftTimeline, type ShiftCard, type ShiftHouse } from '@/lib/seed-shifts2'
import { hydrationProfiles, sleepProfiles, workoutPlans } from '@/lib/seed-wellbeing'
import { medications } from '@/lib/seed-meds'
import { clients } from '@/lib/seed-care'
import SafeImg, { IconTile } from '@/components/shared/SafeImg'
import DragPerson from '@/components/shared/DragPerson'
import { useDragFocusEnabled } from '@/lib/dragFocus'
import { mapsSearchUrl } from '@/lib/maps'
import { messagePerson } from '@/lib/messagePerson'
import { TINT_BG, TINT_FG, TINT_VAR, type ExtendedTintName } from '@/lib/tints'
import { kindChipClasses } from './shiftUi'
import { useClockTimes } from './clockPref'
import { cellText } from './cellClock'
import { cn } from '@/lib/utils'

/* ---------------- derivations ---------------- */

const workedDays = (c: ShiftCard) => c.week.filter((w) => w.kind !== 'off' && w.kind !== 'ro').length

/** Deterministic hash → index (fallback resident pick). */
function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

type NextAssignment = { clientName: string; house?: ShiftHouse; when: string }

// The client this person will work with NEXT — earliest upcoming timeline entry for the staff member this roster…
function nextAssignment(card: ShiftCard): NextAssignment | null {
  // Ohio's today decides which shift is the next one.
  const todayISO = format(ohioWall(new Date()) as Date, 'yyyy-MM-dd')
  const mine = shiftTimeline
    .filter((e) => e.staffName === card.personName)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
  const entry = mine.find((e) => e.date >= todayISO) ?? mine[0]
  if (entry) {
    return {
      clientName: entry.clientName,
      house: houseById(entry.houseId),
      when: format(new Date(`${entry.date}T12:00:00`), 'EEE MMM d'),
    }
  }
  const house = houses.find((h) => h.code === `CAN-${card.next.houseCode}`)
  if (!house || house.residents.length === 0) return null
  return {
    clientName: house.residents[hashOf(card.personName) % house.residents.length],
    house,
    when: card.next.date,
  }
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  const Icon: LucideIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const tint: ExtendedTintName = trend === 'up' ? 'mint' : trend === 'down' ? 'danger' : 'slate'
  return <Icon size={14} style={{ color: TINT_VAR[tint] }} aria-label={`Trend ${trend}`} />
}

/* ---------------- combo tile ---------------- */

function ComboTile({
  tint,
  icon: Icon,
  label,
  children,
}: {
  tint: ExtendedTintName
  icon: LucideIcon
  label: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-[118px] flex-col rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', TINT_BG[tint], TINT_FG[tint])}>
          <Icon size={14} />
        </span>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
          {label}
        </span>
      </div>
      {children ? (
        children
      ) : (
        <p className="mt-auto pt-4 text-[12.5px] font-medium text-text-3">No data yet</p>
      )}
    </div>
  )
}

/* ---------------- modal body ---------------- */

function ProfileBody({ card, onClose }: { card: ShiftCard; onClose: () => void }) {
  const dragEnabled = useDragFocusEnabled('shiftboard')
  // The Time switch.
  const clock = useClockTimes()
  const worked = workedDays(card)
  const overshifts = Math.max(0, worked - 4)
  const nextChipIdx = card.week.findIndex((_, i) => format(rosterDate(i), 'MMM d') === card.next.date)
  const house = houses.find((h) => h.code === `CAN-${card.next.houseCode}`)
  const upcoming = nextAssignment(card)

  const clientName = upcoming?.clientName
  const hydration = hydrationProfiles.find((p) => p.clientName === clientName)
  const sleep = sleepProfiles.find((p) => p.clientName === clientName)
  const workout = workoutPlans.find((p) => p.clientName === clientName)
  const meds = medications.filter((m) => m.clientName === clientName)
  const prnCount = meds.filter((m) => m.schedule === 'prn').length
  const clientId =
    hydration?.clientId ??
    sleep?.clientId ??
    workout?.clientId ??
    meds[0]?.clientId ??
    clients.find((c) => c.name === clientName)?.id ??
    null

  const firstName = card.personName.split(/\s+/)[0]
  const navigate = useNavigate()
  const monoChip = 'rounded-sm bg-surface-3 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-2'

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      role="dialog"
      aria-modal="true"
      aria-label={`${card.personName} full profile`}
      className="pointer-events-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface shadow-3"
    >
      {/* header band */}
      <div className="relative border-b border-border bg-surface-2 px-5 py-5 sm:px-6">
        <button
          onClick={onClose}
          aria-label="Close profile"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors duration-150 hover:bg-surface-3 hover:text-text-1"
        >
          <X size={16} />
        </button>
        <div className="flex flex-wrap items-center gap-4">
          {/* the portrait carries the same person the name below does — half a
              header that drags is worse than none */}
          <DragPerson
            name={dragEnabled ? card.personName : ''}
            id={card.personId}
            avatar={card.avatar}
            subtitle="Direct Support Professional"
            className="shrink-0"
          >
            <SafeImg src={card.avatar} name={card.personName} size={72} shape="round" />
          </DragPerson>
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-extrabold tracking-tight text-text-1">
              {/* blank name when the app's Drag & drop toggle is off — renders plain text */}
              <DragPerson
                name={dragEnabled ? card.personName : ''}
                id={card.personId}
                avatar={card.avatar}
                subtitle="Direct Support Professional"
              >
                {card.personName}
              </DragPerson>
            </h2>
            <p className="text-[13px] text-text-3">Direct Support Professional</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={monoChip}>{card.totalShifts} shifts</span>
              <span className={monoChip}>{card.houseCount} houses</span>
              <span
                className={cn(
                  'rounded-sm px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]',
                  overshifts > 0 ? cn(TINT_BG.warning, TINT_FG.warning) : 'bg-surface-3 text-text-3',
                )}
                title={overshifts > 0 ? `${worked} worked days this week — ${overshifts} beyond the 4-shift base` : 'Within the 4-shift base this week'}
              >
                {overshifts} overshift{overshifts === 1 ? '' : 's'}
              </span>
              <span className={cn(monoChip, 'text-primary')}>
                Next: {card.next.date} · {cellText(card.next.code, clock)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        {/* this week strip */}
        <section>
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
            This week — Sat → Sun
          </p>
          <div className="grid grid-cols-7 gap-1.5">
            {card.week.map((w, i) => (
              <div key={w.day} className="flex min-w-0 flex-col items-center gap-1">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-text-3">{w.day}</span>
                <span
                  className={cn(
                    'w-full truncate rounded-sm px-0.5 py-1.5 text-center font-mono text-[10px] font-semibold leading-3',
                    kindChipClasses(w.kind),
                    i === nextChipIdx && 'ring-2 ring-primary ring-offset-1 ring-offset-surface',
                  )}
                  title={`${w.day} · ${cellText(w.code, clock)}${i === nextChipIdx ? ' · next shift' : ''}`}
                >
                  {w.code}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* current placement */}
        {house && (
          <section className="rounded-lg border border-border bg-surface-2 p-4">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
              Current placement
            </p>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[12px] font-bold text-primary">{house.code}</span>
              <span className="text-[14px] font-semibold text-text-1">{house.name}</span>
            </div>
            <a
              href={mapsSearchUrl(house.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-text-2 underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-primary"
            >
              <MapPin size={13} className="shrink-0 text-text-3" />
              {house.address}
            </a>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-text-3">Residents:</span>
              {house.residents.map((r) => (
                <span key={r} className="rounded-sm bg-surface-3 px-2 py-0.5 text-[11.5px] font-medium text-text-2">
                  {/* type client: residents are the consumers served here, not staff */}
                  <DragPerson name={dragEnabled ? r : ''} type="client" subtitle={house.name}>
                    {r}
                  </DragPerson>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* next assignment + wellbeing combo */}
        {upcoming && (
          <section>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
              Next assignment
            </p>
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <DragPerson
                  name={dragEnabled ? upcoming.clientName : ''}
                  id={clientId ?? undefined}
                  type="client"
                  subtitle={upcoming.house?.name}
                  className="shrink-0"
                >
                  <IconTile name={upcoming.clientName} size={44} />
                </DragPerson>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-text-1">
                    Up next —{' '}
                    <DragPerson
                      name={dragEnabled ? upcoming.clientName : ''}
                      id={clientId ?? undefined}
                      type="client"
                      subtitle={upcoming.house?.name}
                    >
                      {upcoming.clientName}
                    </DragPerson>
                    {upcoming.house && (
                      <span className="text-text-3"> at </span>
                    )}
                    {upcoming.house && (
                      <span className="font-mono text-[13px] font-bold text-primary">{upcoming.house.code}</span>
                    )}
                  </p>
                  <p className="text-[12px] text-text-3">
                    {upcoming.when} · {cellText(card.next.code, clock)}
                    {upcoming.house ? ` · ${upcoming.house.name}` : ''} — care combo for this client below
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* HYDRATION */}
                <ComboTile tint="blue" icon={Droplets} label="Hydration">
                  {hydration && (
                    <>
                      <p className="mt-2.5 text-xl font-bold leading-6 text-text-1">
                        {hydration.avgOz}
                        <span className="text-[12px] font-semibold text-text-3"> oz</span>
                      </p>
                      <p className="text-[11.5px] text-text-3">of {hydration.targetOz} oz target</p>
                      <div className="mt-auto flex items-center gap-2 pt-2.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.round((hydration.avgOz / hydration.targetOz) * 100))}%`,
                              backgroundColor: TINT_VAR.blue,
                            }}
                          />
                        </div>
                        <TrendArrow trend={hydration.trend} />
                      </div>
                    </>
                  )}
                </ComboTile>

                {/* SLEEP */}
                <ComboTile tint="lavender" icon={Moon} label="Sleep">
                  {sleep && (
                    <>
                      <p className="mt-2.5 text-xl font-bold leading-6 text-text-1">
                        {sleep.avgHours}
                        <span className="text-[12px] font-semibold text-text-3"> h</span>
                      </p>
                      <p className="text-[11.5px] text-text-3">of {sleep.targetHours} h target</p>
                      <div className="mt-auto flex items-center gap-1.5 pt-2.5">
                        <span className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold', TINT_BG.lavender, TINT_FG.lavender)}>
                          Q {sleep.quality}
                        </span>
                        <TrendArrow trend={sleep.trend} />
                      </div>
                    </>
                  )}
                </ComboTile>

                {/* WORKOUT */}
                <ComboTile tint="mint" icon={Dumbbell} label="Workout">
                  {workout && (
                    <>
                      <p className="mt-2.5 truncate text-[15px] font-bold leading-6 text-text-1" title={workout.activity}>
                        {workout.activity}
                      </p>
                      <p className="text-[11.5px] text-text-3">{workout.durationMin} min session</p>
                      <div className="mt-auto pt-2.5">
                        <span className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase', TINT_BG.mint, TINT_FG.mint)}>
                          {workout.intensity}
                        </span>
                      </div>
                    </>
                  )}
                </ComboTile>

                {/* MEDICATIONS */}
                <ComboTile tint="amber" icon={Pill} label="Medications">
                  {meds.length > 0 && (
                    <>
                      <p className="mt-2.5 text-xl font-bold leading-6 text-text-1">
                        {meds.length}
                        <span className="text-[12px] font-semibold text-text-3"> meds</span>
                      </p>
                      <p className="text-[11.5px] text-text-3">{prnCount} PRN · {meds.length - prnCount} scheduled</p>
                      <div className="mt-auto flex flex-wrap gap-1 pt-2">
                        {meds.slice(0, 3).map((m) => (
                          <span
                            key={m.id}
                            className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-text-2"
                            title={`${m.name} ${m.dose}${m.schedule === 'prn' ? ' · PRN' : ''}`}
                          >
                            {m.name} {m.dose}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </ComboTile>
              </div>
            </div>
          </section>
        )}

        {/* footer actions */}
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          {clientId ? (
            <Link
              to={`/app/clients/directory?record=${clientId}`}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
            >
              <ArrowUpRight size={14} /> Open client profile
            </Link>
          ) : (
            <button
              disabled
              title="No client record resolvable for this assignment"
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpRight size={14} /> Open client profile
            </button>
          )}
          <button
            onClick={() => void messagePerson(card.personName, navigate)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            <MessageCircle size={14} /> Message {firstName}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/* ---------------- host (backdrop + Esc) ---------------- */

export default function ShiftPersonProfile({
  card,
  onClose,
}: {
  card: ShiftCard | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, onClose])

  return (
    <AnimatePresence>
      {card && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/45"
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-y-auto p-4">
            <ProfileBody card={card} onClose={onClose} />
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}
