// MY CALENDAR for a client-role account — the natural My Week (WeekCard) at the account's own house: every staff…
// From the backend's myFamily read through the same door (/hub-lanes/my-calendar), which cuts both to the account's…
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Phone, Stethoscope } from 'lucide-react'
import { useAuthStore } from '@/auth/useAuthStore'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { ReadStamp } from '@/components/FreshnessStamp'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cellText } from '@/pages/features/shifts/cellClock'
import { phoneHref } from '@/pages/features/myprofile/myProfileModel'
import {
  FamilyReadLine, FamilyRefused, FamilyUnlinked, RetryButton, SourceCard,
} from '@/pages/features/family/FamilyParts'
import {
  familyTitle, useFamilyRead, viewerKind, type Appointment, type FamilyCalendar, type FamilyShift, type FamilyState,
} from '@/pages/features/family/myFamily'
import { myCalendarPath } from './myCalendarModel'
import { appointmentLine, familyDayOf, familyShiftCode, familyWeekCurrent, familyWeekOf } from './familyWeekModel'
import WeekCard from './WeekCard'

export function FamilyCalendarPage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const week = new URLSearchParams(search).get('week') ?? ''
  const signedIn = useAuthStore((s) => !!s.user)
  const eff = useEffectiveUser()
  const { state, refresh } = useFamilyRead<FamilyCalendar>(signedIn && !eff?.visiting, myCalendarPath({ week }))
  const onWeek = useCallback((w: string) => navigate(`${pathname}${w ? `?week=${encodeURIComponent(w)}` : ''}`, { replace: true }),
    [navigate, pathname])
  return <FamilyWeekScreen state={state} asked={week} guardianHint={viewerKind(null, eff) === 'guardian'} onWeek={onWeek}
    onRetry={() => void refresh()} />
}

const NO_REFS = new Set<string>()
const noop = () => {}

export function FamilyWeekScreen({ state, asked = '', guardianHint = false, onWeek, onRetry }: {
  state: FamilyState<FamilyCalendar>
  /** the week the address asks for ('' is this week) */
  asked?: string
  /** before an answer: whether the account wears SSA or FAMILY (the wording only) */
  guardianHint?: boolean
  onWeek: (week: string) => void
  onRetry: () => void
}) {
  if (state.status === 'refused') return <FamilyRefused title="My Calendar" error={state.error} />
  const view = state.data
  if (view && !view.linked) return <FamilyUnlinked why={view.why} />
  const viewer = view?.viewer ?? (guardianHint ? 'guardian' : 'client')
  const title = familyTitle(viewer, view?.ward.name ?? '', 'My Week', 'week')
  // another week's answer is never drawn under this week's range
  const current = familyWeekCurrent(view, asked)
  const week = view && current ? familyWeekOf(view) : null
  return (
    <div className="w-full pb-16" data-family-calendar="">
      {!view && <FamilyReadLine state={state} reading="Reading your week…" failed="My Calendar could not be read" onRetry={onRetry} />}
      {view && current && state.status === 'failed' && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--warning)]">
          The last refresh failed: {state.error || 'no answer'}. What is shown is from the read before.
          <RetryButton onRetry={onRetry} busy={state.refreshing} />
        </p>
      )}
      {view && (
        <div className="grid gap-5">
          <WeekCard week={week} title={title} asked={asked} today={view.today} reading={state.refreshing}
            failed={!week && state.status === 'failed' ? state.error || 'no answer' : ''} refs={NO_REFS}
            onWeek={onWeek} onOpen={noop} onRetry={onRetry}
            extra={(day, clock) => {
              const here = familyDayOf(view, day.iso)
              return (
                <>
                  {here.appointments.map((a, i) => <AppointmentChip key={`a${i}`} appointment={a} />)}
                  {here.shifts.map((s, i) => <StaffShiftChip key={`s${i}`} shift={s} clock={clock} />)}
                </>
              )
            }} />
          <SourceCard title="House manager" source={view.manager?.source}>
            {(view.manager?.rows ?? []).map((m) => (
              <p key={`${m.name}|${m.phone}`} className="text-[13.5px] leading-6 text-text-1" data-manager="">
                {m.name}
                {m.phone && (
                  <a href={phoneHref(m.phone)} className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                    <Phone size={12} /> {formatPhoneDisplay(m.phone)}
                  </a>
                )}
              </p>
            ))}
          </SourceCard>
        </div>
      )}
      {view && (state.readAt > 0 || state.kept) && <ReadStamp at={state.readAt} kept={state.kept} />}
    </div>
  )
}

/** A staff shift at the house: its hours as every calendar card spells them, and who works it. */
export function StaffShiftChip({ shift, clock }: { shift: FamilyShift; clock: boolean }) {
  const code = familyShiftCode(shift)
  return (
    <div data-shift="" className="w-full rounded-[10px] border-l-[3px] border-tint-fg-blue bg-tint-blue px-3 py-2">
      <span className="block break-words text-[11.5px] font-medium text-tint-fg-blue">
        {code ? cellText(code, clock) : 'Hours not written'}
      </span>
      <span className="block break-words text-[13px] font-medium text-text-1">{shift.staff}</span>
    </div>
  )
}

/** One of the client's own doctor appointments, in its own tint. */
export function AppointmentChip({ appointment }: { appointment: Appointment }) {
  const line = appointmentLine(appointment)
  return (
    <div data-appointment="" className="w-full rounded-[10px] border-l-[3px] border-tint-fg-mint bg-tint-mint px-3 py-2">
      <span className="flex items-center gap-1 break-words text-[11.5px] font-medium text-tint-fg-mint">
        <Stethoscope size={12} className="shrink-0" /> {appointment.time || 'Appointment'}
      </span>
      <span className="block break-words text-[13px] font-medium text-text-1">{appointment.title || 'Doctor appointment'}</span>
      {line && <span className="block break-words text-[11.5px] leading-[1.4] text-text-2">{line}</span>}
    </div>
  )
}
