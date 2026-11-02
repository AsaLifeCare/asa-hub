// My Inbox — the answer of /hub-lanes/my-inbox and the pure decisions the screen draws from it.
// The relay decides whose alerts these are (the signed-in account's own, or, for the master's own session, a chosen…
import { relTime } from '@/components/shared/AlertRow'
import { dayOnly, ohioDateTime, ohioDay, ohioDayOf, ohioDayYear } from '@/lib/ohio'
import type { TintName } from '@/engine/types'

export const MY_INBOX_PATH = '/hub-lanes/my-inbox'
export const MY_INBOX_READ_PATH = '/hub-lanes/my-inbox/read'
/** the door takes at most this many keys at once */
export const READ_MAX = 500

export type HeadState = 'ready' | 'unreadable' | 'not_attributable' | 'held' | 'closed' | 'not_on_platform'

export type HeadPart = { key: string; label: string; state: string; why: string }

export type InboxHead = {
  key: string
  label: string
  state: HeadState
  why: string
  as_of: string
  count: number | null
  note: string
  /** what a ready source could not settle: its items are listed, but it is not whole */
  gap: string
  parts?: HeadPart[]
}

export type AlertLink = { href: string; label: string }

/** What a person answers on an alert addressed to them, through the source's own door (never the read marks). */
export type AlertAct = {
  kind: 'aware' | 'seen'
  action: 'supportInboxAnswer' | 'schedulingAnswer'
  item_id: string
  label: string
  done: boolean
  by: string
  at: string
}

export type AlertLevel = 'warning' | 'important' | 'info'

export type AlertItem = {
  id: string
  type: string
  title: string
  body: string
  /** a UTC instant or a plain 'YYYY-MM-DD' */
  at: string
  flag: boolean
  link: AlertLink | null
  read: boolean
  /** sent only on an item the subject answers; absent for the master looking at somebody else */
  act?: AlertAct
  level?: AlertLevel
}

export type PersonEntry = { uid: string; label: string; role: string }

export type Marks = { readable: boolean; why: string; kept: boolean; kept_why: string }

// Settings › My Work's Sources switch as this session is shown it, decided by the relay.
export type InboxDisplay = {
  hidden: { inbox_sources: boolean }
  for_users?: { inbox_sources: boolean }
  readable?: boolean
  why?: string
}

export type MyInboxView = {
  scope: {
    mode: 'own' | 'mass'
    why: string
    person: string
    readonly: boolean
    people?: PersonEntry[] | null
    people_why?: string
  }
  subject: { name: string; key_why: string }
  heads: InboxHead[]
  items: AlertItem[]
  unread: number
  capped: string
  marks: Marks
  read_at: string
  /** absent from a relay that predates the setting: nothing is hidden */
  display?: InboxDisplay
  /** sent only with the Sources list hidden, which then sends no head: whether every source landed */
  whole?: boolean
  /** a client-role account's answer (my_inbox.family_board): New staff and the company notices at its own houses */
  family?: true
  viewer?: 'client' | 'guardian'
  ward?: { name: string }
  /** null when the backend did not answer, so whether the account is linked is not known */
  linked?: boolean | null
  why?: string
}

/** The door's address; the person is the relay's to honour or refuse. */
export function myInboxPath(person?: string): string {
  const p = String(person ?? '').trim()
  return p ? `${MY_INBOX_PATH}?person=${encodeURIComponent(p)}` : MY_INBOX_PATH
}

// The chosen person kept in the address, after a read: dropped when the door refused it as out of scope or as no…
export function choiceAfter(state: { status: string; reason: string }, chosen: string): string {
  return chosen && state.status === 'refused' && (state.reason === 'scope' || state.reason === 'person') ? '' : chosen
}

/* ---------- the types ---------- */

/** The chat's own item type: built here, never sent by the relay. */
export const MESSAGES = 'messages'

