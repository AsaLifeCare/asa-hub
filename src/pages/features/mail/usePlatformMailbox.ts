// THE PLATFORM MAILBOX, read — asa-hub@asaop.org and its siblings, for the accounts the server names as readers.
// The server answers 404 to every other session, and this read does not fire for them: their screen is an empty…
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { gasAction } from '@/features/hiring/shared'
import type { HeroRead } from '@/lib/appHero'
import type { MailFigures } from './MailHero'
import type { MailLabel, MailThread } from './types'

export type Box = 'inbox' | 'sent' | 'archive' | 'trash'
// `mid` is the message's own id ON THE MAILSERVER (Message-ID, or the uid the inbox fell back to) and `mbox` the…
export type LocalThread = MailThread & { box: Box; mid?: string; mbox?: string }

export type MailAccount = { id: string; address: string; primary: boolean }

export type PlatformMailbox = {
  items: LocalThread[]
  setItems: Dispatch<SetStateAction<LocalThread[]>>
  loading: boolean
  /** both folders failed for a reason that is NOT the gate — said out loud */
  error: string
  /** the server refused both folders with a 404: this account does not read */
  denied: boolean
  /** why the inbox did not answer while Sent did; '' when it answered */
  inboxFailed: string
  /** why Sent did not answer while the inbox did; '' when it answered */
  sentFailed: string
  /** the open mailbox's address, as the inbox named it */
  address: string
  accounts: MailAccount[]
  /** the mailbox's own folders, listed off the same conversation as the inbox */
  folders: string[]
}

type Wire = {
  address: string
  account?: string
  accounts?: MailAccount[]
  folders?: string[]
  threads: {
    id: string; from_name: string; from_addr: string; to: string; subject: string
    date: string; snippet: string; unread: boolean; has_attachment?: boolean
  }[]
}

const asThread = (addr: string, box: Box) => (t: Wire['threads'][number]): LocalThread => ({
  id: `pm-${box}-${t.id}`,
  mid: t.id,
  mbox: box === 'sent' ? 'sent' : 'INBOX',
  from: { name: t.from_name || t.from_addr, email: t.from_addr },
  to: [{ name: box === 'sent' ? t.to || addr : addr, email: box === 'sent' ? t.to || addr : addr }],
  subject: t.subject,
  snippet: t.snippet,
  body: [t.snippet],
  date: t.date,
  unread: box === 'sent' ? false : t.unread,
  starred: false,
  labels: ['system' as MailLabel],
  // the relay says whether the message CARRIES one; the names arrive with the full read
  hasAttachment: t.has_attachment ? 'attachment' : undefined,
  box,
})

export function usePlatformMailbox(claimsReader: boolean, account: string, reloadNonce: number): PlatformMailbox {
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const [inboxFailed, setInboxFailed] = useState('')
  const [sentFailed, setSentFailed] = useState('')
  const [items, setItems] = useState<LocalThread[]>([])
  const [loading, setLoading] = useState(claimsReader)
  const [address, setAddress] = useState('')
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const loaded = useRef('')

  useEffect(() => {
    // THE GUARD IS THE ACCOUNT, not a boolean: switching mailbox has to read again, and reading again must not…
    if (!claimsReader || loaded.current === `${account}:${reloadNonce}`) return
    loaded.current = `${account}:${reloadNonce}`
    // a new read owes no verdict to the last one: a retry that answers clears the failure it was pressed for
    setLoading(true)
    setError('')
    setInboxFailed('')
    setSentFailed('')
    const settle = (x: PromiseSettledResult<Wire>): Wire | null =>
      x.status === 'fulfilled' ? x.value : null
    // gasAction carries the envelope's status on the thrown Error — a 404 here is the gate, not a hiccup, and the…
    const refusal = (x: PromiseSettledResult<Wire>): { status?: number; message?: string } | null =>
      x.status === 'rejected' ? (x.reason as { status?: number; message?: string } | null) : null
    void Promise.allSettled([
      gasAction<Wire>('platformMailInbox', { limit: 150, account }),
      gasAction<Wire>('platformMailInbox', { limit: 150, box: 'sent', account }),
    ]).then((results) => {
      const inb = settle(results[0])
      const snt = settle(results[1])
      // BOTH FOLDERS REFUSED — never a silent empty inbox.
      if (!inb && !snt) {
        const why = [refusal(results[0]), refusal(results[1])]
        if (why.some((e) => e?.status === 404)) {
          setDenied(true)
        } else {
          setError(why.find((e) => e?.message)?.message || 'The mailserver did not answer.')
        }
        setItems([])
        setAddress('')
        setFolders([])
        setLoading(false)
        return
      }
      // ONE FOLDER DOWN is that folder's failure, kept apart: the other's threads are real, and the missing one is…
      if (!inb) setInboxFailed(refusal(results[0])?.message || 'The inbox did not answer.')
      if (!snt) setSentFailed(refusal(results[1])?.message || 'Sent did not answer.')
      // the address and the folders are the inbox's answer: a failed inbox names no mailbox and lists no folder…
      setAddress(inb ? inb.address : '')
      setFolders(inb?.folders ?? [])
      // The list of mailboxes rides with the answer — one execution, not two.
      if (inb?.accounts?.length) setAccounts(inb.accounts)
      const inbRows = inb?.threads ?? []
      let sntRows = snt?.threads ?? []
      // A Sent that MIRRORS the inbox is the served action ignoring the folder (an older deployment): the same…
      const inbIds = new Set(inbRows.map((t) => t.id))
      if (sntRows.length && sntRows.every((t) => inbIds.has(t.id))) sntRows = []
      setItems([
        ...inbRows.map(asThread(inb?.address ?? '', 'inbox')),
        ...sntRows.map(asThread(snt?.address ?? '', 'sent')),
      ])
      setLoading(false)
    })
  }, [claimsReader, account, reloadNonce])

  return { items, setItems, loading, error, denied, inboxFailed, sentFailed, address, accounts, folders }
}

// THE HEADER'S VERDICT over this read.
export function mailboxHeroRead(m: Pick<PlatformMailbox, 'error' | 'loading' | 'inboxFailed'>): HeroRead {
  if (m.error) return { state: 'failed', reason: m.error }
  if (m.loading) return { state: 'loading' }
  if (m.inboxFailed) {
    return { state: 'failed', reason: `The inbox did not answer (${withoutStop(m.inboxFailed)}); only Sent was read.` }
  }
  return { state: 'ready' }
}

/** The header's figures over this read, counted the one way the page counts them. */
export function mailboxHeroFigures(m: PlatformMailbox): MailFigures {
  return {
    threads: m.items.length,
    unread: m.items.filter((t) => t.box === 'inbox' && t.unread).length,
    mailboxes: m.accounts.length || (m.address ? 1 : null),
    address: m.address,
    folders: m.folders.length || null,
    sentFailed: Boolean(m.sentFailed),
  }
}

/** A server's sentence, ready to sit inside another one. */
export const withoutStop = (s: string): string => s.trim().replace(/\.+$/, '')
