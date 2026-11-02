// Whether this person can still get INTO the onboarding portal.
// The window closing is the one state on this board that the CANDIDATE can see and the team cannot: they get a…
import { DoorClosed, DoorOpen } from 'lucide-react'
import { ohioDayYear } from '@/lib/ohio'
import { cn } from '@/lib/utils'

export type OnboardingWindow = {
  open?: boolean
  until?: string
  reason?: string
  anchored_on?: string
}

export function OnboardingWindowChip({
  window,
  className,
}: {
  window?: OnboardingWindow | null
  className?: string
}) {
  if (!window) return null
  // Onboarding.gs closes the window at 23:59:59 OHIO, so its ISO stamp is 03:59 the NEXT morning in UTC — cutting…
  const until = ohioDayYear(String(window.until ?? ''))
  const closed = window.open === false

  if (closed) {
    return (
      <span
        title={String(window.reason ?? '') || 'Their onboarding window has closed — press Extend to let them back in.'}
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-tint-pink px-2 py-0.5 text-[10px] font-semibold text-tint-fg-pink',
          className,
        )}
      >
        <DoorClosed size={11} strokeWidth={2.5} aria-hidden />
        Portal closed{until ? ` · ${until}` : ''}
      </span>
    )
  }

  // Open, but with an end in sight — worth showing, because it is the number somebody needs before deciding whether…
  if (!until) return null
  return (
    <span
      title={`They can finish in the onboarding portal until ${until}${window.anchored_on ? ` (counted from ${window.anchored_on})` : ''}.`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-2',
        className,
      )}
    >
      <DoorOpen size={11} strokeWidth={2.5} aria-hidden />
      Portal until {until}
    </span>
  )
}

export default OnboardingWindowChip
