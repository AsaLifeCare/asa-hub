/** Who trains a first shift and whether they are free, drawn from server/shift_requests.training_verdict. */
import { GraduationCap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trainingLine, trainingTone, type Training } from './requestsLogic'

export default function TrainingNote({ training, lead, className }: {
  training?: Training | null
  /** words in front of the sentence, when the screen needs to say what it is about */
  lead?: string
  className?: string
}) {
  const tone = trainingTone(training)
  const line = trainingLine(training, lead)
  if (!tone || !line) return null
  return (
    <span data-training={tone}
      className={cn('flex items-start gap-1 text-[11px] leading-4',
        tone === 'blocked' ? 'text-danger'
          : tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-amber-700 dark:text-amber-400',
        className)}>
      <GraduationCap size={11} className="mt-0.5 shrink-0" />
      <span>{line}</span>
    </span>
  )
}
