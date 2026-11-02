// The black header over Mail: the platform's own mailbox, as this account is allowed to see it.
// TWO REASONS FOR AN EMPTY SCREEN, and they are opposite.
import AppHero from '@/components/shared/AppHero'
import { heroNumber, type HeroFigure, type HeroRead } from '@/lib/appHero'

export type MailFigures = {
  /** threads this read pulled back */
  threads: number
  unread: number
  // mailboxes the platform holds that this account may open; null when the inbox named none
  mailboxes: number | null
  /** the open mailbox's address */
  address: string
  /** folders the mailserver listed beside the inbox */
  folders: number | null
  /** Sent did not answer while the inbox did */
  sentFailed?: boolean
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${heroNumber(n)} ${n === 1 ? one : many}`

export default function MailHero({ read, figures, denied, onRetry }: {
  read: HeroRead
  figures: MailFigures | null
  /** the mailserver refuses this account — no figure here was ever measured */
  denied?: boolean
  onRetry?: () => void
}) {
  const f = denied ? null : figures
  const refused = 'this account does not open the platform mailbox'

  const list: HeroFigure[] = denied ? [] : [
    {
      label: 'Threads in this read',
      value: f && !f.sentFailed ? f.threads : null,
      note: !f
        ? ''
        : f.sentFailed
          ? 'Sent did not answer — the inbox alone is not the count'
          : f.address ? `from ${f.address}` : 'from the platform mailbox',
    },
    {
      label: 'Unread in the inbox',
      tint: 'amber',
      value: f ? f.unread : null,
      note: !f ? '' : 'nothing here is marked as seen by opening it',
    },
    {
      label: 'Mailboxes you may open',
      tint: 'blue',
      value: f ? f.mailboxes : null,
      note: !f
        ? ''
        : f.mailboxes === null
          ? 'the inbox answered without naming its mailbox'
          : f.mailboxes > 1 ? 'one at a time; switching reads again' : 'the platform’s own voice',
    },
    {
      label: 'Folders on the server',
      value: f ? f.folders : null,
      note: !f
        ? ''
        : f.folders === null
          ? 'the mailserver listed none back'
          : 'what the watchers file into, beside the inbox',
    },
  ]

  return (
    <AppHero
      eyebrow="Mail · the platform’s own mailbox"
      label="Mail — the platform's own mailbox"
      read={denied ? { state: 'ready' } : read}
      figures={list}
      reading="Opening the platform mailbox…"
      failed="The platform mailbox did not answer, so these figures are unknown — not zero."
      sentence={denied
        ? `No figures here — ${refused}. Compose still works.`
        : f
          ? f.sentFailed
            ? `${heroNumber(f.unread)} unread in the inbox · Sent did not answer`
            : `${plural(f.threads, 'thread')} read · ${heroNumber(f.unread)} unread`
          : undefined}
      onRetry={denied ? undefined : onRetry}
      className="mb-3 shrink-0"
    />
  )
}
