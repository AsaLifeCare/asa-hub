// The shapes the Mail screen reads.
// They used to live in `src/lib/seed-mail.ts` beside 250 lines of invented correspondence; the invented half is…

export type MailLabel = 'clients' | 'staff' | 'billing' | 'system'

export type MailAddress = {
  name: string
  email: string
}

export type MailThread = {
  id: string
  from: MailAddress
  to: MailAddress[]
  subject: string
  snippet: string
  /** plain-text paragraphs, rendered with prose-like spacing */
  body: string[]
  date: string // ISO
  unread: boolean
  starred: boolean
  labels: MailLabel[]
  /** attachment filename when present */
  hasAttachment?: string
}