/** The Type filter, in the order the chips are offered. */
export const TYPE_CHIPS: { label: string; type: string }[] = [
  { label: 'Requests', type: 'requests' },
  { label: 'Reimbursement', type: 'reimbursement' },
  { label: 'Missing punch', type: 'punch' },
  { label: 'Scheduling', type: 'scheduling' },
  { label: 'Support Requests', type: 'support' },
  { label: 'Transportation', type: 'transport' },
  { label: 'Hiring', type: 'hiring' },
  { label: 'New staff', type: 'new_staff' },
  { label: 'New clients', type: 'new_clients' },
  { label: 'Prospects', type: 'potential_clients' },
  { label: 'Company notices', type: 'notices' },
  { label: 'Updates', type: 'updates' },
  { label: 'Medication errors', type: 'med_error' },
  { label: 'Messages', type: MESSAGES },
]

/** All a client-role account is told (my_inbox.FAMILY_SOURCES), then the chat. */
export const FAMILY_CHIPS: { label: string; type: string }[] = [
  { label: 'New staff', type: 'new_staff' },
  { label: 'Company notices', type: 'notices' },
  { label: 'Messages', type: MESSAGES },
]

const FAMILY_TYPES = new Set(FAMILY_CHIPS.map((c) => c.type))

// The Type filter this answer offers.
export function chipsOf(view: Pick<MyInboxView, 'heads' | 'family'> | null | undefined): { label: string; type: string }[] {
  if (!view?.family) return TYPE_CHIPS
  const keys = new Set((view.heads ?? []).map((h) => h.key))
  if (!keys.size) return FAMILY_CHIPS
  return FAMILY_CHIPS.filter((c) => c.type === MESSAGES || keys.has(c.type))
}

/** The items drawn: a client-role account's are its three types alone, whatever else an answer carries. */
export function listedItems(view: Pick<MyInboxView, 'items' | 'family'> | null | undefined): AlertItem[] {
  const items = view?.items ?? []
  return view?.family ? items.filter((it) => FAMILY_TYPES.has(it.type)) : items
}

export function typeOfChip(label: string): string {
  return (TYPE_CHIPS.find((c) => c.label === label) ?? FAMILY_CHIPS.find((c) => c.label === label))?.type ?? ''
}

const LOOK: Record<string, { icon: string; tint: TintName; label?: string }> = {
  requests: { icon: 'list-checks', tint: 'mint' },
  reimbursement: { icon: 'receipt', tint: 'green' },
  punch: { icon: 'clock', tint: 'amber' },
  scheduling: { icon: 'calendar-clock', tint: 'blue' },
  support: { icon: 'life-buoy', tint: 'blue', label: 'Support Requests' },
  transport: { icon: 'car-front', tint: 'blue' },
  hiring: { icon: 'git-branch', tint: 'lavender' },
  new_staff: { icon: 'user-plus', tint: 'blue' },
  new_clients: { icon: 'heart-handshake', tint: 'pink' },
  potential_clients: { icon: 'users', tint: 'peach' },
  notices: { icon: 'megaphone', tint: 'amber' },
  // the completed icon, in the success green ('green' is the mint pair, whose ink is --success)
  updates: { icon: 'circle-check', tint: 'green' },
  med_error: { icon: 'pill', tint: 'pink' },
  [MESSAGES]: { icon: 'at-sign', tint: 'blue' },
}

export function lookOf(type: string): { icon: string; tint: TintName; label?: string } {
  return LOOK[type] ?? { icon: 'info', tint: 'lavender' }
}

/** A row's tile: a warning is red with the triangle, an important alert amber with the flag, the rest their type's. */
export function lookFor(item: Pick<AlertItem, 'type' | 'level'>): { icon: string; tint: TintName } {
  if (item.level === 'warning') return { icon: 'triangle-alert', tint: 'pink' }
  if (item.level === 'important') return { icon: 'flag', tint: 'amber' }
  const l = lookOf(item.type)
  return { icon: l.icon, tint: l.tint }
}

/* ---------- the answer a person gives an alert ---------- */

export const AWARE_PILL = 'Directors, are you aware?'
export const IMPORTANT_PILL = 'Important'

/** The pill a row and its panel carry: a warning still unanswered asks; an important one says so. */
export function levelPill(item: Pick<AlertItem, 'level' | 'act'>): { text: string; tone: Tone } | null {
  if (item.level === 'warning') return item.act?.done ? { text: 'Aware', tone: 'good' } : { text: AWARE_PILL, tone: 'danger' }
  if (item.level === 'important') return { text: IMPORTANT_PILL, tone: 'warning' }
  return null
}

