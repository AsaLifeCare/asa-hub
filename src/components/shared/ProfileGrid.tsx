import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One column below lg; lg: head and rail left, story then details right; 2xl: head and details | story | rail. */
export const PROFILE_GRID =
  'grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-[minmax(0,min(290px,38%))_minmax(0,1fr)] lg:grid-rows-[auto_1fr] ' +
  '2xl:grid-cols-[minmax(200px,280px)_minmax(0,1fr)_minmax(190px,240px)]'

export const PROFILE_SLOT = {
  head: 'lg:col-start-1 lg:row-start-1',
  rail: 'lg:col-start-1 lg:row-start-2 2xl:col-start-3 2xl:row-span-full',
  /** story + details as one stack; dissolves at 2xl so each takes its own track */
  main: 'lg:col-start-2 lg:row-span-full 2xl:contents 2xl:space-y-0',
  story: '2xl:col-start-2 2xl:row-span-full',
  details: '2xl:col-start-1 2xl:row-start-2',
} as const

export default function ProfileGrid({ head, rail, story, details, className, slotClassName = 'space-y-3' }: {
  head: ReactNode
  rail: ReactNode
  story: ReactNode
  details?: ReactNode
  /** other tracks or gap for the same placement */
  className?: string
  /** each column's own stacking; keep it equal to the grid's gap-y */
  slotClassName?: string
}) {
  const slot = (name: keyof typeof PROFILE_SLOT) => cn('min-w-0 self-start', PROFILE_SLOT[name], slotClassName)
  // grid items only at 2xl; self-start inside a flex-column stack would shrink them
  const inner = (name: 'story' | 'details') => cn('min-w-0 2xl:self-start', PROFILE_SLOT[name], slotClassName)
  return (
    <div className={cn(PROFILE_GRID, className)}>
      <div className={slot('head')}>{head}</div>
      <aside className={slot('rail')}>{rail}</aside>
      <div className={slot('main')}>
        <div className={inner('story')}>{story}</div>
        {details ? <div className={inner('details')}>{details}</div> : null}
      </div>
    </div>
  )
}
