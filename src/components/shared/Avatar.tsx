import { cn } from '@/lib/utils'
import SafeImg from '@/components/shared/SafeImg'
import DragPerson from '@/components/shared/DragPerson'

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-[12px]',
  md: 'h-10 w-10 text-[14px]',
  lg: 'h-14 w-14 text-[17px]',
  xl: 'h-[72px] w-[72px] text-[20px]',
} as const

// Photo avatar with initials-on-tint fallback (§11).
export default function Avatar({
  src,
  name,
  size = 'sm',
  ring = false,
  eager = false,
  className,
}: {
  src?: string
  name: string
  size?: keyof typeof SIZES
  ring?: boolean
  /** Above the fold — fetch the portrait now rather than on scroll. */
  eager?: boolean
  className?: string
}) {
  return (
    <SafeImg
      src={src}
      name={name}
      shape="round"
      size={SIZES[size]}
      eager={eager}
      className={cn(ring && 'ring-2 ring-white/20', className)}
    />
  )
}

/** Overlapping avatar cluster (§11). */
export function AvatarStack({
  people,
  max = 4,
  size = 'xs',
  className,
}: {
  people: { src?: string; name: string }[]
  max?: number
  size?: keyof typeof SIZES
  className?: string
}) {
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  // THE OVERLAP IS THE CONTAINER'S NOW, not each tile's: a face whose name is blank renders without the drag…
  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {/* A CLUSTER IS N PEOPLE, NOT ONE PICTURE. Each face is wrapped on its
          own so document authors, meeting attendees, readers and list-row
          assignees can all be picked up and dropped on the tracker. The
          +{extra} tile below stays bare — it is a count, not a person. */}
      {shown.map((p, i) => (
        <DragPerson key={i} name={p.name} avatar={p.src} className="shrink-0">
          <Avatar src={p.src} name={p.name} size={size} className="border-2 border-surface" />
        </DragPerson>
      ))}
      {extra > 0 && (
        <div
          className={cn(
            'grid place-items-center rounded-full border-2 border-surface bg-surface-3 font-semibold text-text-2',
            SIZES[size],
          )}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}