/** The row opens its panel, not its link, when there is something to answer or something to say about it. */
export function opensPanel(item: Pick<AlertItem, 'act' | 'level'>): boolean {
  return Boolean(item.act) || item.level === 'warning' || item.level === 'important'
}

/** Clear is not offered on a warning nobody has answered: it would vanish unseen. */
export function clearable(item: Pick<AlertItem, 'act' | 'level'>): boolean {
  return !(item.level === 'warning' && item.act && !item.act.done)
}

/** What the act's door is handed: Scheduling's warnings answer 'seen'; ours answer 'aware' or 'seen'. */
export function actPayload(act: AlertAct): { item_id: string; word: 'aware' | 'seen' } {
  const word = act.kind === 'aware' && act.action !== 'schedulingAnswer' ? 'aware' : 'seen'
  return { item_id: act.item_id, word }
}

/** The line once answered: when, and by whom when the door said. */
export function actDoneLine(act: AlertAct): string {
  if (!act.at) return 'You marked this. It is kept; the list catches up on its next read.'
  return `You marked this at ${ohioDateTime(act.at)}${act.by ? ` (${act.by})` : ''}.`
}

/** The chat's item has no mark of this door: opening the conversation is what reads it. */
export function markable(item: AlertItem): boolean {
  return item.type !== MESSAGES
}

/* ---------- the chat's item ---------- */

export type ChatLatest = { id: string; at: string; from_user: string; from_name: string; body: string } | null

/** One item for the unread chat, from the shell's own count; none when nothing is unread. */
export function chatAlert(unread: number, latest: ChatLatest): AlertItem | null {
  const n = Math.max(0, Math.floor(Number(unread) || 0))
  if (!n) return null
  const who = latest?.from_name || 'Somebody'
  const body = String(latest?.body ?? '')
  const withUser = String(latest?.from_user ?? '')
  return {
    id: 'chat:unread',
    type: MESSAGES,
    title: n === 1 ? `${who} sent you a message` : `${n} unread chat messages`,
    body: n === 1 ? body : latest ? `Newest from ${who}${body ? `: ${body}` : ''}` : '',
    at: String(latest?.at ?? ''),
    flag: false,
    link: { href: withUser ? `/app/my-inbox/chat?with=${encodeURIComponent(withUser)}` : '/app/my-inbox/chat', label: 'Open in Chat' },
    read: false,
  }
}

/** The relay's items with the chat's merged in, newest first. */
export function withChat(items: AlertItem[], chat: AlertItem | null): AlertItem[] {
  if (!chat) return items
  const key = sortKey(chat.at)
  const at = items.findIndex((it) => sortKey(it.at) < key)
  return at < 0 ? [...items, chat] : [...items.slice(0, at), chat, ...items.slice(at)]
}

/* ---------- time, in Ohio ---------- */

/** The instant an `at` names, as comparable text: a plain day sorts as its own start. */
function sortKey(at: string): string {
  const day = dayOnly(at)
  if (day) return day
  const t = Date.parse(at)
  return Number.isFinite(t) ? new Date(t).toISOString() : ''
}

/** The Ohio day an item belongs to: a plain day is that day, never parsed through a UTC midnight. */
export function alertDay(at: string): string {
  const day = dayOnly(at)
  if (day) return day
  return at ? ohioDayOf(at) : ''
}

/** The stamp at the right of a row. */
export function alertWhen(at: string): string {
  const day = dayOnly(at)
  if (day) return ohioDay(`${day}T12:00:00Z`)
  return at && Number.isFinite(Date.parse(at)) ? relTime(at) : ''
}

/** 'as of Sep 27, 2026, 9:14 AM' for an instant, 'as of Sep 27, 2026' for a day; '' for none. */
export function asOfWords(value: string): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  const day = dayOnly(v)
  const words = day ? ohioDayYear(`${day}T12:00:00Z`) : ohioDateTime(v)
  return words ? `as of ${words}` : ''
}

/* ---------- the list ---------- */

export type InboxTab = 'all' | 'unread' | 'mentions'

export function filterAlerts(items: AlertItem[], tab: InboxTab | string, type: string): AlertItem[] {
  return items
    .filter((it) => (tab === 'unread' ? !it.read : tab === 'mentions' ? it.type === MESSAGES : true))
    .filter((it) => (type ? it.type === type : true))
}

