// The New Hire chip.
// The signed application packet does not block the onboarding — somebody can walk all six steps and still be…
import { FileCheck2, FileClock, FileQuestion, FileWarning, FileX2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PacketState = 'signed' | 'waived' | 'unsigned' | 'ambiguous' | 'unknown'
export type PacketChipValue = { state: PacketState; label: string }

const LOOK: Record<PacketState, { cls: string; Icon: typeof FileCheck2; hint: string }> = {
  signed: {
    cls: 'bg-tint-mint text-tint-fg-mint',
    Icon: FileCheck2,
    hint: 'The application packet is signed in Dropbox Sign.',
  },
  waived: {
    cls: 'bg-tint-mint text-tint-fg-mint',
    Icon: FileCheck2,
    hint: 'Someone attached the signed packet by hand.',
  },
  unsigned: {
    cls: 'bg-tint-danger text-tint-fg-danger',
    Icon: FileX2,
    hint: 'Their envelope exists and has not been signed — this is what holds them back.',
  },
  ambiguous: {
    cls: 'bg-tint-amber text-tint-fg-amber',
    Icon: FileWarning,
    hint: 'More than one card fits that envelope — a person needs to say which.',
  },
  unknown: {
    cls: 'bg-surface-2 text-text-3',
    Icon: FileQuestion,
    hint: 'No envelope matched this person. Usually ours to fix — attach the packet by hand if you have it.',
  },
}

// THE HOLD OVERRIDES THE CHIP.
export type PacketHoldPhase = 'waiting' | 'overdue'

const HOLD_LOOK: Record<PacketHoldPhase, { cls: string; Icon: typeof FileCheck2; label: string; hint: string }> = {
  waiting: {
    cls: 'bg-tint-amber text-tint-fg-amber',
    Icon: FileClock,
    label: 'New Hire — missing',
    hint: 'They finished onboarding and the signed packet is not on file. They stay here until it is signed in Dropbox Sign, attached by hand, or found in the mirror.',
  },
  overdue: {
    cls: 'bg-tint-amber text-tint-fg-amber',
    Icon: FileWarning,
    label: 'New Hire — overdue',
    hint: 'They finished onboarding and the signed packet is still missing. They stay here until it is signed in Dropbox Sign or attached by hand.',
  },
}

// WHETHER THIS CHIP IS ALREADY SHOWING AMBER — asked by UrgencyChip, which draws the server's amber and must not…
export function packetChipShowsHold(
  packet?: PacketChipValue | null,
  hold?: { phase?: string } | null,
): boolean {
  const phase = hold?.phase as PacketHoldPhase | undefined
  const onFile = packet?.state === 'signed' || packet?.state === 'waived'
  return !!(phase && HOLD_LOOK[phase] && !onFile)
}

export function PacketChip({
  packet,
  hold,
  className,
  onOpen,
}: {
  packet?: PacketChipValue | null
  hold?: { phase?: string } | null
  className?: string
  // A SIGNED PACKET IS A DOCUMENT, SO IT OPENS — when New Hire Signed shows blue it HAS been signed, so the chip…
  onOpen?: () => void
}) {
  const phase = hold?.phase as PacketHoldPhase | undefined
  if (packetChipShowsHold(packet, hold) && phase) {
    const h = HOLD_LOOK[phase]
    return (
      <span
        title={h.hint}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
          h.cls,
          className,
        )}
      >
        <h.Icon size={11} strokeWidth={2.5} aria-hidden />
        {h.label}
      </span>
    )
  }
  if (!packet?.state) return null
  const look = LOOK[packet.state] ?? LOOK.unknown
  const { Icon } = look
  const onFile = packet.state === 'signed' || packet.state === 'waived'
  const shell = cn(
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
    look.cls,
    className,
  )
  const body = (
    <>
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      {packet.label}
    </>
  )
  if (onFile && onOpen) {
    return (
      <button
        type="button"
        title={`${look.hint} Click to open it.`}
        onClick={(e) => { e.stopPropagation(); onOpen() }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(shell, 'transition-shadow duration-150 hover:shadow-1')}
      >
        {body}
      </button>
    )
  }
  return (
    <span title={look.hint} className={shell}>
      {body}
    </span>
  )
}

/** Kept for the drawer, where there is room for the longer sentence. */
export function packetHint(state?: PacketState): string {
  return state ? (LOOK[state] ?? LOOK.unknown).hint : ''
}

export const PacketClock = FileClock

// STEP 8 on the card — the origin details in the Employee Database.
export type InternalDocsValue = { state?: string; note?: string; at?: string }

const DOCS_LOOK: Record<string, { label: string; hint: string; Icon: typeof FileCheck2 }> = {
  pending: {
    label: 'Internal docs — pending',
    hint: 'Where this person came from has not been written into the Employee Database yet. It fills itself from the signed packet.',
    Icon: FileClock,
  },
  filled: {
    label: 'Internal docs — on file',
    hint: 'Name, date of birth, address, contact and referral were filled into the Employee Database from the signed packet.',
    Icon: FileCheck2,
  },
  left_alone: {
    label: 'Internal docs — someone is filling it',
    hint: 'A person had already started this row by hand, so nothing was touched. Their work stands.',
    Icon: FileQuestion,
  },
  failed: {
    label: 'Internal docs — needs a person',
    hint: 'The Employee Database could not be filled automatically. Open the card to read why.',
    Icon: FileWarning,
  },
}

export function InternalDocsChip({
  docs,
  className,
}: {
  docs?: InternalDocsValue | null
  className?: string
}) {
  const look = DOCS_LOOK[docs?.state ?? 'pending']
  if (!look) return null
  const { Icon } = look
  return (
    <span
      title={docs?.note || look.hint}
      className={cn(
        // White needs a border to exist at all on a white card.
        'inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-2',
        className,
      )}
    >
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      {look.label}
    </span>
  )
}
