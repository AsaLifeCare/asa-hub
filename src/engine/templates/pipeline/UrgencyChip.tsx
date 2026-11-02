// RED — a deadline somebody extended by hand has run out.
// Red is a NEW state, and it comes after amber.
import { AlarmClockOff, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { packetChipShowsHold, type PacketChipValue } from './PacketChip'

export function UrgencyChip({
  urgency,
  why,
  source,
  packet,
  hold,
  className,
}: {
  urgency?: unknown
  why?: unknown
  source?: unknown
  packet?: PacketChipValue | null
  hold?: { phase?: string } | null
  className?: string
}) {
  const level = String(urgency ?? '')
  const reason = String(why ?? '')
  const from = String(source ?? '')

  if (level === 'red') {
    return (
      <span
        title={reason ? `${reason}. Somebody already gave them extra time and it has run out — extend again from the card, or decide it ends here.` : undefined}
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-tint-pink px-2 py-0.5 text-[10px] font-semibold text-tint-fg-pink',
          className,
        )}
      >
        <AlarmClockOff size={11} strokeWidth={2.5} aria-hidden />
        Extension ran out
      </span>
    )
  }

  // AMBER IS DRAWN HERE TOO.
  if (level !== 'amber') return null
  if (from ? from === 'packet-hold' : packetChipShowsHold(packet, hold)) return null
  return (
    <span
      title={reason ? `${reason}. Nobody is late — this is what is still outstanding before the card can leave.` : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-tint-amber px-2 py-0.5 text-[10px] font-semibold text-tint-fg-amber',
        className,
      )}
    >
      <CircleAlert size={11} strokeWidth={2.5} aria-hidden />
      Outstanding
    </span>
  )
}

export default UrgencyChip
