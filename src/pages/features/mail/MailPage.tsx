/**
 * Mail — a polished 3-pane inbox (route /app/mail/inbox, mounted via
 * CUSTOM_PAGES in AppRoutePage once the 'mail' manifest from
 * src/registry/apps-mail.ts is wired into src/registry/apps.ts).
 *
 * WHAT THIS SCREEN IS: the PLATFORM's mailbox
 * (asa-hub@asaop.org), read live by the master and by whatever badges
 * `platform_mail_badges` names. It carries no invented mail of any kind.
 * Until today everyone else was handed a seeded inbox — fictional people,
 * fictional threads, a "Connect Gmail" banner for an integration that does
 * not exist — and nothing on the screen distinguished those messages from
 * real ones. An account without the mailbox now reads exactly that sentence
 * — every mock has to die.
 *
 * Sending is everybody's, and it is REAL: the composer goes through
 * `platformMailSend`, the same declared action the global e-mail dialog uses.
 *
 * Layout: left rail (Compose + folders + label chips) · middle thread list
 * (search + rows) · right reading pane (subject/from/body + actions).
 * Collapses to list → detail on mobile; the rail folds into a chip row.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ohioDateTime, ohioDay, ohioSameDay, ohioTime } from '@/lib/ohio'
import {
  Archive,
  ArrowLeft,
  Download,
  FolderOpen,
  Loader2,
  Mail,
  Paperclip,
  PenLine,
  RefreshCw,
  Reply,
  ReplyAll,
  Forward,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import type { MailAddress, MailLabel } from './types'
import AddMailboxPanel from './AddMailboxPanel'
import MailHero from './MailHero'
import {
  mailboxHeroFigures, mailboxHeroRead, usePlatformMailbox, withoutStop, type Box, type LocalThread,
} from './usePlatformMailbox'
import { composeEmail } from '@/stores/useEmailComposeStore'
import { gasAction } from '@/features/hiring/shared'
import { withFollowedBadges } from '@/lib/badgeFollows'
import { cn } from '@/lib/utils'

/* ---------------- types + meta ---------------- */

// What the full-message door answered for one thread, cached per row so a message is fetched ONCE per screen visit…
type FullMessage = {
  loading: boolean
  text?: string
  html?: string
  attachments?: { part: number; filename: string; mime: string; size: number }[]
  // the door is not there yet (old deployment) or refused — the snippet serves, and the pane says it is a preview
  unavailable?: boolean
}

type FolderId = 'inbox' | 'starred' | 'sent' | 'archive'
type View = { kind: 'folder'; id: FolderId } | { kind: 'label'; id: MailLabel }

const FOLDERS: { id: FolderId; label: string; icon: typeof Mail }[] = [
  { id: 'inbox', label: 'Inbox', icon: Mail },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
]

const LABEL_META: Record<MailLabel, { label: string; dot: string; chip: string }> = {
  clients: { label: 'Clients', dot: 'bg-tint-fg-pink', chip: 'bg-tint-pink text-tint-fg-pink' },
  staff: { label: 'Staff', dot: 'bg-tint-fg-blue', chip: 'bg-tint-blue text-tint-fg-blue' },
  billing: { label: 'Billing', dot: 'bg-tint-fg-amber', chip: 'bg-tint-amber text-tint-fg-amber' },
  system: { label: 'System', dot: 'bg-tint-fg-lavender', chip: 'bg-tint-lavender text-tint-fg-lavender' },
}

type ComposerDraft = {
  to: string
  subject: string
  body: string
}

// Ohio wall-clock for every viewer — the mailserver's stamps are instants; the browser's own zone never decides…
function threadDate(iso: string): string {
  return ohioSameDay(iso, new Date()) ? ohioTime(iso) : ohioDay(iso)
}

const ghostBtn =
  'flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1'

/* ---------------- the message renderers ---------------- */

