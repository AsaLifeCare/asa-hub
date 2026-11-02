/**
 * MY INBOX · Alerts and Chat: the manifest, the header, the Alerts screen drawn whole, its one read and its
 * marks, and the chat embedded under the same header.
 *
 * Whose alerts these are is decided by the relay; the screen is held to what it promises with them — a source
 * that did not answer is said and never read as nothing, a chosen person's alerts are only looked at, a
 * switched session keeps no mark, and the embedded chat keeps no Apps Script timer.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { AlertRow, NotificationRow, dayGroups } from '@/components/shared/AlertRow'
import { badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { useChatPresenceStore } from '@/lib/chatPresence'
import { PageRefreshTick, usePageRefresh } from '@/lib/pageRefresh'
import { useMemberStore } from '@/stores/useMemberStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { appManifests } from '@/registry/apps'
import { myInboxManifests } from '@/registry/apps-myinbox'
import { BuilderRefreshTick, useBuilderRefresh } from '@/pages/features/calendarbuilder/builderRefresh'
import ChatPage, {
  ACTING_COMPOSER_LINE, ACTING_PICK_TITLE, LIVE_OFF_LINE, reactToLine, sendChatLine,
} from '@/pages/features/chat/ChatPage'
import { LIVE_ACTING_LINE } from '@/pages/features/chat/live/ChatLiveView'
import ChatAppPage, { CHAT_APP_SUBTITLE } from '@/pages/features/chat/ChatAppPage'
import { useFloorTick } from '@/pages/features/chat/floorTick'
import * as model from '@/pages/features/myinbox/myInboxModel'
import type { AlertItem, InboxHead, MyInboxView } from '@/pages/features/myinbox/myInboxModel'
import MyInboxPage, {
  InboxChat, MyInboxHeader, VISIT_SENTENCE, VisitNotice, switchItems, viewOf,
} from '@/pages/features/myinbox/MyInboxPage'
import { AlertsScreen, SourcesCard, useMyInboxAlerts } from '@/pages/features/myinbox/AlertsView'
import { MY_INBOX_IDLE, forgetHeld, useMyInbox, type Chooser, type MyInboxState } from '@/pages/features/myinbox/useMyInbox'
import type { AppNotification } from '@/engine/types'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: React.ReactNode, at = '/app/my-inbox/alerts') =>
  flat(renderToString(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>))
const source = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const noop = () => {}

const LABELS: Record<string, string> = {
  requests: 'Your requests', reimbursement: 'Reimbursement requests', punch: 'Missing punches', hiring: 'Hiring',
  new_staff: 'New staff', new_clients: 'New clients', potential_clients: 'New prospects', notices: 'Company notices',
  updates: 'Software updates', med_error: 'Medication error reports',
}

const head = (key: string, over: Partial<InboxHead> = {}): InboxHead => ({
  key, label: LABELS[key] ?? key, state: 'ready', why: '', as_of: '', count: 0, note: '', gap: '', ...over,
})

const NOT_ON_PLATFORM: InboxHead[] = [
  head('mentions', { label: '@mentions', state: 'not_on_platform', count: null,
    why: 'Nothing on the platform reads an @ in documents or notes yet. The Mentions filter shows the chat messages written to you.' }),
  head('doctor_appointments', { label: 'Doctor appointments with your clients', state: 'not_on_platform', count: null,
    why: 'The appointment book has no staff column, so no appointment can be tied to you.' }),
  head('punch_history', { label: 'Missing punches before yesterday', state: 'not_on_platform', count: null,
    why: 'Only yesterday and today are kept.' }),
]

function heads(over: Record<string, Partial<InboxHead>> = {}): InboxHead[] {
  return [...Object.keys(LABELS).map((k) => head(k, over[k] ?? {})), ...NOT_ON_PLATFORM]
}

function item(id: string, type: string, over: Partial<AlertItem> = {}): AlertItem {
  return { id, type, title: `Alert ${id}`, body: `About ${id}`, at: '2026-09-27T14:00:00Z', flag: false, link: null, read: false, ...over }
}

function view(over: Partial<MyInboxView> = {}): MyInboxView {
  return {
    scope: { mode: 'own', why: '', person: '', readonly: false },
    subject: { name: 'Ann Roe', key_why: '' },
    heads: heads(),
    items: [
      item('req:tor1:open', 'requests', { title: 'Time off — Waiting on the house manager',
        link: { href: '/app/my-work/actions', label: 'Open in My Work' } }),
      item('punch:s1:no_punch', 'punch', { title: 'No punch — Sat 9/26', at: '2026-09-26' }),
      item('srv-7', 'notices', { title: 'Open shift at Akron', read: true, at: '2026-09-25T15:00:00Z' }),
    ],
    unread: 2,
    capped: '',
    marks: { readable: true, why: '', kept: true, kept_why: '' },
    read_at: '2026-09-27T15:00:00Z',
    ...over,
  }
}

const ready = (v: MyInboxView): MyInboxState => ({ ...MY_INBOX_IDLE, status: 'ready', data: v, readAt: Date.parse('2026-09-27T15:00:00Z') })

function screen(v: MyInboxView | null, opts: {
  state?: MyInboxState; chat?: AlertItem | null; chooser?: Chooser | null; person?: string; acting?: boolean
  tab?: model.InboxTab; type?: string; select?: boolean
} = {}) {
  return draw(
    <AlertsScreen state={opts.state ?? (v ? ready(v) : MY_INBOX_IDLE)} view={v} chat={opts.chat ?? null}
      chooser={opts.chooser ?? null} person={opts.person ?? ''} acting={opts.acting ?? false} onPerson={noop}
      onOpen={noop} onMarkRead={noop} onClear={noop} onRetry={noop}
      initialTab={opts.tab} initialType={opts.type} initialSelect={opts.select} />,
  )
}

/** The attributes of the one element carrying `data-<name>`. */
function tagOf(html: string, name: string): string {
  const m = new RegExp(`<[a-z]+[^>]*data-${name}(?:="[^"]*")?[^>]*>`).exec(html)
  return m ? m[0] : ''
}

/** The button's own disabled attribute — never its `disabled:` style classes. */
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag)

