// The colour legend, always drawn: the kinds a day runs through, the training mark (always), then the states…
import { ArrowLeftRight, GraduationCap, PhoneOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useShellHides } from '@/lib/myWorkHides'
import { CELL_LEGEND } from '@/pages/features/shifts/shiftUi'
import { OPEN_CLAIMED, OPEN_RED } from '@/pages/features/shifts/houseCalTypes'
import { ALWAYS_MARKS, type MarkId } from './schedulingModel'
import { schedTint } from './SchedulingParts'

/** The flag a waiting request carries in the cell's corner. */
export const REQUEST_FLAG = 'absolute left-0 top-0 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-warning'
/** Time off: asked is a dashed edge, approved a hatch. */
export const TIME_OFF_ASKED = 'pointer-events-none absolute inset-[3px] rounded-[7px] border border-dashed border-text-3'
export const TIME_OFF_HATCH = 'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--text-3) 22%, transparent) 5px 6px)'
/** Training (no IST at the house): a lavender edge and a cap; still waiting on its two seats, a dashed amber edge. */
export const TRAINING_EDGE = 'ring-1 ring-inset ring-tint-fg-lavender'
export const TRAINING_WAITING_EDGE = 'outline-dashed outline-1 -outline-offset-2 outline-warning'

type Inner = 'flag' | 'dashed' | 'hatch' | 'phone' | 'swap' | 'echo' | 'grad' | 'grad-waiting'

const STATES: Record<MarkId, { label: string; swatch: string; inner?: Inner }> = {
  'open': { label: 'Open shift', swatch: OPEN_RED },
  'taken': { label: 'Taken from OPEN', swatch: OPEN_CLAIMED },
  'training': { label: 'Training with the house manager (no IST) — not counted as DSP', swatch: cn('bg-surface', TRAINING_EDGE), inner: 'grad' },
  'training-waiting': { label: 'Training waiting on the house manager and a director', swatch: cn('bg-surface', TRAINING_WAITING_EDGE), inner: 'grad-waiting' },
  'called-off': { label: 'Called off (C/O)', swatch: 'ring-1 ring-inset ring-[#8b0000]/50', inner: 'phone' },
  'request-waiting': { label: 'Request off waiting', swatch: 'bg-surface border border-border', inner: 'flag' },
  'swap-waiting': { label: 'Swap waiting', swatch: 'ring-1 ring-inset ring-info', inner: 'swap' },
  'time-off-asked': { label: 'Time off asked', swatch: 'bg-surface', inner: 'dashed' },
  'time-off': { label: 'Time off', swatch: 'bg-surface border border-border', inner: 'hatch' },
  'echo': { label: 'At another house that day (@)', swatch: 'bg-surface border border-dashed border-text-3', inner: 'echo' },
}

function InnerMark({ inner }: { inner?: Inner }) {
  if (inner === 'flag') return <span className={REQUEST_FLAG} />
  if (inner === 'dashed') return <span className="absolute inset-[1px] rounded-[3px] border border-dashed border-text-3" />
  if (inner === 'hatch') return <span className="absolute inset-0" style={{ backgroundImage: TIME_OFF_HATCH }} />
  if (inner === 'phone') return <PhoneOff size={8} className="absolute right-0.5 top-0.5 text-danger" />
  if (inner === 'swap') return <ArrowLeftRight size={8} className="absolute right-0.5 top-0.5 text-info" />
  if (inner === 'echo') return <span className="absolute inset-0 grid place-items-center text-[8px] leading-none text-text-3">@</span>
  if (inner === 'grad') return <GraduationCap size={9} className="absolute left-0.5 top-0.5 text-tint-fg-lavender" />
  if (inner === 'grad-waiting') return <GraduationCap size={9} className="absolute left-0.5 top-0.5 text-warning" />
  return null
}

/** Drawn under the grid's last row (the operator, 10-31). */
export default function Legend({ present }: { present: MarkId[] }) {
  // Settings › My Work keeps the training line of the key to the master's own session unless its switch shows it
  const trainingHidden = useShellHides().sched_training_legend
  const shown = [...ALWAYS_MARKS, ...present.filter((m) => !ALWAYS_MARKS.includes(m))]
    .filter((m) => !(m === 'training' && trainingHidden))
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 border-t border-border px-3 py-2 text-[11.5px] text-text-2" data-legend="">
      {CELL_LEGEND.map((k) => (
        <span key={k.kind} className="inline-flex items-center gap-1.5">
          <i aria-hidden className={cn('inline-block h-3 w-[18px] rounded-[4px]', schedTint(k.kind), k.kind === 'off' && 'border border-border')} />
          {k.label}
        </span>
      ))}
      {shown.map((id) => (
        <span key={id} className="inline-flex items-center gap-1.5" data-legend-state={id}>
          <i aria-hidden className={cn('relative inline-block h-3 w-[18px] overflow-hidden rounded-[4px]', STATES[id].swatch)}>
            <InnerMark inner={STATES[id].inner} />
          </i>
          {STATES[id].label}
        </span>
      ))}
    </div>
  )
}
