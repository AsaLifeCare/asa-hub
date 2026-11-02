// The switch at the top of Scheduling: House Calendars, Staff Calendars, Time Off Requests, Builder, Time…
// A screen App Control has not released to the viewer is not offered; with only House Calendars left, no switch is…
import { Blocks, CalendarDays, CalendarX2, ClipboardCheck, Timer, UserRound, type LucideIcon } from 'lucide-react'
import { useScreenAllowed } from '@/lib/featureAccess'
import { cn } from '@/lib/utils'

export type Screen = 'house' | 'staff' | 'timeoff' | 'builder' | 'recon' | 'overtime'

export const STAFF_SCREEN_FEATURE = 'scheduling.staffCalendars'
export const TIME_OFF_SCREEN_FEATURE = 'scheduling.timeOffRequests'
export const BUILDER_SCREEN_FEATURE = 'scheduling.builder'
export const RECON_SCREEN_FEATURE = 'scheduling.timeReconciliation'
// a page of its own, masterUntilReleased: the lane behind it (/hub-lanes/scheduling/overtime) asks the same row
export const OVERTIME_SCREEN_FEATURE = 'scheduling.overtime'

const SCREENS: { id: Screen; label: string; icon: LucideIcon }[] = [
  { id: 'house', label: 'House Calendars', icon: CalendarDays },
  { id: 'staff', label: 'Staff Calendars', icon: UserRound },
  { id: 'timeoff', label: 'Time Off Requests', icon: CalendarX2 },
  { id: 'builder', label: 'Builder', icon: Blocks },
  { id: 'recon', label: 'Time Reconciliation', icon: ClipboardCheck },
  { id: 'overtime', label: 'Overtime', icon: Timer },
]

/** The screens this viewer may open, House Calendars always first. A screen whose row is not declared in
 * lib/featureAccess yet is the master's alone (screenAllowsWith), never offered to every Scheduling viewer. */
export function useScreens(): Screen[] {
  const staff = useScreenAllowed(STAFF_SCREEN_FEATURE)
  const timeOff = useScreenAllowed(TIME_OFF_SCREEN_FEATURE)
  const builder = useScreenAllowed(BUILDER_SCREEN_FEATURE)
  // only its own row inside Scheduling: the Time Reconciliation app's own release or hiding does not reach this screen
  const recon = useScreenAllowed(RECON_SCREEN_FEATURE)
  const overtime = useScreenAllowed(OVERTIME_SCREEN_FEATURE)
  return [
    'house',
    ...(staff ? ['staff' as const] : []),
    ...(timeOff ? ['timeoff' as const] : []),
    ...(builder ? ['builder' as const] : []),
    ...(recon ? ['recon' as const] : []),
    ...(overtime ? ['overtime' as const] : []),
  ]
}

/** The screen the link asks for, when the viewer may open it; House Calendars otherwise. */
export function screenOf(asked: string | null, allowed: Screen[]): Screen {
  return allowed.find((s) => s === asked) ?? 'house'
}

export default function ScreenSwitch({ screens, value, onChange }: {
  screens: Screen[]
  value: Screen
  onChange: (s: Screen) => void
}) {
  if (screens.length < 2) return null
  return (
    <div role="tablist" aria-label="Scheduling screens" data-screen-switch=""
      className="scroll-thin mb-4 flex max-w-full overflow-x-auto">
      <div className="inline-flex shrink-0 items-center gap-1 rounded-[14px] border border-border bg-surface p-1 shadow-1">
        {SCREENS.filter((s) => screens.includes(s.id)).map(({ id, label, icon: Icon }) => {
          const on = id === value
          return (
            <button key={id} type="button" role="tab" aria-selected={on} data-screen={id} onClick={() => onChange(id)}
              className={cn('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-semibold transition-colors',
                on ? 'bg-tint-primary text-primary' : 'text-text-2 hover:bg-surface-2 hover:text-text-1')}>
              <Icon size={15} /> {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