export function tabCounts(items: AlertItem[]): { all: number; unread: number; mentions: number } {
  return {
    all: items.length,
    unread: items.filter((it) => !it.read).length,
    mentions: items.filter((it) => it.type === MESSAGES).length,
  }
}

/** A count of nothing is never shown bare: 'Mentions' with none, 'Mentions · n' with some. */
export function tabLabels(items: AlertItem[]): { id: InboxTab; label: string }[] {
  const c = tabCounts(items)
  return [
    { id: 'all', label: `All · ${c.all}` },
    { id: 'unread', label: `Unread · ${c.unread}` },
    { id: 'mentions', label: c.mentions ? `Mentions · ${c.mentions}` : 'Mentions' },
  ]
}

export const MENTIONS_LINE = 'Chat messages to you — @mentions are not on the platform yet.'

/** What Mark all marks: every unread item this door keeps marks for. */
export function unreadKeys(items: AlertItem[]): string[] {
  return items.filter((it) => !it.read && markable(it)).map((it) => it.id).slice(0, READ_MAX)
}

/** What Clear read clears: every read item this door keeps marks for, never a warning still unanswered. */
export function readKeys(items: AlertItem[]): string[] {
  return items.filter((it) => it.read && markable(it) && clearable(it)).map((it) => it.id).slice(0, READ_MAX)
}

/** The keys the door would take, the chat's left out. */
export function markKeys(items: AlertItem[], ids: Iterable<string>): string[] {
  const want = new Set(ids)
  return items.filter((it) => want.has(it.id) && markable(it)).map((it) => it.id).slice(0, READ_MAX)
}

/** 'aware': answered here and taken by its door; drawn done until the mirror shows it. */
export type MarkOverride = 'read' | 'dismissed' | 'aware'

/** The answer as this tab has marked it: a cleared item leaves, a read one reads; the unread count follows. */
export function applyMarks(view: MyInboxView, marks: ReadonlyMap<string, MarkOverride>): MyInboxView {
  if (!marks.size) return view
  const items = view.items
    .filter((it) => marks.get(it.id) !== 'dismissed')
    .map((it) => {
      const m = marks.get(it.id)
      if (m === 'aware') return { ...it, read: true, ...(it.act && !it.act.done ? { act: { ...it.act, done: true } } : {}) }
      return m === 'read' && !it.read ? { ...it, read: true } : it
    })
  return { ...view, items, unread: items.filter((it) => !it.read).length }
}

/* ---------- the sources ---------- */

/** Ready with nothing unsettled, or shut to the person: nothing it holds is missing from the list. */
export function landed(h: InboxHead): boolean {
  return (h.state === 'ready' && !h.gap) || h.state === 'closed'
}

export function sourceHeads(view: MyInboxView | null): InboxHead[] {
  return (view?.heads ?? []).filter((h) => h.state !== 'not_on_platform')
}

export function notOnPlatform(view: MyInboxView | null): InboxHead[] {
  return (view?.heads ?? []).filter((h) => h.state === 'not_on_platform')
}

/** Left out when the relay says so — it then sent no source at all. */
export function sourcesHidden(view: MyInboxView | null | undefined): boolean {
  return view?.display?.hidden?.inbox_sources === true
}

/** The master's own session: that everyone else is not shown the Sources card, or why nothing is hidden. '' when neither. */
export function sourcesForUsersLine(view: MyInboxView | null | undefined): string {
  const d = view?.display
  if (!d || view?.scope.mode !== 'mass') return ''
  if (d.readable === false) return d.why ? sentenceCase(`${d.why}, so nothing is hidden from anyone`) : ''
  return d.for_users?.inbox_sources === true
    ? 'Hidden from everyone else by Settings › My Work: this Sources card. You see everything.'
    : ''
}

export type Tone = 'danger' | 'warning' | 'muted' | 'good'

const STATE_WORDS: Record<HeadState, { text: string; tone: Tone }> = {
  ready: { text: 'Ready', tone: 'good' },
  unreadable: { text: 'Could not be read', tone: 'danger' },
  not_attributable: { text: 'Not tied to you', tone: 'warning' },
  held: { text: 'Held', tone: 'warning' },
  closed: { text: 'Not open to you', tone: 'muted' },
  not_on_platform: { text: 'Not on the platform yet', tone: 'muted' },
}

