/** Time Off's shapes (server/time_off.py) and the pure words the screens draw; every cut is the server's. */
import type { ApprovedFacts, ApprovedView } from './approvedModel'

export type TimeOffStatus =
  | 'pending' | 'scheduled' | 'denied' | 'withdrawn' | 'cancelled' | 'expired' | 'needs_review' | 'history'

export type Leg = {
  mode?: string
  asked: string[]
  why?: string
  state: string
  by: string
  via: string
  at: string
  note: string
}

export type Touch = { house: string; label: string; location: string; col_iso: string; value: string; claim?: boolean }

export type HouseChip = { code: string; label: string }

export type TimeOffRowView = {
  ref: string
  person: string
  start: string
  end: string
  days: number
  houses: HouseChip[]
  status: TimeOffStatus | string
  status_why: string
  past: boolean
  filed_by: string
  filed_via: string
  created_at: string
  updated_at: string
  hm: Leg
  dir: Leg
  decided_at: string
  closed: { by: string; at: string; note: string }
  test_mode: boolean
  flags: string[]
  calendar_name: string
  source: string
  reason_given: boolean
  unplaced: number
  mine: boolean
  leg: string
  /** null: the directors list did not land, so whether it waits on this reader is unknown */
  waiting_on_me: boolean | null
}

export type HeroEntry = { ref: string; person: string; start: string; end: string; houses: HouseChip[] }

export type Hero = {
  off_now: HeroEntry[]
  upcoming: HeroEntry[]
  /** `on_me` and `soon_on_me` are null while the directors list did not land: unknown, never 0 */
  waiting: { count: number; on_me: number | null; soon_on_me: number | null }
  month: { people: number; days: number; label: string }
  bar: { scheduled: number; waiting: number; review: number } | null
}

export type Scope = 'refused' | 'own' | 'houses' | 'all'

export type Me = {
  name: string
  scope: Scope
  manages: string[]
  may_file_for: 'self' | 'houses' | 'anybody' | ''
  is_director: boolean
  every_house: boolean
  managers_readable: boolean
  waiting_on_me?: number | null
}

export type TimeOffFeed = {
  readable: boolean
  why: string
  house: { minted: boolean; as_of: string }
  hero: Hero | null
  rows: TimeOffRowView[]
  me: Me
  directors: string[]
  /** false: the Settings list did not land; true with no names: the cell is blank */
  directors_readable?: boolean
  directors_why?: string
  houses: (HouseChip & { location?: string })[]
  people: { name: string; houses: string[] }[]
  prefill_house?: string
  test_mode: boolean
  /** R/O typed on a calendar with no request behind it — house managers and above */
  orphan_ro?: { person: string; house: string; label: string; col_iso: string }[]
}

export type Asked = {
  readable: boolean
  hm_mode: string
  hm_names: string[]
  hm_why: string
  /** the whole directors list; `dir_names` is who of it may answer this request */
  dir_listed?: string[]
  dir_names: string[]
  dir_why: string
}

export type Preview = {
  ok: boolean
  refusals: string[]
  person: string
  start: string
  end: string
  days?: number
  dates?: string
  drawn_houses?: string[]
  houses?: HouseChip[]
  /** houses ticked where the person has no calendar row: they do not widen who approves */
  ignored_houses?: HouseChip[]
  asked?: Asked
  touches?: Touch[]
  /** false: the directors list did not land and nothing can be filed */
  directors_readable?: boolean
  /** why the director half cannot be named now: a blank list, or one that did not land */
  directors_why?: string
}

export type Effects = {
  state?: string
  staged?: { house: string; location: string; col_iso: string; value: string; moved_to: string }[]
  unplaced?: { house: string; location: string; col_iso: string; value: string; why: string }[]
  released_claims?: { house: string; location: string; col_iso: string; value: string; open_row: string }[]
  withdrawn_applications?: string[]
  ended_handoffs?: string[]
  trainings?: { house: string; col_iso: string; value: string; trainee: string }[]
  at?: string
  why?: string
}

export type Detail = TimeOffRowView & {
  /** `edit`: an approved request's approvers (whoever may cancel it), never its person or its filer */
  may: { approve: boolean; deny: boolean; withdraw: boolean; cancel: boolean; review: boolean; edit?: boolean }
  /** an approved request's panel: its shifts on Scheduling's calendars and the person's approved days that year */
  approved?: ApprovedFacts
  why_not: string
  directors: string[]
  directors_readable?: boolean
  directors_why?: string
  effects: Effects
  reason_visible: boolean
  reason: string
  reason_why: string
  timeline: { at: string; what: string; text: string }[]
  does?: {
    shifts: Touch[]
    applications: { id: string; house: string; col_iso: string; value: string }[]
    handoffs: { id: string; house: string; col_iso: string; value: string; from: string }[]
    trainings: { house: string; col_iso: string; value: string; trainee: string }[]
  } | null
  does_why?: string
  others_off?: (HeroEntry & { status: string })[]
}

