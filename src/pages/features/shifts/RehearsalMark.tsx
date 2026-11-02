// THE MARK, wherever a real person could see or act on a rehearsed row.
// The rehearsal plays in a sandbox of its own, so a real screen never meets one of its rows; this is the second…
import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

const WHY = 'Played by the shift rehearsal, which runs in a sandbox of its own. Nobody asked for '
  + 'this, and every door refuses to act on it.'

export default function RehearsalMark({ on, className, words }: {
  on?: boolean
  className?: string
  /** the whole sentence rather than the chip, where a row has room for one */
  words?: boolean
}) {
  if (!on) return null
  if (words) {
    return (
      <span className={cn('flex items-start gap-1 text-[11px] leading-4 text-violet-700 dark:text-violet-400',
        className)}>
        <FlaskConical size={11} className="mt-0.5 shrink-0" />
        <span>{WHY}</span>
      </span>
    )
  }
  return (
    <span title={WHY} data-rehearsal="true"
      className={cn('inline-flex items-center gap-1 rounded-full border border-violet-500/60 '
        + 'bg-violet-500/[0.12] px-2 py-0.5 text-[11px] font-semibold '
        + 'text-violet-700 dark:text-violet-300', className)}>
      <FlaskConical size={10} className="shrink-0" />
      Rehearsal
    </span>
  )
}