/** The pill a source carries: its state, and its count when it is ready. */
export function headPill(h: InboxHead): { text: string; tone: Tone } {
  const w = STATE_WORDS[h.state] ?? { text: 'Unknown', tone: 'danger' as Tone }
  if (h.state === 'ready' && typeof h.count === 'number') return { text: `${w.text} · ${h.count}`, tone: h.gap ? 'warning' : w.tone }
  return w
}

export type HeadLine = { key: string; tone: Tone; text: string }

/** The sentences under a source: why it did not answer, what it could not settle, its note and its parts. */
export function headLines(h: InboxHead): HeadLine[] {
  const out: HeadLine[] = []
  if (h.state !== 'ready' && h.why) {
    out.push({ key: `${h.key}:why`, tone: STATE_WORDS[h.state]?.tone ?? 'danger', text: sentenceCase(h.why) })
  }
  if (h.gap) out.push({ key: `${h.key}:gap`, tone: 'warning', text: sentenceCase(h.gap) })
  if (h.note) out.push({ key: `${h.key}:note`, tone: 'muted', text: sentenceCase(h.note) })
  for (const p of h.parts ?? []) {
    if (p.state === 'ready') continue
    const tone: Tone = p.state === 'unreadable' ? 'danger' : 'warning'
    out.push({ key: `${h.key}:${p.key}`, tone, text: `${p.label}: ${sentenceCase(p.why) || 'not read.'}` })
  }
  return out
}

/** The empty sentence with the Sources card hidden and a source that did not land: plain, and never "nothing". */
export const EMPTY_UNCHECKED = 'Nothing to show right now — some alerts could not be checked. Try again later.'

// The empty sentence for what is drawn.
export function emptyWords(view: MyInboxView | null, tab: InboxTab | string, type: string, chosen: boolean): string {
  if (tab === 'mentions') return 'No unread chat messages to you. @mentions in documents are not on the platform yet.'
  if (type === MESSAGES) return 'No unread chat messages to you.'
  const hidden = sourcesHidden(view)
  const heads = sourceHeads(view)
  const typed = type ? heads.filter((h) => h.key === type) : heads
  const whole = hidden ? view?.whole === true : typed.length > 0 && typed.every(landed)
  if (whole) {
    if (tab === 'unread') return 'No unread alerts — all caught up.'
    if (type) return 'Nothing of this type right now.'
    return chosen ? 'Nothing concerns this person right now.' : 'Nothing needs you right now.'
  }
  if (hidden) return EMPTY_UNCHECKED
  const partial = 'Sources below says what is missing'
  if (tab === 'unread') return `No unread alerts from the sources that answered — ${partial}.`
  if (type) return `Nothing of this type from the sources that answered — ${partial}.`
  return `Nothing from the sources that answered — ${partial}.`
}

/* ---------- the marks ---------- */

export const KEPT_WHY_ACTING = 'Read marks are not kept in a switched session.'
export const KEPT_WHY_CHOSEN = "Read marks are that person's; you are only looking."

// How the mark buttons are drawn: hidden in a switched session, disabled on a chosen person's alerts, and the line…
export function marksMode(view: MyInboxView | null, acting: boolean): { show: boolean; enabled: boolean; line: string } {
  if (acting) return { show: false, enabled: false, line: view?.marks?.kept_why || KEPT_WHY_ACTING }
  if (!view) return { show: true, enabled: false, line: '' }
  if (view.marks?.kept === false) return { show: true, enabled: false, line: view.marks.kept_why || KEPT_WHY_CHOSEN }
  return { show: true, enabled: true, line: '' }
}

/** Said when what was read could not be read: every alert is shown unread. */
export function marksUnreadLine(view: MyInboxView | null): string {
  if (!view || view.marks?.readable !== false) return ''
  const why = String(view.marks.why ?? '').trim()
  return `What you have read could not be read${why ? ` (${why})` : ''}, so every alert shows as unread.`
}

/** A relay clause as a sentence: capital first, one full stop. */
export function sentenceCase(text: string | undefined): string {
  const t = String(text ?? '').trim()
  if (!t) return ''
  const s = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(s) ? s : `${s}.`
}