export const FEED_PATH = '/hub-lanes/time-off'
export const DETAIL_PATH = '/hub-lanes/time-off/detail'
export const REQUEST_PATH = '/hub-lanes/time-off/request'
export const DECIDE_PATH = '/hub-lanes/time-off/decide'
export const WITHDRAW_PATH = '/hub-lanes/time-off/withdraw'
export const CANCEL_PATH = '/hub-lanes/time-off/cancel'
export const REVIEW_PATH = '/hub-lanes/time-off/review'
export const SETTINGS_PATH = '/hub-lanes/time-off/settings'
export const DISCARD_TEST_PATH = '/hub-lanes/time-off/discard-test'
export const BOARD_ROUTE = '/app/timeoff/board'
export const REQUESTS_ROUTE = '/app/timeoff/requests'
export const REF_RE = /^TO[0-9A-F]{10}$/

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  scheduled: 'Scheduled',
  denied: 'Denied',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
  expired: 'Expired',
  needs_review: 'Needs review',
  history: 'History',
  past: 'Past',
}

export const STATUS_TINT: Record<string, string> = {
  pending: 'amber',
  scheduled: 'mint',
  denied: 'danger',
  withdrawn: 'slate',
  cancelled: 'pink',
  expired: 'slate',
  needs_review: 'lavender',
  history: 'slate',
  past: 'slate',
}

export const VIA_LABEL: Record<string, string> = {
  platform: 'Platform', form: 'Form', migration: 'Migrated', sms: 'Text', hotline: 'Hotline', email: 'E-mail',
  phone: 'Telephone',
}

/** The pill a row wears: a scheduled row that ended reads Past. */
export function statusOf(r: Pick<TimeOffRowView, 'status' | 'past'>): string {
  return r.status === 'scheduled' && r.past ? 'past' : String(r.status)
}

/** One half of the approval in words, the same on every screen that draws it. */
export function legLine(label: string, leg: Partial<Leg> | undefined): string {
  const l = leg ?? {}
  const via = l.via ? ` · via ${VIA_LABEL[l.via] ?? l.via}` : ''
  if (l.state === 'approved') return `${label}: ${l.by || 'somebody'} · Approved${via}`
  if (l.state === 'denied') return `${label}: ${l.by || 'somebody'} · Denied${via}`
  if (l.state === 'migrated') return `${label}: Migrated from the form`
  if (l.state === 'waiting') {
    const asked = l.asked ?? []
    return `${label}: Waiting${asked.length ? ` on ${asked.slice(0, 3).join(', ')}${asked.length > 3 ? '…' : ''}` : ''}`
  }
  return `${label}: —`
}

export type StepState = 'done' | 'waiting' | 'refused' | 'na'
export type Step = { id: 'asked' | 'hm' | 'dir' | 'scheduled'; label: string; state: StepState; note: string }

function legStep(leg: Leg, label: string, closed: boolean): { state: StepState; note: string } {
  if (leg.state === 'approved') return { state: 'done', note: `${label}: ${leg.by}` }
  if (leg.state === 'migrated') return { state: 'done', note: `${label}: the form, before the platform` }
  if (leg.state === 'denied') return { state: 'refused', note: `${label}: not approved by ${leg.by}` }
  if (leg.state === 'waiting' && !closed) return { state: 'waiting', note: `${label}: waiting` }
  return { state: 'na', note: `${label}: not asked` }
}

/** The four steps: asked, the two independent halves, scheduled. */
export function stepsOf(r: Pick<TimeOffRowView, 'status' | 'hm' | 'dir' | 'created_at' | 'filed_via'>): Step[] {
  const closed = !['pending', 'scheduled', 'needs_review'].includes(String(r.status))
  const hm = legStep(r.hm, 'House manager', closed)
  const dir = legStep(r.dir, 'Director', closed)
  const scheduled: StepState = r.status === 'scheduled' ? 'done'
    : r.status === 'pending' ? 'waiting'
      : r.status === 'denied' ? 'refused'
        : r.status === 'history' && r.hm.state === 'migrated' ? 'done' : 'na'
  return [
    { id: 'asked', label: 'Asked', state: 'done', note: `via ${VIA_LABEL[r.filed_via] ?? (r.filed_via || 'the platform')}` },
    { id: 'hm', label: 'House manager', state: hm.state, note: hm.note },
    { id: 'dir', label: 'Director', state: dir.state, note: dir.note },
    { id: 'scheduled', label: 'Scheduled', state: scheduled,
      note: scheduled === 'done' ? 'scheduled' : scheduled === 'waiting' ? 'waiting on both halves' : String(STATUS_LABEL[r.status] ?? r.status) },
  ]
}

