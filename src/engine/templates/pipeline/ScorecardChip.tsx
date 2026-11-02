// THE RESUME'S NOTA, on a card — asked twice over: the score card belongs on the pipeline card and not only in the…
// INFORMATIONAL ALWAYS, A GATE NEVER — it locks nothing: blue at 7 and above, red below, and neither colour stops…
import { cn } from '@/lib/utils'

/** Blue at 7 and above, red below. */
export const SCORECARD_PASS = 7

const tone = (score: number) =>
  score >= SCORECARD_PASS ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'

const why = (score: number) =>
  `Resume scorecard — the rubric's composite. ${score >= SCORECARD_PASS ? 'At or above' : 'Below'} ${SCORECARD_PASS}. Never blocks the process.`

/** The number alone — what the Flow board and the Reports matrix draw. */
export function ScorecardBadge({ score }: { score: number }) {
  return (
    <span
      className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums', tone(score))}
      title={why(score)}
    >
      {score}
    </span>
  )
}

// The word AND the number, for a card that has room for neither twice: it rides beside the name, so it has to say…
export function ScorecardChip({ score }: { score: number }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-bold',
        tone(score),
      )}
      title={why(score)}
    >
      <span className="font-semibold">Scorecard</span>
      <span className="tabular-nums">{score}</span>
    </span>
  )
}
