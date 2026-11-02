// A NEW E-MAIL OR PHONE ON ONE'S OWN ACCOUNT, from My Info — added, never swapped: the sign-in e-mail stays, and…
// Pure: the panel, the card and the tests read the same code.

export type ContactKind = 'email' | 'phone'

export type AccountContacts = {
  /** the sign-in e-mail */
  email: string
  /** every extra e-mail on the account (profileParseEmails_) */
  emails: string[]
  /** the main phone */
  phone: string
  phones: { label: string; number: string }[]
}

/** profileCleanEmails_ and profileCleanPhones_ keep this many. */
export const CONTACTS_MAX = 8

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const digitsOf = (v: string): string => v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')

/** The account's phones as profileUpdate keeps them: the main one first. */
export function phonesOf(a: Pick<AccountContacts, 'phone' | 'phones'>): { label: string; number: string }[] {
  if (a.phones.length) return a.phones
  return a.phone ? [{ label: 'Phone', number: a.phone }] : []
}

/** The e-mails a field shows under its own value: the account's, the value itself left out, once each. */
export function emailsBeside(a: Pick<AccountContacts, 'email' | 'emails'>, shown: string): string[] {
  const seen = new Set([shown.trim().toLowerCase()])
  const out: string[] = []
  for (const e of [a.email, ...a.emails]) {
    const k = e.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(e.trim())
  }
  return out
}

/** The phones a field shows under its own value: the account's, the value itself left out, once each. */
export function phonesBeside(a: Pick<AccountContacts, 'phone' | 'phones'>, shown: string): string[] {
  const seen = new Set([digitsOf(shown)])
  const out: string[] = []
  for (const p of phonesOf(a)) {
    const k = digitsOf(p.number)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(p.number)
  }
  return out
}

/** Why the value cannot be added, as a sentence; '' when it can. */
export function contactRefusal(kind: ContactKind, value: string, a: AccountContacts): string {
  const v = value.trim()
  if (kind === 'email') {
    if (!v) return 'Type the e-mail to add.'
    if (!EMAIL.test(v) || v.length > 120) return 'That is not an e-mail address.'
    const k = v.toLowerCase()
    if (a.email.toLowerCase() === k || a.emails.some((e) => e.trim().toLowerCase() === k)) return 'This e-mail is already on your account.'
    if (a.emails.length >= CONTACTS_MAX) return `Your account already holds ${CONTACTS_MAX} extra e-mails.`
    return ''
  }
  const d = digitsOf(v)
  if (!d) return 'Type the phone to add.'
  if (!/^\d{10}$/.test(d)) return 'A phone is a 10-digit US number.'
  const list = phonesOf(a)
  if (list.some((p) => digitsOf(p.number) === d)) return 'This phone is already on your account.'
  if (list.length >= CONTACTS_MAX) return `Your account already holds ${CONTACTS_MAX} phones.`
  return ''
}

/** An e-mail as the account keeps it: lowercase, trimmed. Sign-in compares lowercase, so nothing rides in capitals. */
export const emailKey = (v: string): string => v.trim().toLowerCase()

/** profileUpdate's payload: the whole list with the new one last, so the sign-in e-mail and the main phone stay; every
 *  e-mail lowercase, once. */
export function contactPayload(kind: ContactKind, value: string, a: AccountContacts): Record<string, unknown> {
  if (kind === 'email') return { emails: [...new Set([...a.emails, value].map(emailKey).filter(Boolean))] }
  return { phones: [...phonesOf(a), { label: 'Phone', number: value.trim() }] }
}

/** myProfileEmailFree's answer: free, taken (with the door's sentence), or unanswered — never read as free. */
export function emailFreeOf(raw: unknown): { free: boolean; why: string } {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (o.free === true) return { free: true, why: '' }
  if (o.free === false) return { free: false, why: String(o.message ?? '') || 'This e-mail already belongs to another account.' }
  return { free: false, why: 'Whether another account holds this e-mail could not be checked. Nothing was added.' }
}

export const CONTACT_TITLE: Record<ContactKind, string> = { email: 'Add an e-mail', phone: 'Add a phone' }

export const CONTACT_WORDS: Record<ContactKind, string> = {
  email: 'Added to your account beside the e-mail you sign in with. Once saved, you can sign in with either. An e-mail '
    + 'another account already uses is refused. It is kept in lowercase.',
  phone: 'Added to your account beside your main phone, which stays as it is.',
}