export type Tab = 'mine' | 'waiting' | 'scheduled' | 'history' | 'review'

/** The tabs this reader is drawn: "Waiting on me" only for a reader who decides somewhere. */
export function tabsFor(me: Pick<Me, 'scope' | 'is_director' | 'every_house' | 'manages'>): Tab[] {
  const decides = me.is_director || me.every_house || me.manages.length > 0
  const reviews = me.every_house || me.is_director || me.manages.length > 0
  return (['mine', 'waiting', 'scheduled', 'history', 'review'] as Tab[])
    .filter((t) => (t === 'mine' ? decides : t === 'review' ? reviews : true))
}

export const TAB_LABEL: Record<Tab, string> = {
  mine: 'Waiting on me', waiting: 'Waiting', scheduled: 'Scheduled', history: 'History', review: 'Needs review',
}

/** The tab shown: the address's own when this reader has it, else the reader's first. */
export function tabFrom(asked: string | null | undefined, tabs: Tab[]): Tab {
  return asked && (tabs as string[]).includes(asked) ? (asked as Tab) : tabs[0]
}

/** Whose rows a screen shows, in words; the feed's own scope once read, the SPA's first guess before. */
export function scopeWords(scope: Scope | undefined, manages: string[] = [], houses: HouseChip[] = []): string {
  if (scope === 'own') return 'your own'
  if (scope === 'houses') {
    const names = manages.map((c) => houses.find((h) => h.code === c)?.label ?? c)
    return names.length ? `your own, and the staff of ${names.join(', ')}` : 'your houses'
  }
  if (scope === 'all') return 'the whole company'
  return 'your own'
}

/** A preview counts only for the very inputs it checked. */
export function previewFor<P>(checked: { key: string; preview: P } | null, key: string): P | null {
  return checked && checked.key === key ? checked.preview : null
}

/** Submit is offered only on a clean check of what is on screen now. */
export function mayFile(ready: boolean, preview: Pick<Preview, 'ok'> | null, previewing: boolean, busy: boolean): boolean {
  return ready && preview?.ok === true && !previewing && !busy
}

export function tabOf(r: TimeOffRowView): Tab {
  if (r.status === 'pending') return 'waiting'
  if (r.status === 'needs_review') return 'review'
  if (r.status === 'scheduled' && !r.past) return 'scheduled'
  return 'history'
}

export type Cuts = { q?: string; house?: string; person?: string; status?: string; day?: string; via?: string }

/** One tab's rows under the cuts; narrowing only. */
export function filterRows(rows: TimeOffRowView[], tab: Tab, cuts: Cuts): TimeOffRowView[] {
  const q = (cuts.q ?? '').trim().toLowerCase()
  return rows.filter((r) => {
    if (tab === 'mine' ? !r.waiting_on_me : tabOf(r) !== tab) return false
    if (cuts.house && cuts.house !== 'all' && !r.houses.some((h) => h.code === cuts.house)) return false
    if (cuts.person && cuts.person !== 'all' && r.person !== cuts.person) return false
    if (cuts.status && cuts.status !== 'all' && statusOf(r) !== cuts.status) return false
    if (cuts.via && cuts.via !== 'all' && r.filed_via !== cuts.via) return false
    if (cuts.day && cuts.day !== 'all' && !(r.start <= cuts.day && cuts.day <= r.end)) return false
    if (!q) return true
    return [r.ref, r.person, r.start, r.end, ...r.houses.map((h) => h.code), ...r.houses.map((h) => h.label)]
      .some((v) => String(v ?? '').toLowerCase().includes(q))
  })
}

export function cutsFrom(rows: TimeOffRowView[]): { houses: HouseChip[]; people: string[]; statuses: string[]; vias: string[] } {
  const houses = new Map<string, HouseChip>()
  const people = new Set<string>()
  const statuses = new Set<string>()
  const vias = new Set<string>()
  for (const r of rows) {
    r.houses.forEach((h) => houses.set(h.code, h))
    if (r.person) people.add(r.person)
    statuses.add(statusOf(r))
    if (r.filed_via) vias.add(r.filed_via)
  }
  return { houses: [...houses.values()].sort((a, b) => a.label.localeCompare(b.label)),
           people: [...people].sort((a, b) => a.localeCompare(b)),
           statuses: [...statuses].sort(), vias: [...vias].sort() }
}