describe('the app', () => {
  it('is "My Inbox", id my-inbox, pages Alerts and Chat — and sits in the registry once', () => {
    const app = myInboxManifests[0]
    assert.equal(app.id, 'my-inbox')
    assert.equal(app.name, 'My Inbox')
    assert.equal(app.category, 'Workspace')
    assert.deepEqual(app.pages.map((p) => [p.id, p.title]), [['alerts', 'Alerts'], ['chat', 'Chat']])
    assert.equal(appManifests.filter((m) => m.id === 'my-inbox').length, 1)
  })

  it('ships no App Control row: staff with an empty matrix cannot open it, the master can', () => {
    const staff = { role: 'staff', types: ['STAFF'], isMaster: false }
    assert.equal(badgeAllowsApp('my-inbox', staff, {}), false)
    assert.equal(badgeAllowsApp('my-inbox', { ...staff, role: 'admin', types: ['ADMIN'] }, { crm: ['ADMIN'] }), false)
    assert.equal(badgeAllowsApp('my-inbox', { role: 'admin', types: [], isMaster: true }, {}), true)
    const hits: string[] = []
    for (const dir of ['apps-script', 'tools']) {
      for (const f of readdirSync(resolve(ROOT, dir))) {
        if (!/\.(gs|py|mjs|js|json)$/.test(f) || f === 'test-my-inbox.py') continue
        const text = readFileSync(join(resolve(ROOT, dir), f), 'utf8')
        if (/app_badge_access[^\n]{0,200}my-inbox|my-inbox[^\n]{0,200}app_badge_access/.test(text)) hits.push(f)
      }
    }
    assert.deepEqual(hits, [])
  })

  it('both addresses are routed to the one screen', () => {
    const routes = source('src/pages/AppRoutePage.tsx')
    assert.match(routes, /'my-inbox\/alerts': MyInboxPage/)
    assert.match(routes, /'my-inbox\/chat': MyInboxPage/)
    assert.equal(viewOf('chat'), 'chat')
    assert.equal(viewOf('alerts'), 'alerts')
    assert.equal(viewOf('anything'), 'alerts')
  })
})

