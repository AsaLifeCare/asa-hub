// The black header over Dr Appointments: the roster and the booked visits, each figure off the read that produced…
// TWO READS, TWO VERDICTS.
import AppHero from '@/components/shared/AppHero'
import { heroNumber, type HeroFigure, type HeroRead } from '@/lib/appHero'

export type DrApptFigures = {
  /** roster rows on file */
  total: number
  /** rows not marked discontinued */
  active: number
  /** distinct clients named on the active rows */
  clients: number
  /** active rows whose next visit is readable */
  dated: number
  /** of those, the ones already past */
  overdue: number
  /** the soonest next visit still ahead, already worded */
  next: string
  /** how far ahead that one is, worded */
  nextWhen: string
}

/** Booked visits, from the other door. */
export type DrVisitFigures = {
  soon: number
  /** visits carrying no readable date */
  undated: number
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${heroNumber(n)} ${n === 1 ? one : many}`

export default function DrAppointmentsHero({ read, figures, visitsRead, visits, scope, onRetry }: {
  read: HeroRead
  figures: DrApptFigures | null
  visitsRead: HeroRead
  visits: DrVisitFigures | null
  /** the focused client the figures are narrowed to, if any */
  scope?: string
  onRetry?: () => void
}) {
  const f = figures
  const v = visitsRead.state === 'ready' ? visits : null

  const list: HeroFigure[] = [
    {
      label: 'Booked in the next 14 days',
      tint: 'blue',
      read: visitsRead.state === 'failed'
        ? { state: 'failed', reason: 'the visits door did not answer' }
        : visitsRead,
      value: v ? v.soon : null,
      note: !v
        ? ''
        : v.undated
          ? `${plural(v.undated, 'booked visit')} carry no readable date`
          : 'off the appointment form’s own responses',
    },
    {
      label: 'Past their next visit',
      tint: 'pink',
      value: f && f.dated ? f.overdue : null,
      note: !f
        ? ''
        : !f.active
          ? 'no active row on the roster'
          : f.dated
            ? `of ${plural(f.dated, 'active row')} carrying a next visit`
            : 'no active row carries a readable next visit',
    },
    {
      label: 'Clients on the roster',
      value: f && f.clients ? f.clients : null,
      note: !f
        ? ''
        : f.clients
          ? `${plural(f.active, 'active row')} of ${plural(f.total, 'row')} on file`
          : 'no active row names a client',
    },
    {
      label: 'Soonest visit ahead',
      text: true,
      value: f && f.next ? f.next : null,
      note: !f ? '' : f.next ? f.nextWhen : 'nothing ahead on the roster',
    },
  ]

  return (
    <AppHero
      eyebrow={scope ? `Dr appointments · focused on ${scope}` : 'Dr appointments · the roster and what is booked'}
      label="Dr appointments — the roster and what is booked"
      read={read}
      figures={list}
      reading="Reading the doctor roster…"
      failed="The doctor roster could not be read, so these figures are unknown — not zero."
      sentence={f
        ? `${plural(f.total, 'roster row')} on file · ${heroNumber(f.total - f.active)} discontinued`
        : undefined}
      onRetry={onRetry}
    />
  )
}