/** 'Tue 9/30' — a calendar day, read as a day and never as an instant. */
export function dayWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return String(iso || '')
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  return `${wd} ${Number(m[2])}/${Number(m[3])}`
}

export function spanWords(start: string, end: string): string {
  return !end || start === end ? dayWords(start) : `${dayWords(start)} – ${dayWords(end)}`
}

export function daysWords(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`
}

/** The day count a start and an end cover, inclusive; 0 when they are not a range. */
export function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`)
  const b = Date.parse(`${end}T12:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86400000) + 1
}

/** The band's four figures in words. An unread feed is "—" with a sentence, never 0. */
export type Figure = { value: string; label: string; sub: string }

export function heroFigures(feed: TimeOffFeed | null): Figure[] {
  const dash = '—'
  const h = feed?.hero
  const own = feed?.me?.scope === 'own'
  if (!feed || !feed.readable || !h) {
    const why = !feed ? 'Reading who is off…'
      : !feed.house.minted ? 'Time off is not set up yet' : 'Could not be read just now'
    return [
      { value: dash, label: 'Off now', sub: why },
      { value: dash, label: 'Upcoming', sub: '' },
      { value: dash, label: 'Waiting for approval', sub: '' },
      { value: dash, label: 'Scheduled this month', sub: '' },
    ]
  }
  const mineNow = h.off_now[0]
  const mineNext = h.upcoming[0]
  return [
    own
      ? { value: mineNow ? 'Off' : dash, label: 'Off now',
          sub: mineNow ? `You are off until ${dayWords(mineNow.end)}` : 'You are not off today' }
      : { value: String(h.off_now.length), label: 'Off now',
          sub: h.off_now.length ? `until ${dayWords(h.off_now[0].end)} at the earliest` : 'Nobody is off today' },
    own
      ? { value: mineNext ? dayWords(mineNext.start) : dash, label: 'Upcoming',
          sub: mineNext ? `Your next time off: ${spanWords(mineNext.start, mineNext.end)}` : 'Nothing scheduled in the next two weeks' }
      : { value: String(h.upcoming.length), label: 'Upcoming', sub: 'starting in the next 14 days' },
    { value: String(h.waiting.count), label: 'Waiting for approval',
      sub: own ? `Your requests waiting: ${h.waiting.count}`
        : h.waiting.on_me == null ? `Waiting on you: ${dash} the directors list could not be read`
          : h.waiting.on_me ? `${h.waiting.on_me} waiting on you` : 'none waiting on you' },
    { value: String(h.month.people), label: `Scheduled in ${h.month.label}`,
      sub: `${own ? 'yours' : `${h.month.people} ${h.month.people === 1 ? 'person' : 'people'}`} · ${daysWords(h.month.days)}` },
  ]
}

/** The sentence for a directors list that did not land: nothing is filed or decided, and nothing is "none". */
export function unreadDirectorsLine(why: string | undefined): string {
  return `The directors list could not be read — ${why || 'no reason was given'}. Nothing is filed or decided ` +
    'until it can be, and this screen is not saying nothing waits on you.'
}

/** The one blood-red line the band may carry, or ''. */
export function alertLine(feed: TimeOffFeed | null, isAdmin: boolean): string {
  if (!feed) return ''
  if (!feed.house.minted) return isAdmin ? 'Time off is not set up on this server yet — nothing can be filed.' : ''
  if (!feed.readable) return 'Time off could not be read — this screen is not saying nobody is off.'
  if (feed.directors_readable === false) return unreadDirectorsLine(feed.directors_why)
  const soon = feed.hero?.waiting.soon_on_me ?? 0
  if (soon) return `${soon} request${soon === 1 ? ' starts' : 's start'} within 3 days and ${soon === 1 ? 'is' : 'are'} still waiting on you.`
  return ''
}

/** My own rows, newest first, for the strip under the form. */
export function myRows(feed: TimeOffFeed | null): TimeOffRowView[] {
  if (!feed) return []
  return feed.rows.filter((r) => r.mine && !['history'].includes(String(r.status)))
    .sort((a, b) => (b.start || '').localeCompare(a.start || ''))
    .slice(0, 12)
}

/** The houses a form prefills: the address's house, else the houses the preview says the person is drawn on. */
export function prefillHouses(asked: string | null | undefined, drawn: string[] | undefined, known: HouseChip[]): string[] {
  const codes = new Set(known.map((h) => h.code))
  const want = String(asked || '').trim().toUpperCase()
  const fromAsk = want ? known.find((h) => h.code === want || want.endsWith(` - ${h.code}`))?.code : ''
  return [...new Set([...(fromAsk ? [fromAsk] : []), ...(drawn ?? []).filter((c) => codes.has(c))])]
}

/** Who approves, in one line, from the preview; a list that names nobody is told apart from one whose every name is in the request. */
export function askedLine(a: Asked | undefined): string {
  if (!a) return ''
  const hm = a.hm_mode === 'house_manager'
    ? `House manager: ${a.hm_names.join(' or ')}`
    : a.hm_mode === 'above'
      ? `House manager half: ${a.dir_names.length ? 'a listed director or an administrator' : 'an administrator'}`
      : 'House manager: to be named when the calendars can be read'
  const listed = a.dir_listed ?? []
  const dirs = a.dir_names.length ? `Director: one of ${a.dir_names.join(', ')}`
    : listed.length
      ? `Director: every name on Settings → Time Off (${listed.join(', ')}) is part of this request — this half waits until another name is saved there`
      : 'Director: nobody is named on Settings → Time Off yet — this half waits until somebody is'
  return `${hm} · ${dirs}`
}

// The directors, as the list itself answers: the names; or that the list did not land, which is never drawn as…
export function directorsLine(d: { directors: string[]; directors_readable?: boolean; directors_why?: string }): string {
  if (d.directors.length) return `Directors on the list: ${d.directors.join(', ')}`
  if (d.directors_readable === false) {
    return `The directors list could not be read — ${d.directors_why || 'no reason was given'}. Nothing is decided until it can be.`
  }
  return 'No director is named on Settings → Time Off yet — the director half waits until somebody is.'
}

/** The toast after filing: who was asked, and the server's sentence for why the director half has nobody yet. */
export function filedLine(asked: { house_manager: string[]; directors: string[]; directors_why?: string }): string {
  const named = [...asked.house_manager, ...asked.directors]
  const head = named.length ? `Asked: ${named.join(', ')}` : 'The approvers are named when the calendars can be read.'
  const why = String(asked.directors_why ?? '').trim()
  if (asked.directors.length || !why) return head
  return `${head.replace(/\.$/, '')}. ${why.charAt(0).toUpperCase()}${why.slice(1)}.`
}

export type PanelAction = 'approve' | 'deny' | 'withdraw' | 'cancel' | 'confirm' | 'merge' | 'discard'

/** The actions a panel draws: the server's `may`, and nothing else. */
export function actionsFor(may: Detail['may'] | undefined): PanelAction[] {
  if (!may) return []
  return [
    ...(may.approve ? ['approve' as const] : []),
    ...(may.deny ? ['deny' as const] : []),
    ...(may.withdraw ? ['withdraw' as const] : []),
    ...(may.cancel ? ['cancel' as const] : []),
    ...(may.review ? (['confirm', 'merge', 'discard'] as const) : []),
  ]
}

/** The inline two-press confirmation: the first press arms, the second acts. */
export function nextPress(armed: string, action: string): { act: boolean; armed: string } {
  return armed === action ? { act: true, armed: '' } : { act: false, armed: action }
}

/** The request an address opens: a well-formed TO… ref, or ''. */
export function openRefOf(params: URLSearchParams): string {
  const ref = String(params.get('ref') ?? '').trim().toUpperCase()
  return REF_RE.test(ref) ? ref : ''
}

/** An approved request opens in the operator's layout; Edit (or `?edit=1`) shows what its approvers may do. */
export function isApproved(d: Pick<TimeOffRowView, 'status'> | null | undefined): boolean {
  return d?.status === 'scheduled'
}

/** Still waiting on its approvers: it opens in the operator's layout too, its answers in the footer. */
export function isWaiting(d: Pick<TimeOffRowView, 'status'> | null | undefined): boolean {
  return d?.status === 'pending'
}

/** The approved panel's facts, from the Time Off record. */
export function approvedViewOf(d: Detail): ApprovedView {
  return {
    person: d.person, start: d.start, end: d.end, requested: d.created_at, days: d.days,
    reason: d.reason_visible ? (d.reason_why || d.reason) : null,
    facts: d.approved ?? null,
    factsWhy: d.approved ? '' : 'this server does not say yet',
  }
}

/** `?edit=1`: opened from another screen's Edit, straight into what the approvers may do. */
export function editAsked(params: URLSearchParams): boolean {
  return params.get('edit') === '1'
}

/** The action an e-mail link asks to focus; it never acts by itself. */
export function focusedAction(act: string | null | undefined): 'approve' | 'deny' | '' {
  return act === 'approve' || act === 'deny' ? act : ''
}
