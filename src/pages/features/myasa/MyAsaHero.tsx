// The black header over My asa.: the numbers of the person the page is drawn for, and nobody else's.
// THIS PAGE HAS TWO KINDS OF FIGURE, and they cannot share one verdict.
import AppHero from '@/components/shared/AppHero'
import { heroNumber, type HeroFigure, type HeroRead } from '@/lib/appHero'

/** How the certifications read went — the only fallible half of this page. */
export type CertsRead = 'loading' | 'failed' | 'ready'

export type MyAsaFigures = {
  certs: number
  expiring: number
  expired: number
  bookmarks: number
  cards: number
  emails: number
  phones: number
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${heroNumber(n)} ${n === 1 ? one : many}`

export default function MyAsaHero({ figures, certsRead, certsReason, certsShown = true, who, visiting, onRetry }: {
  figures: MyAsaFigures
  certsRead: CertsRead
  /** why the certifications read failed, when there is more to say */
  certsReason?: string
  /** false where the page draws no certifications card (a client's corner) */
  certsShown?: boolean
  /** whose corner this is */
  who: string
  visiting: boolean
  onRetry?: () => void
}) {
  const f = figures
  const gotCerts = certsShown && certsRead === 'ready'
  const certs: HeroRead = certsRead === 'failed'
    ? { state: 'failed', reason: certsReason || 'the certifications could not be read' }
    : certsRead === 'loading' ? { state: 'loading' } : { state: 'ready' }

  // the viewer's own browser state: never counted under somebody else's name
  const browserOwn: HeroFigure[] = visiting ? [] : [
    {
      label: 'Bookmarks kept',
      tint: 'blue',
      value: f.bookmarks,
      note: f.bookmarks ? 'saved on this account' : 'nothing bookmarked yet',
    },
    {
      label: 'Cards on this page',
      value: f.cards,
      note: `${plural(f.emails, 'address', 'addresses')} · ${plural(f.phones, 'number')} on the account`,
    },
  ]

  // the page draws no certifications card here, so the header counts none
  const certFigures: HeroFigure[] = !certsShown ? [] : [
    {
      label: 'Certifications on file',
      read: certs,
      value: gotCerts ? f.certs : null,
      note: f.certs === 0
        ? `nothing on ${visiting ? 'this' : 'your'} name in the certifications sheet`
        : `${heroNumber(f.expired)} expired · ${heroNumber(f.expiring)} expiring`,
    },
    {
      label: 'Needing a date soon',
      tint: 'amber',
      read: certs,
      value: gotCerts ? f.expiring + f.expired : null,
      note: 'expired and expiring, counted together',
    },
  ]

  const list: HeroFigure[] = [...certFigures, ...browserOwn]

  return (
    <AppHero
      eyebrow={visiting ? `My asa. · ${who}’s corner` : 'My asa. · your corner'}
      label={visiting ? `My asa. — ${who}'s corner` : 'My asa. — your corner'}
      // The page itself is always here; only the certifications can be missing, and they say so on their own two…
      read={{ state: 'ready' }}
      figures={list}
      reading="Reading the certifications…"
      failed="The certifications could not be read, so those figures are unknown — not zero."
      sentence={visiting
        ? 'You are visiting — nothing here is yours to change. Their bookmarks, cards and phone numbers are not read for a visit.'
        : certsShown && certsRead === 'failed'
          ? certsReason
            ? `The certifications could not be read — ${certsReason}; everything else on this page is your own.`
            : 'The certifications did not answer; everything else on this page is your own.'
          : `${plural(f.cards, 'card')} on your page${gotCerts ? ` · ${plural(f.certs, 'certification')} on your name` : ''}`}
      onRetry={onRetry}
    />
  )
}