describe('the header', () => {
  it('draws the Refresh button, then the page switch — and no pill row', () => {
    const html = draw(<MyInboxHeader page="alerts" chatUnread={0} onRefresh={noop} onPick={noop} />)
    assert.match(html, /<h1[^>]*>My Inbox<\/h1>/)
    const refresh = html.indexOf('aria-label="Refresh"')
    const sw = html.indexOf('aria-label="Go to another view of My Inbox"')
    assert.ok(refresh > 0 && sw > refresh, 'Refresh comes first, the switch after it')
    assert.ok(html.includes('lucide-refresh-cw') || html.includes('refresh-cw'), 'the Refresh icon')
    assert.ok(html.includes('h-9') && html.includes('max-sm:hidden'), 'the Calendar Builder Refresh classes')
    assert.ok(!html.includes('>Mail<') && !html.includes('Notification settings'))
    assert.equal((html.match(/>Alerts</g) ?? []).length, 1, 'the one Alerts is the switch showing where you are')
    assert.ok(!/rounded-full[^"]*"[^>]*>(Alerts|Chat)</.test(html), 'no pill buttons')
  })

  it('the switch offers Alerts and Chat, and Chat carries its unread count', () => {
    assert.deepEqual(switchItems(0).map((i) => [i.id, i.title]), [['alerts', 'Alerts'], ['chat', 'Chat']])
    assert.deepEqual(switchItems(3).map((i) => i.title), ['Alerts', 'Chat · 3'])
    const html = draw(<MyInboxHeader page="chat" chatUnread={2} onRefresh={noop} onPick={noop} />, '/app/my-inbox/chat')
    assert.ok(html.includes('>Chat · 2<'))
  })

  it('the page wraps its views in the page Refresh and draws the visit notice inside a visit', () => {
    const page = source('src/pages/features/myinbox/MyInboxPage.tsx')
    assert.match(page, /<PageSwitchMenu/)
    assert.match(page, /<PageRefreshTick\.Provider value=\{tick\}>/)
    assert.match(page, /visiting \? <VisitNotice \/> : page === 'chat' \? <InboxChat \/> : <AlertsView \/>/)
    // the chat view is the live one only where App Control gives it (tests/spa/chat-live.test.tsx); today's otherwise
    assert.match(page, /chatKindOf\(mode, refused\) === 'live' \? <ChatLiveView mode=\{mode\} \/> : <ChatPage embedded \/>/)
    assert.ok(draw(<VisitNotice />).includes(VISIT_SENTENCE.replace(/'/g, '&#x27;')))
    assert.equal(typeof MyInboxPage, 'function')
  })

  it('Calendar Builder\'s Refresh is the page Refresh under its old names', () => {
    assert.equal(BuilderRefreshTick, PageRefreshTick)
    assert.equal(useBuilderRefresh, usePageRefresh)
    assert.match(source('src/pages/features/calendarbuilder/builderRefresh.ts'), /from '@\/lib\/pageRefresh'/)
  })
})

describe('the model', () => {
  it('the door\'s address encodes the person; nothing filters rows by person here', () => {
    assert.equal(model.myInboxPath(''), '/erp-lanes/my-inbox')
    assert.equal(model.myInboxPath('u_bob-1'), '/erp-lanes/my-inbox?person=u_bob-1')
    assert.equal(model.myInboxPath('a b&c'), '/erp-lanes/my-inbox?person=a%20b%26c')
    assert.deepEqual(Object.keys(model).filter((n) => /person/i.test(n)), [])
  })

  it('a person refused as out of scope or as no such account is let go; any other refusal keeps it', () => {
    assert.equal(model.choiceAfter({ status: 'refused', reason: 'scope' }, 'u-bob'), '')
    assert.equal(model.choiceAfter({ status: 'refused', reason: 'person' }, 'u-bob'), '')
    assert.equal(model.choiceAfter({ status: 'refused', reason: 'badge' }, 'u-bob'), 'u-bob')
    assert.equal(model.choiceAfter({ status: 'ready', reason: '' }, 'u-bob'), 'u-bob')
  })

  it('the chat\'s item comes from the shell\'s own count, opens the conversation, and is never marked here', () => {
    assert.equal(model.chatAlert(0, null), null)
    const latest = { id: 'm9', at: '2026-09-27T14:30:00Z', from_user: 'u sam', from_name: 'Sam Staff', body: 'Can you cover?' }
    const one = model.chatAlert(1, latest)!
    assert.equal(one.type, 'messages')
    assert.equal(one.title, 'Sam Staff sent you a message')
    assert.equal(one.body, 'Can you cover?')
    assert.equal(one.link?.href, '/app/my-inbox/chat?with=u%20sam')
    assert.equal(model.markable(one), false)
    const many = model.chatAlert(3, latest)!
    assert.equal(many.title, '3 unread chat messages')
    assert.equal(many.body, 'Newest from Sam Staff: Can you cover?')
    const merged = model.withChat(view().items, one)
    assert.deepEqual(merged.map((i) => i.id), ['chat:unread', 'req:tor1:open', 'punch:s1:no_punch', 'srv-7'])
    assert.deepEqual(model.unreadKeys(merged), ['req:tor1:open', 'punch:s1:no_punch'])
    assert.deepEqual(model.readKeys(merged), ['srv-7'])
    assert.deepEqual(model.markKeys(merged, ['chat:unread', 'srv-7']), ['srv-7'])
  })

  it('a plain day is its own Ohio day, never a UTC midnight; an instant is the Ohio day it falls on', () => {
    assert.equal(model.alertDay('2026-09-26'), '2026-09-26')
    assert.equal(model.alertDay('2026-09-27T03:30:00Z'), '2026-09-26')
    assert.equal(model.alertDay(''), '')
    assert.equal(model.alertWhen('2026-09-26'), 'Sep 26')
    const now = new Date(Date.UTC(2026, 8, 27, 16, 0, 0))
    const rows = [
      item('a', 'requests', { at: '2026-09-27T13:00:00Z' }),
      item('b', 'punch', { at: '2026-09-26' }),
      item('c', 'hiring', { at: '2026-09-27T03:30:00Z' }),
      item('d', 'new_staff', { at: '2026-09-20' }),
      item('e', 'notices', { at: '' }),
    ]
    const groups = dayGroups(rows, (r) => model.alertDay(r.at), now)
    assert.deepEqual(groups.map((g) => [g.label, g.rows.map((r) => r.id)]),
      [['Today', ['a']], ['Yesterday', ['b', 'c']], ['Earlier', ['d', 'e']]])
  })

  it('tabs count what is listed, and a count of nothing is never shown bare', () => {
    const items = view().items
    assert.deepEqual(model.tabLabels(items).map((t) => t.label), ['All · 3', 'Unread · 2', 'Mentions'])
    const withOne = model.withChat(items, model.chatAlert(2, null))
    assert.deepEqual(model.tabLabels(withOne).map((t) => t.label), ['All · 4', 'Unread · 3', 'Mentions · 1'])
    assert.deepEqual(model.filterAlerts(withOne, 'mentions', '').map((i) => i.type), ['messages'])
    assert.deepEqual(model.filterAlerts(withOne, 'unread', 'punch').map((i) => i.id), ['punch:s1:no_punch'])
    assert.equal(model.typeOfChip('Missing punch'), 'punch')
    assert.equal(model.typeOfChip('Medication errors'), 'med_error')
    assert.deepEqual(model.TYPE_CHIPS.map((c) => c.label), ['Requests', 'Reimbursement', 'Missing punch', 'Scheduling',
      'Support Requests', 'Transportation', 'Hiring', 'New staff', 'New clients', 'Prospects', 'Company notices', 'Updates', 'Medication errors', 'Messages'])
    assert.equal(model.typeOfChip('Updates'), 'updates')
    assert.equal(model.typeOfChip('Scheduling'), 'scheduling')
    assert.deepEqual(model.lookOf('scheduling'), { icon: 'calendar-clock', tint: 'blue' })
    assert.equal(model.typeOfChip('Transportation'), 'transport')
    assert.deepEqual(model.lookOf('transport'), { icon: 'car-front', tint: 'blue' })
  })

  it('a mark drawn here: a cleared item leaves, a read one reads, and the unread count follows', () => {
    const v = view()
    const marked = model.applyMarks(v, new Map([['req:tor1:open', 'read'], ['srv-7', 'dismissed']] as const))
    assert.deepEqual(marked.items.map((i) => [i.id, i.read]), [['req:tor1:open', true], ['punch:s1:no_punch', false]])
    assert.equal(marked.unread, 1)
    assert.equal(model.applyMarks(v, new Map()), v)
  })

  it('each source says its state; the sentences of one that did not answer are drawn, never an empty source', () => {
    assert.deepEqual(model.headPill(head('requests', { count: 2 })), { text: 'Ready · 2', tone: 'good' })
    assert.deepEqual(model.headPill(head('punch', { state: 'unreadable', count: null })), { text: 'Could not be read', tone: 'danger' })
    assert.deepEqual(model.headPill(head('notices', { state: 'held', count: null })), { text: 'Held', tone: 'warning' })
    assert.deepEqual(model.headPill(head('hiring', { state: 'closed', count: null })), { text: 'Not open to you', tone: 'muted' })
    assert.equal(model.headPill(head('punch', { count: 1, gap: 'the clock was not read' })).tone, 'warning')
    const lines = model.headLines(head('requests', {
      count: 1, gap: 'one source could not be read', note: 'Concluded ones from the last 30 days',
      parts: [{ key: 'time_off', label: 'Time off', state: 'ready', why: '' },
        { key: 'hotline', label: 'Phone requests', state: 'unreadable', why: 'the lane did not answer' }],
    }))
    assert.deepEqual(lines.map((l) => [l.tone, l.text]), [
      ['warning', 'One source could not be read.'],
      ['muted', 'Concluded ones from the last 30 days.'],
      ['danger', 'Phone requests: The lane did not answer.'],
    ])
    assert.deepEqual(model.headLines(head('punch', { state: 'unreadable', why: 'the board is broken', count: null }))
      .map((l) => [l.tone, l.text]), [['danger', 'The board is broken.']])
  })

  it('"nothing" is earned only when every source landed; held, unread, untied or gapped sources withhold it', () => {
    const whole = view({ items: [] })
    assert.equal(model.emptyWords(whole, 'all', '', false), 'Nothing needs you right now.')
    assert.equal(model.emptyWords(whole, 'all', '', true), 'Nothing concerns this person right now.')
    const shut = view({ items: [], heads: heads({ hiring: { state: 'closed', count: null, why: 'Hiring is not open to you.' } }) })
    assert.equal(model.emptyWords(shut, 'all', '', false), 'Nothing needs you right now.', 'a shut app holds nothing for you')
    const withheld: Record<string, Partial<InboxHead>>[] = [
      { notices: { state: 'held', count: null, why: 'Company notices are held while test mode is on.' } },
      { punch: { state: 'unreadable', count: null, why: 'no board' } },
      { requests: { state: 'not_attributable', count: null, why: 'your name is shared' } },
      { punch: { gap: 'the clock was not read' } },
    ]
    for (const over of withheld) {
      const v = view({ items: [], heads: heads(over) })
      const words = model.emptyWords(v, 'all', '', false)
      assert.ok(!/^Nothing needs you/.test(words), JSON.stringify(over))
      assert.match(words, /from the sources that answered/)
    }
    assert.equal(model.emptyWords(whole, 'unread', '', false), 'No unread alerts — all caught up.')
    assert.match(model.emptyWords(whole, 'mentions', '', false), /@mentions in documents are not on the platform yet/)
    assert.equal(model.emptyWords(whole, 'all', 'punch', false), 'Nothing of this type right now.')
    const unreadPunch = view({ items: [], heads: heads({ punch: { state: 'unreadable', count: null } }) })
    assert.match(model.emptyWords(unreadPunch, 'all', 'punch', false), /from the sources that answered/)
    assert.equal(model.emptyWords(unreadPunch, 'all', 'hiring', false), 'Nothing of this type right now.')
  })

  it('the marks: hidden in a switched session, disabled on a chosen person, and each says why', () => {
    assert.deepEqual(model.marksMode(view(), false), { show: true, enabled: true, line: '' })
    assert.deepEqual(model.marksMode(view(), true), { show: false, enabled: false, line: model.KEPT_WHY_ACTING })
    const chosen = view({ marks: { readable: true, why: '', kept: false, kept_why: model.KEPT_WHY_CHOSEN } })
    assert.deepEqual(model.marksMode(chosen, false), { show: true, enabled: false, line: "Read marks are that person's; you are only looking." })
    assert.equal(model.KEPT_WHY_ACTING, 'Read marks are not kept in a switched session.')
    assert.equal(model.marksUnreadLine(view()), '')
    assert.equal(model.marksUnreadLine(view({ marks: { readable: false, why: 'the table could not be read', kept: true, kept_why: '' } })),
      'What you have read could not be read (the table could not be read), so every alert shows as unread.')
  })
})

describe('the Alerts screen', () => {
  it('draws the list by Ohio day, the unread pill, the marks, and no notification settings', () => {
    const chat = model.chatAlert(1, { id: 'm1', at: '2026-09-27T14:30:00Z', from_user: 'u-sam', from_name: 'Sam Staff', body: 'Hi' })
    const html = screen(view(), { chat })
    assert.match(html, /<h2[^>]*>Alerts<\/h2>/)
    assert.ok(html.includes('>3 unread<'), 'the relay\'s two and the chat\'s one')
    assert.ok(tagOf(html, 'mark-all') && !isDisabled(tagOf(html, 'mark-all')))
    assert.ok(!isDisabled(tagOf(html, 'select')) && !isDisabled(tagOf(html, 'clear-read')))
    assert.ok(html.includes('Time off — Waiting on the house manager') && html.includes('Sam Staff sent you a message'))
    assert.ok(html.includes('aria-label="Open in My Work"'))
    assert.ok(!html.includes('Notification settings') && !html.includes('id="my-inbox-person"'))
    assert.ok(html.includes('>All · 4<') && html.includes('>Mentions · 1<'))
  })

  it('the Sources card names every source with its state, the held notices and each thing not on the platform', () => {
    const v = view({ heads: heads({
      notices: { state: 'held', count: null, why: 'Company notices are held while test mode is on.' },
      punch: { state: 'unreadable', count: null, why: 'the punch board could not be read' },
      requests: { count: 1, as_of: '2026-09-27T14:00:00Z' },
    }) })
    const html = draw(<SourcesCard view={v} />)
    for (const label of Object.values(LABELS)) assert.ok(html.includes(`>${label}`), label)
    assert.match(html, /data-source="notices" data-state="held"/)
    assert.ok(html.includes('Company notices are held while test mode is on.'))
    assert.ok(html.includes('The punch board could not be read.') && html.includes('>Could not be read<'))
    assert.ok(html.includes('Not on the platform yet'))
    for (const h of NOT_ON_PLATFORM) assert.ok(html.includes(h.why), h.key)
    assert.ok(html.includes('as of Sep 27, 2026'))
    assert.ok(screen(v).includes('aria-label="Sources"'), 'the card is under the list')
  })

  it('an empty list is never drawn alone: the Sources card is under it, and a held source withholds "nothing"', () => {
    const v = view({ items: [], heads: heads({ notices: { state: 'held', count: null, why: 'Company notices are held while test mode is on.' } }) })
    const html = screen(v)
    assert.ok(!html.includes('Nothing needs you right now.'))
    assert.ok(html.includes('Nothing from the sources that answered') && html.includes('aria-label="Sources"'))
  })

  it('Settings › My Work hides the Sources card: the relay sends no source, and the list, its counts and a plain empty sentence stay', () => {
    const hid = { display: { hidden: { inbox_sources: true } }, heads: [] as InboxHead[] }
    const html = screen(view({ ...hid, whole: true }))
    assert.ok(!html.includes('aria-label="Sources"') && !html.includes('Not on the platform yet'))
    assert.ok(html.includes('Time off — Waiting on the house manager') && html.includes('>2 unread<'))
    assert.ok(html.includes('>All · 3<') && !html.includes('data-for-users'))
    const whole = screen(view({ ...hid, whole: true, items: [], unread: 0 }))
    assert.ok(whole.includes('Nothing needs you right now.') && !whole.includes('Sources below'))
    const partial = screen(view({ ...hid, whole: false, items: [], unread: 0 }))
    assert.ok(partial.includes(model.EMPTY_UNCHECKED) && !partial.includes('Sources below')
      && !partial.includes('Nothing needs you right now.') && !partial.includes('aria-label="Sources"'))
  })

  it('the master\'s own session keeps the card, with a line that everyone else is not shown it', () => {
    const shown = { hidden: { inbox_sources: false }, for_users: { inbox_sources: true }, readable: true, why: '' }
    const mass = view({ scope: { mode: 'mass', why: 'Signed in as the master account.', person: '', readonly: false, people: [] },
      display: shown })
    const html = screen(mass)
    assert.ok(html.includes('aria-label="Sources"') && html.includes('data-for-users'))
    assert.ok(html.includes('Hidden from everyone else by Settings › My Work: this Sources card. You see everything.'))
    const broken = view({ scope: { mode: 'mass', why: '', person: '', readonly: false, people: [] },
      display: { hidden: { inbox_sources: false }, for_users: { inbox_sources: false }, readable: false,
        why: 'the display settings could not be read (the tab could not be opened)' } })
    assert.equal(model.sourcesForUsersLine(broken),
      'The display settings could not be read (the tab could not be opened), so nothing is hidden from anyone.')
    assert.equal(model.sourcesForUsersLine(view({ scope: { mode: 'mass', why: '', person: '', readonly: false },
      display: { hidden: { inbox_sources: false }, for_users: { inbox_sources: false }, readable: true, why: '' } })), '')
    const own = view({ display: { hidden: { inbox_sources: false }, for_users: { inbox_sources: true }, readable: false, why: 'x' } })
    assert.equal(model.sourcesForUsersLine(own), '', 'an own session never draws the line, whatever arrives')
    assert.ok(!screen(own).includes('data-for-users'))
  })

  it('a relay that predates the switch hides nothing, and a hidden answer never points at the card', () => {
    assert.equal(model.sourcesHidden(view()), false)
    assert.equal(model.sourcesHidden(view({ display: { hidden: { inbox_sources: false } } })), false)
    assert.equal(model.sourcesHidden(null), false)
    const hid = (over: Partial<MyInboxView>) => view({ display: { hidden: { inbox_sources: true } }, heads: [], items: [], ...over })
    assert.equal(model.emptyWords(hid({ whole: true }), 'unread', '', false), 'No unread alerts — all caught up.')
    assert.equal(model.emptyWords(hid({ whole: true }), 'all', 'punch', false), 'Nothing of this type right now.')
    assert.equal(model.emptyWords(hid({ whole: true }), 'all', '', true), 'Nothing concerns this person right now.')
    for (const words of [model.emptyWords(hid({ whole: false }), 'all', '', false),
      model.emptyWords(hid({ whole: false }), 'unread', '', false), model.emptyWords(hid({}), 'all', 'punch', false)]) {
      assert.equal(words, model.EMPTY_UNCHECKED)
    }
    assert.match(model.emptyWords(hid({ whole: true }), 'mentions', '', false), /@mentions in documents are not on the platform yet/)
  })

  it('the master\'s chooser appears only on a mass answer; a chosen person\'s alerts are looked at, never marked', () => {
    const people = [{ uid: 'u-bob', label: 'Bob Bee', role: 'staff' }, { uid: 'u-cy', label: 'Cy Doe', role: 'manager' }]
    const mass = view({ scope: { mode: 'mass', why: 'Signed in as the master account: your own alerts, or any person\'s you choose, read-only.',
      person: '', readonly: false, people } })
    const own = screen(mass, { chooser: { people, people_why: '' } })
    assert.ok(own.includes('id="my-inbox-person"') && own.includes('>Your own alerts<') && own.includes('>Bob Bee · staff<'))
    const lookedAt = view({
      scope: { mode: 'mass', why: '', person: 'u-bob', readonly: true, people },
      subject: { name: 'Bob Bee', key_why: '' },
      marks: { readable: true, why: '', kept: false, kept_why: model.KEPT_WHY_CHOSEN },
    })
    const chat = model.chatAlert(2, null)
    const html = screen(lookedAt, { chooser: { people, people_why: '' }, person: 'u-bob', chat })
    assert.match(html, /<h2[^>]*>Alerts · Bob Bee<\/h2>/)
    assert.ok(isDisabled(tagOf(html, 'mark-all')))
    assert.ok(isDisabled(tagOf(html, 'select')))
    assert.ok(isDisabled(tagOf(html, 'clear-read')))
    assert.ok(html.includes('Read marks are that person&#x27;s; you are only looking.'))
    assert.ok(!html.includes('unread chat messages') && !/>Mentions( · \d+)?</.test(html), 'the chat is never a chosen person\'s')
    assert.ok(!html.includes('aria-label="Mark as read"') && !html.includes('aria-label="Clear"'))
    const noList = screen(mass, { chooser: { people: null, people_why: 'the accounts could not be read (OperationalError)' } })
    assert.ok(noList.includes('Nobody can be chosen: The accounts could not be read (OperationalError).'))
  })

  it('a switched session hides the marks and says why', () => {
    const v = view({ marks: { readable: true, why: '', kept: false, kept_why: model.KEPT_WHY_ACTING } })
    const html = screen(v, { acting: true })
    assert.equal(tagOf(html, 'mark-all'), '')
    assert.equal(tagOf(html, 'select'), '')
    assert.equal(tagOf(html, 'clear-read'), '')
    assert.ok(html.includes('Read marks are not kept in a switched session.'))
  })

  it('the Mentions filter says what it holds; a medication error report is a pointer and nothing more', () => {
    const html = screen(view({ items: [] }), { tab: 'mentions' })
    assert.ok(html.includes(model.MENTIONS_LINE))
    const mar = item('mar:0a1b2c3d4e', 'med_error', { title: 'A medication error report names you — Sep 20, 2026', body: '',
      at: '2026-09-20T13:00:00Z', flag: true, link: { href: '/app/ui-incidents/log', label: 'Open in UI Reports' } })
    const drawn = screen(view({ items: [mar] }))
    assert.ok(drawn.includes('A medication error report names you — Sep 20, 2026'))
    assert.match(drawn, /data-type="med_error"/)
  })

  it('a software update carries the completed icon in the success green; the Updates chip lists only updates', () => {
    assert.deepEqual(model.lookOf('updates'), { icon: 'circle-check', tint: 'green' })
    const upd = item('upd:2026-09-27:myinbox:27a477db', 'updates', {
      title: 'My Inbox is new', body: 'Alerts focused on the person · 27a477db', at: '2026-09-27' })
    const v = view({ items: [upd, ...view().items] })
    const html = screen(v)
    const rowOf = (h: string, id: string) => {
      const at = h.indexOf(`data-alert="${id}"`)
      const next = h.indexOf('data-alert="', at + 1)
      return at < 0 ? '' : h.slice(at, next < 0 ? undefined : next)
    }
    const row = rowOf(html, upd.id)
    assert.match(row, /data-type="updates"/)
    assert.ok(row.includes('My Inbox is new') && row.includes('Alerts focused on the person · 27a477db'))
    assert.match(row, /bg-tint-mint[\s\S]*<svg[^>]*lucide-circle-check[^>]*text-tint-fg-mint/, 'the completed icon, green')
    assert.ok(row.includes('>Sep 27<'), 'a plain day is its own Ohio day')
    assert.ok(!rowOf(html, 'req:tor1:open').includes('lucide-circle-check'), 'only updates carry it')
    const only = screen(v, { type: 'updates' })
    assert.deepEqual([...only.matchAll(/data-alert="([^"]+)"/g)].map((m) => m[1]), [upd.id])
    assert.ok(only.includes('Updates'))
    const none = screen(view(), { type: 'updates' })
    assert.ok(none.includes('Nothing of this type right now.'), 'a landed Software updates source earns "nothing"')
    const sources = draw(<SourcesCard view={view({ heads: heads({ updates: { count: 1, as_of: '2026-09-27T16:42:35Z',
      note: 'What went live on the platform, from the release notes.' } }) })} />)
    assert.match(sources, /data-source="updates" data-state="ready"/)
    assert.ok(sources.includes('>Software updates') && sources.includes('>Ready · 1<'))
    assert.ok(sources.includes('What went live on the platform, from the release notes.'))
  })

  it('a refusal keeps the relay\'s words; a failed first read says so rather than an empty inbox', () => {
    const refused = screen(null, { state: { ...MY_INBOX_IDLE, status: 'refused', reason: 'badge', error: 'My Inbox is not open to your badges.' } })
    assert.ok(refused.includes('My Inbox is not open here') && refused.includes('My Inbox is not open to your badges.'))
    const failed = screen(null, { state: { ...MY_INBOX_IDLE, status: 'failed', error: 'the relay answered 503' } })
    assert.ok(failed.includes('My Inbox could not be read: the relay answered 503') && !failed.includes('aria-label="Sources"'))
  })
})

describe('the read and the marks', () => {
  const realFetch = globalThis.fetch
  // the shell's chat ear wakes on every sign-in here; it is answered as a relay that has nothing for it
  const d = document as unknown as { querySelector?: unknown }
  let calls: { url: string; auth: string; method: string; body: string }[] = []
  let answer: (url: string, body: string) => Response = () => new Response(JSON.stringify({ status: 200, data: view() }))
  before(() => {
    d.querySelector = () => null
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      const body = typeof init?.body === 'string' ? init.body : ''
      const path = String(url)
      calls.push({ url: path, auth: headers.Authorization ?? '', method: String(init?.method ?? 'GET'), body })
      if (path.startsWith('/erp-lanes/my-inbox')) return answer(path, body)
      if (path.startsWith('/erp-lanes/notices')) return new Response(JSON.stringify({ status: 200, data: { notices: [], seq: 0, unread: 0 } }))
      return new Response(JSON.stringify({ status: 404, message: 'not here' }), { status: 404 })
    }) as typeof fetch
  })
  after(() => {
    globalThis.fetch = realFetch
    delete d.querySelector
  })
  afterEach(() => {
    calls = []
    forgetHeld()
    useAuthStore.setState({ user: null, token: null, beAnother: null } as never)
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
    useChatPresenceStore.setState({ unread: 0, latest: null })
  })
  const signIn = (id = 'u-ann', token = 'tok-ann', over: Record<string, unknown> = {}) =>
    useAuthStore.setState({ user: { id, name: 'Ann Roe', role: 'staff', types: [] }, token, ...over } as never)
  const inboxReads = () => calls.filter((c) => c.url.startsWith('/erp-lanes/my-inbox') && c.method === 'GET')

  it('reads its one door with the Bearer token; a person is encoded into the address', async () => {
    signIn()
    const h = mountHook((p: { person: string }) => useMyInbox(true, p.person), { person: '' })
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(inboxReads()[0].url, '/erp-lanes/my-inbox')
    assert.equal(inboxReads()[0].auth, 'Bearer tok-ann')
    h.unmount()
    calls = []
    const p = mountHook((q: { person: string }) => useMyInbox(true, q.person), { person: 'u bob' })
    await p.settle(() => p.current.state.status === 'ready')
    assert.equal(inboxReads()[0].url, '/erp-lanes/my-inbox?person=u%20bob')
    p.unmount()
  })

  it('a 403 is refused with the relay\'s reason and words; an answer without its alerts is a failure, not a list', async () => {
    signIn()
    answer = () => new Response(JSON.stringify({ status: 403, reason: 'badge', message: 'My Inbox is not open to your badges.' }))
    const h = mountHook(() => useMyInbox(true, ''), {})
    await h.settle(() => h.current.state.status === 'refused')
    assert.equal(h.current.state.reason, 'badge')
    assert.equal(h.current.state.error, 'My Inbox is not open to your badges.')
    assert.equal(h.current.view, null)
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: { scope: { mode: 'own' } } }))
    const g = mountHook(() => useMyInbox(true, ''), {})
    await g.settle(() => g.current.state.status === 'failed')
    assert.match(g.current.state.error, /without the alerts/)
    g.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a person the door refuses as out of scope is let go', async () => {
    signIn('u-boss', 'tok-boss')
    answer = (url) => url.includes('?person=')
      ? new Response(JSON.stringify({ status: 403, reason: 'scope', message: 'My Inbox shows only your own alerts.' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    let chosen = 'u-bob'
    const h = mountHook((p: { person: string }) => useMyInboxAlerts(p.person, (next) => { chosen = next }), { person: 'u-bob' })
    await h.settle(() => chosen === '')
    assert.equal(chosen, '')
    assert.ok(calls.some((c) => c.url === '/erp-lanes/my-inbox?person=u-bob'))
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('an open member visit reads nothing', async () => {
    signIn('u-boss', 'tok-boss')
    useMemberStore.setState({ currentMemberId: 'u-sam', memberName: 'Sam Staff', memberRole: 'staff', memberTypes: [] } as never)
    const h = mountHook(() => useMyInboxAlerts('', noop), {})
    await h.settle(() => false)
    assert.equal(h.current.visiting, true)
    assert.equal(inboxReads().length, 0)
    h.unmount()
  })

  it('a mark is sent for the session\'s own alerts only, drawn at once, and the chat\'s item never goes', async () => {
    signIn()
    const h = mountHook(() => useMyInbox(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    answer = (url) => url.endsWith('/read')
      ? new Response(JSON.stringify({ status: 200, data: { marked: 1, ignored: 0 } }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    let ok = false
    h.run(() => { void h.current.markRead(['req:tor1:open', 'chat:unread']).then((v) => { ok = v }) })
    await h.settle(() => ok)
    const sent = calls.filter((c) => c.url === '/erp-lanes/my-inbox/read')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].method, 'POST')
    assert.deepEqual(JSON.parse(sent[0].body), { keys: ['req:tor1:open'] })
    assert.equal(h.current.view?.items.find((i) => i.id === 'req:tor1:open')?.read, true)
    let cleared = false
    h.run(() => { void h.current.clear(['srv-7']).then((v) => { cleared = v }) })
    await h.settle(() => cleared)
    const last = calls.filter((c) => c.url === '/erp-lanes/my-inbox/read').pop()!
    assert.deepEqual(JSON.parse(last.body), { keys: ['srv-7'], dismiss: true })
    assert.ok(!h.current.view?.items.some((i) => i.id === 'srv-7'))
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('a refused mark is put back', async () => {
    signIn()
    const h = mountHook(() => useMyInbox(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    answer = (url) => url.endsWith('/read')
      ? new Response(JSON.stringify({ status: 502, reason: 'unreadable', message: 'Not marked (OperationalError).' }))
      : new Response(JSON.stringify({ status: 200, data: view() }))
    let done: boolean | null = null
    h.run(() => { void h.current.markRead(['punch:s1:no_punch']).then((v) => { done = v }) })
    await h.settle(() => done !== null)
    assert.equal(done, false)
    assert.equal(h.current.view?.items.find((i) => i.id === 'punch:s1:no_punch')?.read, false)
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
  })

  it('nothing is sent for a chosen person\'s alerts, nor in a switched session', async () => {
    signIn('u-boss', 'tok-boss')
    answer = () => new Response(JSON.stringify({ status: 200, data: view({
      scope: { mode: 'mass', why: '', person: 'u-bob', readonly: true, people: [] },
      marks: { readable: true, why: '', kept: false, kept_why: model.KEPT_WHY_CHOSEN } }) }))
    const h = mountHook(() => useMyInbox(true, 'u-bob'), {})
    await h.settle(() => h.current.state.status === 'ready')
    let sent: boolean | null = null
    h.run(() => { void h.current.markRead(['req:tor1:open']).then((v) => { sent = v }) })
    await h.settle(() => sent !== null)
    assert.equal(sent, false)
    h.unmount()
    answer = () => new Response(JSON.stringify({ status: 200, data: view() }))
    signIn('u-ann', 'tok-act', { beAnother: { real: { id: 'u-boss' }, acting: { id: 'u-ann' } } })
    const a = mountHook(() => useMyInbox(true, ''), {})
    await a.settle(() => a.current.state.status === 'ready')
    let acted: boolean | null = null
    a.run(() => { void a.current.markRead(['req:tor1:open']).then((v) => { acted = v }) })
    await a.settle(() => acted !== null)
    assert.equal(acted, false)
    assert.equal(calls.filter((c) => c.url.endsWith('/read')).length, 0)
    a.unmount()
  })

  it('a notice arriving on the stream reads the door again; no timer reads it', async () => {
    signIn()
    const h = mountHook(() => useMyInbox(true, ''), {})
    await h.settle(() => h.current.state.status === 'ready')
    const before = inboxReads().length
    h.run(() => useNotificationStore.setState((s) => ({ arrivalTick: s.arrivalTick + 1 })))
    await h.settle(() => inboxReads().length > before)
    assert.equal(inboxReads().length, before + 1)
    h.unmount()
    const hook = source('src/pages/features/myinbox/useMyInbox.ts')
    assert.doesNotMatch(hook, /setInterval|setTimeout/)
  })
})

describe('the chat, embedded', () => {
  afterEach(() => {
    useChatPresenceStore.setState({ live: false })
    useAuthStore.setState({ user: null, token: null, beAnother: null } as never)
  })

  it("the Chat app draws My Inbox's chat under its own header, never a redirect", () => {
    const route = source('src/pages/AppRoutePage.tsx')
    assert.match(route, /'chat\/messages': ChatAppPage,/)
    const app = source('src/pages/features/chat/ChatAppPage.tsx')
    assert.match(app, /: <InboxChat \/>/)
    assert.doesNotMatch(app, /Navigate/)
    assert.ok(draw(<ChatAppPage />, '/app/chat/messages').includes(CHAT_APP_SUBTITLE))
  })

  it('draws no header of its own embedded; the standalone Chat keeps its header', () => {
    const embedded = draw(<ChatPage embedded />, '/app/my-inbox/chat')
    const standalone = draw(<ChatPage />, '/app/chat/messages')
    assert.ok(standalone.includes('The people on the platform, and what they said.'))
    assert.ok(!embedded.includes('The people on the platform, and what they said.'))
    assert.ok(embedded.includes('Search people…') && embedded.includes('Pick somebody to write to'))
  })

  it('says when the stream is down, embedded only; a switched session writes nothing from it', () => {
    // the server renderer reads a store's first state: the stream not yet open
    assert.ok(draw(<ChatPage embedded />).includes(LIVE_OFF_LINE))
    assert.ok(!draw(<ChatPage />).includes(LIVE_OFF_LINE))
    const chat = source('src/pages/features/chat/ChatPage.tsx')
    assert.match(chat, /\{embedded && !live && \(/)
    assert.match(chat, /\{acting \? \(/)
    assert.equal(ACTING_COMPOSER_LINE, 'Messages are not sent in a switched session. Press Be Back to write as yourself.')
  })

  it('embedded starts no Apps Script timer; the standalone floor still ticks', () => {
    const real = globalThis.setInterval
    const realClear = globalThis.clearInterval
    let armed = 0
    let cleared = 0
    globalThis.setInterval = ((fn: () => void, ms?: number) => { armed++; return real(fn, ms) }) as typeof setInterval
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => { cleared++; realClear(id) }) as typeof clearInterval
    try {
      const off = mountHook(() => useFloorTick(false, noop, 2000), {})
      assert.equal(armed, 0)
      off.unmount()
      const on = mountHook(() => useFloorTick(true, noop, 2000), {})
      assert.ok(armed >= 1)
      on.unmount()
      assert.ok(cleared >= 1)
    } finally {
      globalThis.setInterval = real
      globalThis.clearInterval = realClear
    }
    const chat = source('src/pages/features/chat/ChatPage.tsx')
    assert.doesNotMatch(chat, /window\.setInterval/)
    assert.equal((chat.match(/useFloorTick\(!embedded,/g) ?? []).length, 2)
    assert.match(chat, /usePageRefresh\(/)
  })
})

describe('the chat, for a client and in a switched session', () => {
  const realFetch = globalThis.fetch
  const d = document as unknown as { querySelector?: unknown }
  let gas: { action: string; token: string; payload: Record<string, unknown>; member: unknown }[] = []
  const CLIENT = { id: 'u-cora', name: 'Cora', email: 'cora@example.org', role: 'client', types: ['CLIENT'], isMaster: false }
  const ACTING = {
    real: { id: 'u-boss', email: 'boss@example.org', display_name: 'Boss' },
    acting: { id: 'u-cora', email: 'cora@example.org', display_name: 'Cora', role: 'client', types: ['CLIENT'],
              until: new Date(Date.now() + 3_600_000).toISOString(), expires_in_ms: 3_600_000,
              local_until: Date.now() + 3_600_000 },
  }
  // the server renderer reads a store's first state, so a drawn screen is signed in there too
  const firstAuth = { ...useAuthStore.getInitialState() }
  const firstRules = { ...useBadgeAccessStore.getInitialState() }
  const asClient = (acting: boolean) => {
    const auth = { user: CLIENT, token: acting ? 'tok-child' : 'tok-cora', beAnother: acting ? ACTING : null, hydrated: true }
    const rules = { rules: { 'my-inbox': ['CLIENT'] }, tenantRules: {}, configRules: {} }
    useAuthStore.setState(auth as never)
    Object.assign(useAuthStore.getInitialState(), auth)
    useBadgeAccessStore.setState(rules)
    Object.assign(useBadgeAccessStore.getInitialState(), rules)
  }
  const writes = () => gas.filter((g) => g.action === 'chatSend' || g.action === 'chatReact')
  before(() => {
    d.querySelector = () => null
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? init.body : ''
      if (String(url) === '/gas' && raw.startsWith('body=')) {
        const env = JSON.parse(decodeURIComponent(raw.slice(5)))
        gas.push({ action: env.action, token: env.token, payload: env.payload ?? {}, member: env.member })
        const data = env.action === 'chatReact'
          ? { message_id: 'm1', reactions: { '👍': ['per-cora'] }, on: true, to_user: 'per-2' }
          : { id: 'msg_1', created_at: '2026-09-30T10:00:00Z', thread_key: 'per-2|per-cora', emailed: false }
        return new Response(JSON.stringify({ status: 200, data }))
      }
      return new Response(JSON.stringify({ status: 404, message: 'not here' }), { status: 404 })
    }) as typeof fetch
  })
  after(() => {
    globalThis.fetch = realFetch
    delete d.querySelector
  })
  afterEach(() => {
    gas = []
    Object.assign(useAuthStore.getInitialState(), firstAuth)
    Object.assign(useBadgeAccessStore.getInitialState(), firstRules)
    useAuthStore.setState({ user: null, token: null, beAnother: null } as never)
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} })
  })

  it('a real client opens its chat in My Inbox with its composer: today\'s chat until live chat names CLIENT', () => {
    asClient(false)
    const html = draw(<InboxChat />, '/app/my-inbox/chat?with=per-2')
    assert.ok(html.includes('Search people…'))
    assert.ok(html.includes('<textarea') && html.includes('aria-label="Send"') && html.includes('aria-label="Emoji"'))
    assert.ok(!html.includes(ACTING_COMPOSER_LINE) && !html.includes(LIVE_ACTING_LINE.replace(/'/g, '&#x27;')))
    assert.ok(!html.includes('Starting live chat'), 'today\'s chat, not the live view')
    assert.ok(draw(<InboxChat />).includes('Pick somebody to write to'))
    // App Control names CLIENT on live chat too: the live view, the same two panes
    const released = { rules: { 'my-inbox': ['CLIENT'], 'my-inbox.liveChat': ['CLIENT'] }, tenantRules: {}, configRules: {} }
    useBadgeAccessStore.setState(released)
    Object.assign(useBadgeAccessStore.getInitialState(), released)
    const live = draw(<InboxChat />, '/app/my-inbox/chat')
    assert.ok(live.includes('Starting live chat') && live.includes('Search people…') && live.includes('Pick somebody to write to'))
  })

  it('a real client\'s line and reaction go out as its own session, naming only the other end', async () => {
    asClient(false)
    await sendChatLine('per-2', 'hello there')
    await reactToLine('m1', '👍')
    assert.deepEqual(writes().map((g) => [g.action, g.token, g.payload]), [
      ['chatSend', 'tok-cora', { to_user: 'per-2', body: 'hello there' }],
      ['chatReact', 'tok-cora', { message_id: 'm1', emoji: '👍' }],
    ])
    assert.ok(writes().every((g) => g.member === undefined), 'never a visit, never another account')
  })

  it('a switched session draws the person\'s chat — its rail and its conversation — with the composer off', () => {
    asClient(true)
    const html = draw(<InboxChat />, '/app/my-inbox/chat?with=per-2')
    assert.ok(html.includes('Search people…'), 'the rail is drawn, not a line in its place')
    assert.ok(html.includes('data-composer-off') && html.includes(ACTING_COMPOSER_LINE))
    assert.ok(!html.includes('<textarea') && !html.includes('aria-label="Send"') && !html.includes('aria-label="Emoji"'))
    assert.ok(!html.includes(LIVE_ACTING_LINE.replace(/'/g, '&#x27;')))
    assert.ok(html.includes('No messages in this conversation yet.') && !html.includes('Say something'))
    assert.ok(draw(<InboxChat />).includes(ACTING_PICK_TITLE))
    // the standalone Chat app keeps the same rule
    assert.ok(draw(<ChatPage />, '/app/chat/messages?with=per-2').includes(ACTING_COMPOSER_LINE))
  })

  it('a switched session never sends nor reacts: refused before the relay, and the screen offers neither', async () => {
    asClient(true)
    await assert.rejects(sendChatLine('per-2', 'as them'), { message: ACTING_COMPOSER_LINE })
    await assert.rejects(reactToLine('m1', '👍'), { message: ACTING_COMPOSER_LINE })
    assert.equal(writes().length, 0)
    const chat = source('src/pages/features/chat/ChatPage.tsx')
    assert.match(chat, /if \(!body \|\| !active \|\| acting\) return/)
    assert.match(chat, /const react = async \(messageId: string, emoji: string\) => \{\s*if \(acting\) return/)
    assert.match(chat, /\{!m\.pending && !acting && \(/)
    assert.match(chat, /disabled=\{acting\}/)
    assert.match(chat, /await sendChatLine\(to, body\)/)
    assert.match(chat, /await reactToLine\(messageId, emoji\)/)
  })

  it('the rail and a conversation are asked as the session alone — whose circle it is, the server decides', () => {
    const chat = source('src/pages/features/chat/ChatPage.tsx')
    assert.match(chat, /gasAction<\{ threads: Thread\[\]; people: Person\[\]; unread: number \}>\('chatOverview', \{\}\)/)
    assert.match(chat, /gasAction<[^>]*>\('chatMessages', \{\s*with_user: withUser,\s*after: [^}]*\}\)/)
  })
})

describe('the shared alert row', () => {
  it('the Notification Center draws its rows through it, as before', () => {
    const page = source('src/pages/NotificationsPage.tsx')
    assert.match(page, /import \{ NotificationRow, dayGroups \} from '@\/components\/shared\/AlertRow'/)
    assert.doesNotMatch(page, /function NotificationRow/)
    const n: AppNotification = {
      id: 'srv-3', type: 'system', title: 'Call-off at Akron', body: 'Somebody called off', read: false,
      createdAt: '2026-09-20T12:00:00Z', priority: 'high', href: '/app/calendarbuilder/requests',
    } as AppNotification
    const html = draw(<NotificationRow n={n} selectMode={false} selected={false} onSelect={noop} onOpen={noop} onMarkRead={noop} onDelete={noop} />)
    assert.ok(html.includes('Call-off at Akron') && html.includes('Somebody called off'))
    assert.ok(html.includes('lucide-flag'), 'the flag of a high notice')
    assert.ok(html.includes('aria-label="Mark as read"') && html.includes('aria-label="Open"') && html.includes('aria-label="Delete"'))
    const read = draw(<NotificationRow n={{ ...n, read: true, href: undefined, priority: 'normal' } as AppNotification}
      selectMode={false} selected={false} onSelect={noop} onOpen={noop} onMarkRead={noop} onDelete={noop} />)
    assert.ok(!read.includes('aria-label="Mark as read"') && !read.includes('aria-label="Open"') && read.includes('aria-label="Delete"'))
    assert.ok(!read.includes('lucide-flag'))
  })

  it('a row offers only what its caller hands it', () => {
    const html = draw(<AlertRow icon="clock" tint="amber" title="No punch" body="" when="Sep 26" read={false} flag={false}
      canOpen={false} selectMode={false} selected={false} onSelect={noop} onOpen={noop} />)
    assert.ok(html.includes('No punch') && html.includes('Sep 26'))
    assert.ok(!html.includes('aria-label="Mark as read"') && !html.includes('aria-label="Delete"') && !html.includes('aria-label="Open"'))
  })
})