// The sender's HTML, in a frame that cannot act.
function MailHtml({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(240)
  const doc = useMemo(() =>
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    '<style>body{margin:12px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;' +
    'color:#26272b;word-break:break-word}img{max-width:100%;height:auto}' +
    'table{max-width:100%}</style></head><body>' + html + '</body></html>', [html])
  return (
    <iframe
      ref={frame}
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      onLoad={() => {
        try {
          const h = frame.current?.contentDocument?.body?.scrollHeight ?? 0
          if (h) setHeight(Math.min(6000, h + 28))
        } catch { /* measured nothing — the default height scrolls inside */ }
      }}
      style={{ height }}
      className="w-full rounded-md border border-border bg-white"
    />
  )
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

// One attachment: named, sized, and DOWNLOADABLE — the old pane promised "downloads with Gmail sync", an…
function AttachmentChip({ att, thread, account }: {
  att: { part: number; filename: string; mime: string; size: number }
  thread: LocalThread
  account: string
}) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    if (busy || !thread.mid) return
    setBusy(true)
    try {
      const r = await gasAction<{ b64?: string; filename?: string; mime?: string }>(
        'platformMailAttachment',
        { id: thread.mid, part: att.part, mailbox: thread.mbox, hint: thread.subject, account })
      if (!r.b64) throw new Error('The attachment did not come back.')
      const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || att.mime || 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = r.filename || att.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // revoked on a delay: revoking synchronously races the click in Safari
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (err) {
      toast({ type: 'danger', title: 'Not downloaded',
        body: err instanceof Error ? err.message : 'The mailserver did not hand it over.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={() => void download()}
      disabled={busy}
      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3.5 py-2.5 text-left transition-colors hover:border-primary disabled:opacity-60"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-tint-blue">
        <Paperclip size={14} className="text-tint-fg-blue" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="clamp-1 block text-[13px] font-semibold text-text-1">{att.filename}</span>
        <span className="block text-[11px] text-text-3">{att.mime} · {fmtSize(att.size)}</span>
      </span>
      {busy ? <Loader2 size={15} className="shrink-0 animate-spin text-text-3" />
            : <Download size={15} className="shrink-0 text-text-3" />}
    </button>
  )
}

/* ================= page ================= */

export default function MailPage() {
  const user = useAuthStore((s) => s.user)
  const me: MailAddress = { name: user?.name ?? 'Alex Morgan', email: user?.email ?? 'alex@asahub.io' }

  // NOBODY SEES INVENTED MAIL — not for a frame, and not at all.
  const mailReader = user?.mailReader
  const worn = withFollowedBadges((user?.types ?? []).map((t) => String(t).toUpperCase().trim()))
  const claimsReader = user?.isMaster === true ||
    (mailReader === undefined ? worn.includes('DIRECTOR') : mailReader)
  // WHICH OF THE PLATFORM'S MAILBOXES IS OPEN — the platform holds up to five.
  const [account, setAccount] = useState('1')
  // Bumped by the refresh button — the ONE other legitimate reason to read again.
  const [reloadNonce, setReloadNonce] = useState(0)
  // THE PLATFORM MAILBOX — asa-hub@asaop.org, for the accounts the config names; inbox and Sent each with its own…
  const mailbox = usePlatformMailbox(claimsReader, account, reloadNonce)
  const {
    items, setItems,
    loading: mailboxLoading, error: mailboxError, denied: mailboxDenied,
    inboxFailed, sentFailed,
    address: platformAddr, accounts, folders: mailFolders,
  } = mailbox
  // The name `isMaster` survives below as "reads the real mailbox".
  const isMaster = claimsReader && !mailboxDenied
  // The + panel: WHERE to add another mailbox, opened from the row of addresses.
  const [addingMailbox, setAddingMailbox] = useState(false)
  const [folderView, setFolderView] = useState('')
  const [folderRows, setFolderRows] = useState<LocalThread[]>([])
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderFailed, setFolderFailed] = useState('')
  const [view, setView] = useState<View>({ kind: 'folder', id: 'inbox' })

  // THE UNREAD BADGE PER MAILBOX (the switcher never had one — you opened each of five boxes to learn which had…
  const [unreadBy, setUnreadBy] = useState<Record<string, number>>({})
  const unreadLoaded = useRef(-1)
  useEffect(() => {
    if (!claimsReader || unreadLoaded.current === reloadNonce) return
    unreadLoaded.current = reloadNonce
    gasAction<{ counts: { account: string; unread: number }[] }>('platformMailUnread', {})
      .then((r) => {
        const map: Record<string, number> = {}
        for (const c of r.counts ?? []) if (c.unread >= 0) map[c.account] = c.unread
        setUnreadBy(map)
      })
      .catch(() => {})
  }, [claimsReader, reloadNonce])

  const refreshMailbox = () => {
    setFull({})
    setSelectedId(null)
    if (folderView) { openMailFolder(folderView); return }
    setReloadNonce((n) => n + 1)
  }

  /** One read per open — a filed report is not a stream. */
  const openMailFolder = (name: string) => {
    setFolderView(name)
    setSelectedId(null)
    setFolderLoading(true)
    setFolderFailed('')
    type Wire = { address: string; threads: {
      id: string; from_name: string; from_addr: string; to: string; subject: string
      date: string; snippet: string; unread: boolean
    }[] }
    gasAction<Wire>('platformMailInbox', { limit: 150, box: name, account })
      .then((r) => {
        setFolderRows((r.threads ?? []).map((t) => ({
          id: `pf-${t.id}`,
          mid: t.id,
          mbox: name,
          from: { name: t.from_name || t.from_addr, email: t.from_addr },
          to: [{ name: r.address, email: r.address }],
          subject: t.subject,
          snippet: t.snippet,
          body: [t.snippet],
          date: t.date,
          unread: false,
          starred: false,
          labels: ['system' as MailLabel],
          box: 'archive' as Box,
        })))
      })
      // a folder that did not answer is said, never shown as an empty folder
      .catch((e) => {
        setFolderRows([])
        setFolderFailed(e instanceof Error && e.message ? e.message : 'The folder did not answer.')
      })
      .finally(() => setFolderLoading(false))
  }
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [composer, setComposer] = useState<ComposerDraft | null>(null)

  const unreadCount = items.filter((t) => t.box === 'inbox' && t.unread).length
  /** the folder on screen did not answer while the other one did */
  const viewFailed = !folderView && view.kind === 'folder'
    ? view.id === 'inbox' ? inboxFailed : view.id === 'sent' ? sentFailed : ''
    : ''

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    // A mailbox folder is its own view: the rows came from ONE read of that folder, filtered here by the same…
    if (folderView) {
      return folderRows
        .filter((t) => !q || t.subject.toLowerCase().includes(q) ||
          t.snippet.toLowerCase().includes(q) || t.from.name.toLowerCase().includes(q))
        .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    }
    const inView = (t: LocalThread) => {
      if (t.box === 'trash') return false
      if (view.kind === 'label') return t.labels.includes(view.id)
      switch (view.id) {
        case 'inbox':
          return t.box === 'inbox'
        case 'starred':
          return t.starred
        case 'sent':
          return t.box === 'sent'
        case 'archive':
          return t.box === 'archive'
      }
    }
    return items
      .filter(inView)
      .filter(
        (t) =>
          !q ||
          t.subject.toLowerCase().includes(q) ||
          t.snippet.toLowerCase().includes(q) ||
          t.from.name.toLowerCase().includes(q) ||
          t.from.email.toLowerCase().includes(q),
      )
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  }, [items, view, query, folderView, folderRows])

  const selected = (folderView ? folderRows : items).find((t) => t.id === selectedId) ?? null

  const patch = (id: string, p: Partial<LocalThread>) =>
    setItems((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)))

  // OPENING A MESSAGE NOW READS THE MESSAGE.
  const [full, setFull] = useState<Record<string, FullMessage>>({})
  const fetchFull = (t: LocalThread) => {
    if (!t.mid || full[t.id]) return
    setFull((m) => ({ ...m, [t.id]: { loading: true } }))
    gasAction<{ text?: string; html?: string
      attachments?: { part: number; filename: string; mime: string; size: number }[] }>(
      'platformMailMessage',
      { id: t.mid, mailbox: t.mbox, hint: t.subject, account })
      .then((r) => setFull((m) => ({ ...m, [t.id]: {
        loading: false, text: r.text, html: r.html, attachments: r.attachments ?? [],
      } })))
      .catch(() => setFull((m) => ({ ...m, [t.id]: { loading: false, unavailable: true } })))
  }

  const openThread = (t: LocalThread) => {
    setSelectedId(t.id)
    fetchFull(t)
    if (t.unread) {
      patch(t.id, { unread: false })
      // THE FLAG LANDS ON THE SERVER TOO — fire-and-forget, because a person reading must never wait for…
      if (t.mid) {
        void gasAction('platformMailMark',
          { items: [{ id: t.mid, hint: t.subject }], seen: true, account }).catch(() => {})
      }
    }
  }

  // FILING IS THE MAILBOX'S NOW.
  const fileThread = (t: LocalThread, folder: 'Archive' | 'Trash') => {
    const localBox: Box = folder === 'Archive' ? 'archive' : 'trash'
    patch(t.id, { box: localBox })
    setSelectedId(null)
    if (t.box !== 'inbox' || !t.mid) {
      toast({ type: 'info', title: folder === 'Archive' ? 'Moved to Archive' : 'Removed from the list',
        body: 'Filed on this screen — the mailbox itself is unchanged.' })
      return
    }
    gasAction<{ moved: number }>('platformMailMove',
      { id: t.mid, hint: t.subject, folder, account })
      .then((r) => {
        if (r.moved > 0) {
          toast({ type: 'success', title: folder === 'Archive' ? 'Archived' : 'Moved to Trash',
            body: `Filed in the mailbox's ${folder} folder.` })
        } else {
          patch(t.id, { box: 'inbox' })
          toast({ type: 'warning', title: 'Not moved',
            body: 'The mailserver could not find this message — it is back in the list.' })
        }
      })
      .catch((err) => {
        patch(t.id, { box: 'inbox' })
        toast({ type: 'warning', title: 'Not moved on the server',
          body: err instanceof Error && !err.message.startsWith('Unknown action')
            ? err.message
            : 'The message is back in the inbox — nothing was lost.' })
      })
  }
  const archiveThread = (t: LocalThread) => fileThread(t, 'Archive')
  const deleteThread = (t: LocalThread) => fileThread(t, 'Trash')

  const quoteBody = (t: LocalThread) => {
    // the full text when the pane already fetched it; the snippet otherwise — quoting 400 characters of a two-page…
    const paras = full[t.id]?.text
      ? full[t.id].text!.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
      : t.body
    return `\n\n— On ${ohioDateTime(t.date)}, ${t.from.name} wrote:\n` +
      paras.map((p) => `> ${p.split('\n').join('\n> ')}`).join('\n> \n')
  }

  const openReply = (t: LocalThread, all: boolean) => {
    const to = all
      ? [t.from, ...t.to.filter((a) => a.email !== me.email)].map((a) => a.email).join(', ')
      : t.from.email
    setComposer({ to, subject: `Re: ${t.subject}`, body: quoteBody(t) })
  }

  const openForward = (t: LocalThread) =>
    setComposer({ to: '', subject: `Fwd: ${t.subject}`, body: quoteBody(t) })

  /**
   * IT SENDS. Through `platformMailSend` — the same declared action the
   * platform's global e-mail dialog uses, so this composer inherits the whole
   * door (resolver, opt-out list, test redirect) instead of inventing a
   * second one. Until today it added a row to Sent and toasted "queued";
   * nothing ever left, and the row looked exactly like a message that had.
   *
   * The local Sent row is written only AFTER the server says it went, and it
   * is a receipt for this screen — the mailbox's own Sent folder is read from
   * the mailserver on the next open.
   */
  const [sending, setSending] = useState(false)
  const sendComposer = async () => {
    if (!composer || sending) return
    const recipients = composer.to.split(',').map((e) => e.trim()).filter(Boolean)
    if (!recipients.every((e) => e.includes('@'))) {
      toast({ type: 'warning', title: 'Check the address', body: 'One of the recipients is not an e-mail address.' })
      return
    }
    setSending(true)
    try {
      const r = await gasAction<{ sent: boolean; note?: string }>('platformMailSend', {
        to: recipients.join(', '),
        subject: composer.subject.trim(),
        body: composer.body,
        // IT LEAVES FROM THE MAILBOX YOU ARE READING.
        from_account: account,
      })
      if (!r.sent) {
        toast({ type: 'warning', title: 'Not sent', body: r.note ?? 'The platform recorded it without sending.' })
        return
      }
      const firstLine = composer.body.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
      setItems((ts) => [{
        id: `sent-${Date.now().toString(36)}`,
        from: me,
        to: recipients.map((email) => ({ name: email.split('@')[0], email })),
        subject: composer.subject.trim() || '(no subject)',
        snippet: firstLine.slice(0, 140),
        body: composer.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
        date: new Date().toISOString(),
        unread: false,
        starred: false,
        labels: [],
        box: 'sent',
      }, ...ts])
      setComposer(null)
      toast({ type: 'success', title: 'Sent', body: `The platform mailed ${recipients.join(', ')}.` })
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Not sent',
        body: err instanceof Error ? err.message : 'The mailserver did not accept it.',
      })
    } finally {
      setSending(false)
    }
  }

  const viewLabel = folderView || (view.kind === 'label' ? LABEL_META[view.id].label : FOLDERS.find((f) => f.id === view.id)?.label)

  // fits the viewport: topbar, shell padding, 2.5rem for the shell's copyright line, and the strip at the top while…
  return (
    <div className="flex h-[calc(100dvh-68px-2rem-2.5rem-var(--hub-strip-h,0px))] flex-col gap-3 sm:h-[calc(100dvh-68px-3rem-2.5rem-var(--hub-strip-h,0px))]">
      {/* THE BLACK HEADER — what this read found, and for whom. An account
          the mailserver refuses gets the sentence, never four zeroes; an
          inbox that did not answer is a failed read, never "0 unread". */}
      <MailHero
        read={mailboxHeroRead(mailbox)}
        denied={!claimsReader || mailboxDenied}
        figures={mailboxHeroFigures(mailbox)}
        onRetry={refreshMailbox}
      />

      {/* ---------- the mailbox banner ----------
          The master's screen carries NOTHING Gmail: his mail is the
          platform's own mailbox, already connected. The Gmail offer belongs
          only to everyone else's demo. */}
      {isMaster && (
        <div className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-1">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-blue text-tint-fg-blue">
            <Mail size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-1">
              {platformAddr
                ? `${platformAddr}${account === '1' ? " — the platform's own mailbox" : ''}`
                : mailboxError ? 'The platform mailbox did not answer'
                  : inboxFailed ? 'The inbox did not answer' : 'Opening the platform mailbox…'}
            </p>
            {/* MORE THAN ONE MAILBOX — the platform holds up to five.
                Drawn only when there IS a choice — a single-item
                switcher is a control that teaches nothing and takes a row. */}
            {accounts.length > 1 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { if (a.id !== account) { setSelectedId(null); setAccount(a.id) } }}
                    disabled={mailboxLoading}
                    title={a.primary ? "The platform's own voice — everything automatic leaves from here" : ''}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors',
                      a.id === account
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-text-2 hover:bg-surface-2',
                    )}
                  >
                    {a.address}
                    {a.primary && <span className="ml-1 opacity-60">·</span>}
                    {(unreadBy[a.id] ?? 0) > 0 && (
                      <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-on-primary">
                        {unreadBy[a.id]}
                      </span>
                    )}
                  </button>
                ))}
                {accounts.length < 5 && (
                  <button
                    onClick={() => setAddingMailbox((v) => !v)}
                    title="Add another mailbox"
                    aria-label="Add another mailbox"
                    className={cn(
                      'grid h-[22px] w-[22px] place-items-center rounded-full border transition-colors',
                      addingMailbox
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-dashed border-border text-text-3 hover:border-primary hover:text-primary',
                    )}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
            )}
            {/* ADD A MAILBOX: masters get a real form — the
                platformMailAccountAdd door verifies the pair against the
                mailserver and rides the tool lane, so the password never
                lands on a queue. Non-masters keep the property explainer. */}
            {addingMailbox && (
              <AddMailboxPanel
                accounts={accounts}
                isMaster={user?.isMaster === true}
                onAdded={(id) => { setAddingMailbox(false); setSelectedId(null); setAccount(id) }}
              />
            )}
            <p className="text-[12px] text-text-3">
              {mailboxError
                ? `${mailboxError} Nothing was read — this screen is showing no mail rather than an empty box.`
                : inboxFailed || sentFailed
                  ? `${inboxFailed ? 'The inbox' : 'Sent'} did not answer (${withoutStop(inboxFailed || sentFailed)}) — only ${inboxFailed ? 'Sent' : 'the inbox'} was read.`
                  : 'Live from the mailserver, read-only. What every user sends through the e-mail icon is filed in Sent.'}
            </p>
            {/* HOW TO ADD ANOTHER ONE, said where somebody is already looking.
                The passwords live in Script Properties and NOWHERE ELSE; since
                a master can wire a pair from the panel itself — the
                add door rides the TOOL lane (one synchronous ride, no queued
                body on the relay's disk), verifying against the mailserver
                before anything is stored. */}
            {/* ONE mailbox (or none, or a refusing one) and no switcher row:
                the + still has to be reachable — a mailbox error is exactly
                when credentials need fixing. Five of five draws neither. */}
            {accounts.length <= 1 && (
              <button
                onClick={() => setAddingMailbox((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
              >
                <Plus size={11} /> add another mailbox
              </button>
            )}
          </div>
        </div>
      )}
      {/* ---------- the badge is gone ----------
          Said plainly, once: the server refused both folders, so this
          account no longer reads the platform mailbox. Silence here is what
          produced the empty inbox nobody could explain. */}
      {mailboxDenied && (
        <div className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-1">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-amber text-tint-fg-amber">
            <Mail size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-1">This account no longer reads the platform mailbox</p>
            <p className="text-[12px] text-text-3">
              Its badge was removed in Settings → Email. You can still send from here; there is nothing to read.
            </p>
          </div>
        </div>
      )}
      {/* ---------- everybody else ----------
          Not a mailbox of their own, and never pretending to be: the platform
          has ONE mailbox, and this account does not read it. The sentence is
          the whole feature — an account that cannot read must still know
          that it can send, and from which address. */}
      {!isMaster && !mailboxDenied && !bannerDismissed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-1">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-text-2">
            <Mail size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-1">You do not read the platform mailbox</p>
            <p className="text-[12px] text-text-3">
              Mail here is the company's own box, read by the accounts an admin names in Settings → Email.
              Sending is everybody's — Compose leaves as the platform's address.
            </p>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* ---------- mobile folder chips ---------- */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5 lg:hidden">
        {FOLDERS.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setView({ kind: 'folder', id: f.id })
              setFolderView('')
              setSelectedId(null)
            }}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
              view.kind === 'folder' && view.id === f.id ? 'bg-primary-soft text-primary-strong' : 'bg-surface text-text-2',
            )}
          >
            <f.icon size={13} />
            {f.label}
            {f.id === 'inbox' && unreadCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-on-primary">{unreadCount}</span>
            )}
          </button>
        ))}
        {(Object.keys(LABEL_META) as MailLabel[]).map((l) => (
          <button
            key={l}
            onClick={() => {
              setView({ kind: 'label', id: l })
              setFolderView('')
              setSelectedId(null)
            }}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
              view.kind === 'label' && view.id === l ? 'bg-primary-soft text-primary-strong' : 'bg-surface text-text-2',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', LABEL_META[l].dot)} />
            {LABEL_META[l].label}
          </button>
        ))}
      </div>

      {/* ---------- 3-pane body ---------- */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* left rail */}
        <aside className="hidden w-[216px] shrink-0 flex-col rounded-lg border border-border bg-surface p-3 shadow-1 lg:flex">
          <button
            onClick={() => (isMaster
              ? composeEmail({ source: 'Mail' })
              : setComposer({ to: '', subject: '', body: '' }))}
            className="flex h-11 items-center justify-center gap-2 rounded-full bg-primary text-[14px] font-semibold text-on-primary shadow-1 transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            <PenLine size={16} />
            Compose
          </button>

          <nav className="mt-4 grid gap-0.5" aria-label="Mail folders">
            {FOLDERS.map((f) => {
              const active = view.kind === 'folder' && view.id === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    setView({ kind: 'folder', id: f.id })
                    setFolderView('')
                    setSelectedId(null)
                  }}
                  className={cn(
                    'flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150',
                    active ? 'bg-primary-soft font-semibold text-primary-strong' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  <f.icon size={15} />
                  {f.label}
                  {f.id === 'inbox' && unreadCount > 0 && (
                    <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-on-primary">
                      {unreadCount}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          {mailFolders.length > 0 && (
            <>
              <p className="mb-1.5 mt-5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
                Mailbox folders
              </p>
              <nav className="grid gap-0.5" aria-label="Mailbox folders">
                {mailFolders.map((name) => (
                  <button
                    key={name}
                    onClick={() => openMailFolder(name)}
                    className={cn(
                      'flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150',
                      folderView === name
                        ? 'bg-primary-soft font-semibold text-primary-strong'
                        : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                    )}
                  >
                    <FolderOpen size={15} />
                    <span className="clamp-1 text-left">{name.replace(/^(?:Staff|Mail) /, '')}</span>
                  </button>
                ))}
              </nav>
            </>
          )}

          <p className="mb-1.5 mt-5 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
            Labels
          </p>
          <nav className="grid gap-0.5" aria-label="Mail labels">
            {(Object.keys(LABEL_META) as MailLabel[]).map((l) => {
              const active = view.kind === 'label' && view.id === l
              return (
                <button
                  key={l}
                  onClick={() => {
                    setView({ kind: 'label', id: l })
                    setFolderView('')
                    setSelectedId(null)
                  }}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150',
                    active ? 'bg-primary-soft font-semibold text-primary-strong' : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', LABEL_META[l].dot)} />
                  {LABEL_META[l].label}
                </button>
              )
            })}
          </nav>

          {!isMaster && (
            <div className="mt-auto rounded-md bg-surface-2 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-text-2">
                <Mail size={12} /> Sending is yours
              </p>
              <p className="mt-1 text-[11px] leading-4 text-text-3">
                Compose leaves as the platform's address. Reading the box is granted by badge in Settings → Email.
              </p>
            </div>
          )}
        </aside>

        {/* middle — thread list */}
        <section
          className={cn(
            'w-full flex-col rounded-lg border border-border bg-surface shadow-1 md:flex md:w-[340px] md:shrink-0 xl:w-[380px]',
            selected ? 'hidden' : 'flex',
          )}
          aria-label="Threads"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${viewLabel?.toLowerCase() ?? 'mail'}…`}
                className="h-9 w-full rounded-full border border-border bg-surface-2 pl-9 pr-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
              />
            </div>
            {/* one press, one re-read — the screen used to read once per open
                and there was no way to ask again short of leaving */}
            {isMaster && (
              <button
                onClick={refreshMailbox}
                disabled={mailboxLoading || folderLoading}
                aria-label="Refresh the mailbox"
                title="Refresh"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-50"
              >
                <RefreshCw size={14} className={cn((mailboxLoading || folderLoading) && 'animate-spin')} />
              </button>
            )}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <Mail size={26} className={cn('text-text-3', mailboxLoading && 'animate-pulse')} />
                <p className="text-[13px] font-medium text-text-1">
                  {folderLoading ? `Opening ${folderView}…`
                    : folderView && folderFailed ? 'The folder could not be read'
                      : mailboxLoading ? 'Opening the mailbox…'
                        : mailboxError ? 'The mailbox could not be read'
                          : viewFailed ? `${view.id === 'sent' ? 'Sent' : 'The inbox'} could not be read`
                            : folderView ? 'The folder is empty'
                              : !isMaster && !query ? 'No mailbox on this account' : 'Nothing here'}
                </p>
                <p className="text-[12px] text-text-3">
                  {folderView && folderFailed ? `${withoutStop(folderFailed)} — this is not an empty folder.`
                    : mailboxLoading ? 'Reading it live from the mailserver.'
                      : mailboxError ? mailboxError
                        : viewFailed ? `${withoutStop(viewFailed)} — this is not an empty folder.`
                          : query ? 'No threads match your search.'
                            : !isMaster ? 'Reading the company box is granted by badge in Settings → Email.'
                              : 'This view is empty.'}
                </p>
              </div>
            )}
            {visible.map((t) => {
              const isSel = t.id === selectedId
              return (
                <button
                  key={t.id}
                  onClick={() => openThread(t)}
                  className={cn(
                    'relative flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors duration-150',
                    isSel ? 'bg-tint-primary' : 'hover:bg-surface-2',
                  )}
                >
                  {isSel && <span className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-primary" />}
                  {/* The sender is a person: no id travels with a letter, so the
                      e-mail address is the identity Focus gets. */}
                  <DragPerson name={t.from.name} id={t.from.email} subtitle={t.from.email} className="shrink-0">
                    <Avatar name={t.from.name} size="md" />
                  </DragPerson>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <DragPerson name={t.from.name} id={t.from.email} subtitle={t.from.email} className="min-w-0">
                        <span className={cn('clamp-1 text-[13px] text-text-1', t.unread ? 'font-bold' : 'font-medium')}>
                          {t.from.name}
                        </span>
                      </DragPerson>
                      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-3">{threadDate(t.date)}</span>
                    </span>
                    <span className={cn('clamp-1 mt-0.5 block text-[12.5px]', t.unread ? 'font-semibold text-text-1' : 'text-text-2')}>
                      {t.subject}
                    </span>
                    <span className="clamp-1 mt-0.5 block text-[12px] text-text-3">{t.snippet}</span>
                    <span className="mt-1.5 flex items-center gap-1.5">
                      {t.labels.slice(0, 2).map((l) => (
                        <span
                          key={l}
                          className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold', LABEL_META[l].chip)}
                        >
                          <span className={cn('h-1 w-1 rounded-full', LABEL_META[l].dot)} />
                          {LABEL_META[l].label}
                        </span>
                      ))}
                      {t.hasAttachment && <Paperclip size={11} className="text-text-3" />}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
                    {t.unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={t.starred ? 'Unstar thread' : 'Star thread'}
                      onClick={(e) => {
                        e.stopPropagation()
                        patch(t.id, { starred: !t.starred })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          patch(t.id, { starred: !t.starred })
                        }
                      }}
                      className={cn(
                        'grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-surface-2',
                        t.starred ? 'text-tint-fg-amber' : 'text-text-3 hover:text-text-1',
                      )}
                    >
                      <Star size={14} fill={t.starred ? 'currentColor' : 'none'} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* right — reading pane */}
        <section
          className={cn(
            'min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface shadow-1 md:flex',
            selected ? 'flex' : 'hidden',
          )}
          aria-label="Reading pane"
        >
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-tint-blue">
                <Mail size={24} className="text-tint-fg-blue" />
              </span>
              <p className="font-display text-[16px] font-bold text-text-1">Select a thread to read</p>
              <p className="max-w-[280px] text-[13px] leading-5 text-text-3">
                {isMaster
                  ? 'The platform’s mailbox — pick a message on the left.'
                  : 'This account does not read the platform mailbox, so there is nothing to open. Compose still sends.'}
              </p>
            </div>
          ) : (
            <>
              {/* header */}
              <div className="shrink-0 border-b border-border px-5 py-4 sm:px-7">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setSelectedId(null)}
                    aria-label="Back to thread list"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 md:hidden"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h1 className="min-w-0 flex-1 font-display text-[19px] font-bold leading-6 tracking-[-0.01em] text-text-1">
                    {selected.subject}
                  </h1>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <DragPerson name={selected.from.name} id={selected.from.email} subtitle={selected.from.email} className="shrink-0">
                    <Avatar name={selected.from.name} size="md" />
                  </DragPerson>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-text-1">
                      <DragPerson name={selected.from.name} id={selected.from.email} subtitle={selected.from.email}>
                        {selected.from.name}
                      </DragPerson> <span className="font-normal text-text-3">&lt;{selected.from.email}&gt;</span>
                    </p>
                    {/* Every recipient is a person, so the joined string had to
                        become one wrapper per name — the rendered line is the
                        same "to a, b, c". "me" stays bare: it is a pronoun, and
                        dragging yourself onto your own focus slot is not a use. */}
                    <p className="clamp-1 text-[12px] text-text-3">
                      to {selected.to.map((a, i) => (
                        <Fragment key={`${a.email}-${i}`}>
                          {i > 0 && ', '}
                          {a.email === me.email ? 'me' : (
                            <DragPerson name={a.name} id={a.email} subtitle={a.email}>{a.name}</DragPerson>
                          )}
                        </Fragment>
                      ))}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-[11px] tabular-nums text-text-3">
                    {ohioDateTime(selected.date)}
                  </p>
                </div>
              </div>

              {/* body — the MESSAGE, not the snippet. Four
                  states, in falling order: still fetching; the sender's HTML
                  in a sandboxed frame (no scripts, no forms — the sandbox
                  attribute carries no tokens for either); the full plain
                  text; and the snippet, labelled as the preview it is, when
                  the door is not there or refused. */}
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
                <article className="mx-auto max-w-[680px]">
                  {full[selected.id]?.loading && (
                    <p className="flex items-center gap-2 text-[13px] text-text-3">
                      <Loader2 size={14} className="animate-spin" /> Opening the message…
                    </p>
                  )}
                  {!full[selected.id]?.loading && full[selected.id]?.html ? (
                    <MailHtml html={full[selected.id].html!} />
                  ) : !full[selected.id]?.loading && full[selected.id]?.text ? (
                    full[selected.id].text!.split(/\n{2,}/).map((p, i) => (
                      <p key={i} className={cn('whitespace-pre-wrap text-[14px] leading-6 text-text-2', i > 0 && 'mt-3.5')}>
                        {p.trim()}
                      </p>
                    ))
                  ) : !full[selected.id]?.loading ? (
                    <>
                      {selected.body.map((p, i) => (
                        <p key={i} className={cn('text-[14px] leading-6 text-text-2', i > 0 && 'mt-3.5')}>
                          {p}
                        </p>
                      ))}
                      {full[selected.id]?.unavailable && (
                        <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-[12px] text-text-3">
                          This is the preview the list carries — the full message could not be
                          fetched{selected.mid ? '' : ' for this row'}. It is intact on the mailserver.
                        </p>
                      )}
                    </>
                  ) : null}
                  {(full[selected.id]?.attachments?.length ?? 0) > 0 && (
                    <div className="mt-5 grid gap-2">
                      {full[selected.id].attachments!.map((a) => (
                        <AttachmentChip key={a.part} att={a} thread={selected} account={account} />
                      ))}
                    </div>
                  )}
                </article>
              </div>

              {/* footer actions */}
              <div className="shrink-0 border-t border-border px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-1">
                  <button onClick={() => openReply(selected, false)} className={ghostBtn}>
                    <Reply size={15} /> Reply
                  </button>
                  <button onClick={() => openReply(selected, true)} className={ghostBtn}>
                    <ReplyAll size={15} /> Reply all
                  </button>
                  <button onClick={() => openForward(selected)} className={ghostBtn}>
                    <Forward size={15} /> Forward
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => archiveThread(selected)} className={ghostBtn}>
                      <Archive size={15} /> Archive
                    </button>
                    <button
                      onClick={() => deleteThread(selected)}
                      className={cn(ghostBtn, 'hover:text-danger')}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ---------- composer modal ---------- */}
      <Dialog open={!!composer} onOpenChange={(o) => !o && setComposer(null)}>
        <DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col bg-surface sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px] font-bold text-text-1">New message</DialogTitle>
            <DialogDescription className="text-[13px] text-text-2">
              Sent from the platform's own address — the recipient sees asa., not your personal e-mail.
            </DialogDescription>
          </DialogHeader>
          {composer && (
            <div className="scroll-thin grid min-h-0 flex-1 gap-3 overflow-y-auto">
              <label className="grid gap-1.5">
                <span className="text-[12px] font-medium text-text-2">To</span>
                <input
                  value={composer.to}
                  onChange={(e) => setComposer({ ...composer, to: e.target.value })}
                  placeholder="name@example.org, …"
                  className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-[12px] font-medium text-text-2">Subject</span>
                <input
                  value={composer.subject}
                  onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                  placeholder="Subject"
                  className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
                />
              </label>
              <textarea
                value={composer.body}
                onChange={(e) => setComposer({ ...composer, body: e.target.value })}
                rows={11}
                placeholder="Write your message…"
                className="w-full resize-none rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
              />
            </div>
          )}
          <DialogFooter>
            <button
              onClick={() => setComposer(null)}
              className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              Discard
            </button>
            <button
              onClick={() => void sendComposer()}
              disabled={!composer?.to.trim() || sending}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {sending ? 'Sending…' : 'Send'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The "Connect Gmail" modal was removed: it described an
          OAuth integration that does not exist and never had a button that
          did anything. The platform's mailbox is the feature; a dialog
          explaining a different, imaginary one is a mock with a footer. */}
    </div>
  )
}
