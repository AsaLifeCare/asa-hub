// The black header over UI Reports: what the unusual-incident sheet holds now.
// Every figure comes off the same rows the list below is drawn from.
import AppHero from '@/components/shared/AppHero'
import { heroNumber, type HeroFigure, type HeroRead } from '@/lib/appHero'

export type UiReportFigures = {
  total: number
  /** rows carrying a readable incident date */
  dated: number
  last30: number
  /** distinct clients named */
  clients: number
  /** the commonest category, and how many rows carry it */
  topCategory: string
  topCategoryRows: number
  /** rows naming no category at all */
  uncategorised: number
  medication: number
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${heroNumber(n)} ${n === 1 ? one : many}`

export default function UiReportsHero({ read, figures, scope, onRetry }: {
  read: HeroRead
  figures: UiReportFigures | null
  /** the focused client the rows are narrowed to, if any */
  scope?: string
  onRetry?: () => void
}) {
  const f = figures

  const list: HeroFigure[] = [
    {
      label: 'Reports on file',
      value: f ? f.total : null,
      note: !f
        ? ''
        : f.dated === f.total
          ? 'every report carries its date'
          : `${plural(f.total - f.dated, 'report')} carry no readable date`,
    },
    {
      label: 'Filed in the last 30 days',
      tint: 'amber',
      value: f && f.dated ? f.last30 : null,
      note: !f ? '' : f.dated ? `of ${plural(f.dated, 'dated report')}` : 'no report carries a readable date',
    },
    {
      label: 'Medication-related',
      tint: 'pink',
      value: f && f.total > f.uncategorised ? f.medication : null,
      note: !f
        ? ''
        : f.total > f.uncategorised
          ? `${plural(f.uncategorised, 'report')} name no category`
          : 'no report names a category',
    },
    {
      label: 'Commonest category',
      text: true,
      value: f && f.topCategory ? f.topCategory : null,
      note: !f
        ? ''
        : f.topCategory
          ? `${plural(f.topCategoryRows, 'report')} carry it`
          : 'no report names a category',
    },
  ]

  return (
    <AppHero
      eyebrow={`UI reports · ${scope || 'every client'}`}
      label="UI reports — the unusual incidents on file"
      read={read}
      figures={list}
      reading="Reading the unusual incidents…"
      failed="The unusual incidents could not be read, so these figures are unknown — not zero."
      sentence={f
        ? `${plural(f.total, 'report')} on file · ${f.clients ? plural(f.clients, 'client') : 'no client'} named`
        : undefined}
      onRetry={onRetry}
    />
  )
}
