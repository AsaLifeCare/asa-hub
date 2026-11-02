/**
 * MY WORK, MY CALENDAR, MY INBOX AND MY PROFILE FOR A CLIENT, AN SSA OR A FAMILY MEMBER — the four My apps for every
 * account.
 *
 * A client-role login reaches the four through App Control alone, and only when a row names CLIENT: the relay's doors
 * contain the role, and lib/badgeAccess draws no tile the doors would refuse — for these four ids only. The operator's
 * FIX BADGES sheet (10-30) names two columns beside the client's, and there is no GUARDIAN badge (an old GUARDIAN cell
 * is worn as FAMILY): SSA, the person the client records name as guardian — on a client-role account linked to its one
 * ward, or on role staff — and FAMILY, the person they name as SSA, on role staff. Each is opened by its own badge
 * alone, never by its role word. Each screen then draws the backend's myFamily answer in its own words: the client's
 * own week and house manager, what the account filed, and in My Inbox the staff new to its house, the company notices
 * there and its chat alone; an SSA's or a family member's reads the client's name. No time off request and no action
 * is drawn; the only staff shown are those on shift at its own house (my-family-week.test.tsx). The staff screens are
 * untouched.
 */
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { isAllowedWith } from '@/lib/appAccess'
import { SHELL_HIDDEN, SHELL_SHOWN, primeShellHides } from '@/lib/myWorkHides'
import { isManifestVisible, visibleManifests } from '@/lib/audience'
import { RELAY_CONTAINED_APPS, badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { pageGateAllows } from '@/lib/pageGate'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { appManifests } from '@/registry/apps'
import { myWorkManifests } from '@/registry/apps-mywork'
import { myCalendarManifests } from '@/registry/apps-mycalendar'
import { myInboxManifests } from '@/registry/apps-myinbox'
import { myProfileManifests, MY_PROFILE_PAGES } from '@/registry/apps-myprofile'
import {
  familyIdle, familyTitle, isFamily, sourceLine, viewerKind, whose,
  type FamilyCalendar, type FamilySource, type FamilyState, type FamilyWork,
} from '@/pages/features/family/myFamily'
import { FamilyCalendarPage, FamilyWeekScreen } from '@/pages/features/mycalendar/FamilyWeek'
import MyCalendarPage from '@/pages/features/mycalendar/MyCalendarPage'
import { FamilyWorkPage, FamilyWorkScreen, familyWorkFigures, sourceTitle } from '@/pages/features/mywork/FamilyWork'
import MyWorkPage from '@/pages/features/mywork/MyWorkPage'
import { FAMILY_CHIPS, MESSAGES, TYPE_CHIPS, chipsOf, lookOf, typeOfChip, type MyInboxView } from '@/pages/features/myinbox/myInboxModel'
import { CLIENT_CHAT_SUBTITLE, MyInboxHeader, subtitleOf } from '@/pages/features/myinbox/MyInboxPage'
import { AlertsScreen } from '@/pages/features/myinbox/AlertsView'
import { MY_INBOX_IDLE, type MyInboxState } from '@/pages/features/myinbox/useMyInbox'
import { DetailsCard, ProfileNav } from '@/pages/features/myprofile/MyProfilePage'
import { guardianTitle, isGuardianView, type Field, type MyProfileView } from '@/pages/features/myprofile/myProfileModel'
import { mountHook } from './react-host'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: React.ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}
const MY_APPS = [myWorkManifests[0], myCalendarManifests[0], myInboxManifests[0], myProfileManifests[0]]

const JANE = { id: 'u-jane', name: 'Jane Doe', email: 'jane@example.invalid', role: 'client', types: ['CLIENT'], isMaster: false }
// the guardian a client record names, on a client-role account linked to that one ward: the FIX BADGES sheet's SSA
const MARY = { id: 'u-mary', name: 'Mary Doe', email: 'mary@example.invalid', role: 'client', types: ['SSA'], isMaster: false }
// the same column on role staff, no client linked (a professional guardian of several clients)
const DENA = { id: 'u-dena', name: 'Dena Hall', email: 'dena@example.invalid', role: 'staff', types: ['SSA'], isMaster: false }
// the SSA a client record names, on an external staff-role account with no client linked: the sheet's FAMILY
const FRAN = { id: 'u-fran', name: 'Fran Roe', email: 'fran@example.invalid', role: 'staff', types: ['FAMILY'], isMaster: false }
// a FAMILY account whose cell was written before 10-30 says GUARDIAN (scope.BADGE_RENAMED)
const OLGA = { id: 'u-olga', name: 'Olga Roe', email: 'olga@example.invalid', role: 'staff', types: ['GUARDIAN'], isMaster: false }
const ANN = { id: 'u-ann', name: 'Ann Roe', email: 'ann@example.invalid', role: 'staff', types: ['STAFF'], isMaster: false }
const rules = (r: Record<string, string[]>) => useBadgeAccessStore.setState({ rules: r, tenantRules: {}, configRules: {} })
const signIn = (user: unknown) => useAuthStore.setState({ user } as never)

const src = (key: string, state: FamilySource['state'], over: Partial<FamilySource> = {}): FamilySource =>
  ({ key, label: key, state, why: '', count: state === 'ok' || state === 'empty' ? 0 : null, ...over })
const ready = <T,>(data: T): FamilyState<T> => ({ ...familyIdle<T>(), status: 'ready', data, readAt: Date.parse('2026-09-28T13:00:00Z') })

function week(over: Partial<FamilyCalendar> = {}): FamilyCalendar {
  return {
    family: true, part: 'calendar', viewer: 'client', linked: true, ward: { name: 'Jane Doe' }, why: '',
    today: '2026-09-29', read_at: '2026-09-29T13:00:00Z',
    week: { from: '2026-09-28', to: '2026-10-04', prev: '2026-09-21', next: '2026-10-05', this: '2026-09-28' },
    appointments: {
      rows: [{ day: '2026-09-30', title: 'Dentist', doctor: 'Dr Ada', time: '10:00 AM', place: '12 Main St', status: 'Scheduled' }],
      next: { day: '2026-10-09', title: 'Eye doctor', doctor: '', time: '', place: '', status: '' },
      undated: 1, source: src('appointments', 'ok', { count: 1 }),
    },
    manager: { rows: [{ name: 'Mary Manager', phone: '3305550100' }], source: src('manager', 'ok', { count: 1 }) },
    ...over,
  }
}

function work(over: Partial<FamilyWork> = {}): FamilyWork {
  return {
    family: true, part: 'work', viewer: 'client', linked: true, ward: { name: 'Jane Doe' }, why: '',
    today: '2026-09-29', read_at: '2026-09-29T13:00:00Z',
    sources: [src('suggestions', 'ok', { label: 'Your suggestions', count: 1 }),
      src('tasks', 'not_applicable', { label: 'Your task cards', why: 'This is not open to this account in App Control.' }),
      src('sheet_tasks', 'empty', { label: 'Your sheet task cards' }),
      src('repairs', 'ok', { label: 'House repairs', count: 1 })],
    rows: [
      { id: 'sug:SUG_1', source: 'suggestions', title: 'More walks, please', status: 'Sent', at: '2026-09-25' },
      { id: 'rep:0a1b2c3d4e', source: 'repairs', title: 'A repair at the house', status: 'Open', at: '2026-09-26' },
    ],
    actions: { state: 'not_applicable', why: 'Actions are asked of staff; nothing is asked of this account here.' },
    ...over,
  }
}

describe('the four My apps reach a client-role login through App Control alone', () => {
  before(() => {
    useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
    useWorldStore.setState({ currentWorldId: '' })
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  after(() => {
    rules({})
    signIn(null)
  })

  it('each names the client role in its audience and keeps a staff person focus; the trainee and interviewer stay out', () => {
    for (const app of MY_APPS) {
      assert.ok(app.audience?.includes('client'), app.id)
      assert.deepEqual(app.focusAudience, ['staff'], app.id)
      assert.equal(isManifestVisible(app, { role: 'client' }), true, app.id)
      for (const role of ['admin', 'manager', 'staff'] as const) assert.equal(isManifestVisible(app, { role }), true, app.id)
      assert.equal(isManifestVisible(app, { role: 'onboarding' }), false, app.id)
      assert.equal(isManifestVisible(app, { role: 'interviewer' }), false, app.id)
      assert.equal(isManifestVisible(app, { role: 'staff', focus: { type: 'client', id: 'x', name: 'X' } }), false, app.id)
    }
    assert.deepEqual([...RELAY_CONTAINED_APPS].sort(), ['my-calendar', 'my-inbox', 'my-profile', 'my-work'])
  })

  it('a row naming SSA and FAMILY but not CLIENT draws no tile for a client — the doors would refuse it', () => {
    const rule = ['SSA', 'FAMILY', 'STAFF']
    for (const id of RELAY_CONTAINED_APPS) {
      assert.equal(badgeAllowsApp(id, JANE, { [id]: rule }), false, `${id}: client`)
      // nor, on a row naming neither CLIENT nor its own badge, for an SSA on its ward's client-role account
      assert.equal(badgeAllowsApp(id, MARY, { [id]: ['FAMILY', 'STAFF'] }), false, `${id}: SSA on a client role`)
      assert.equal(badgeAllowsApp(id, ANN, { [id]: rule }), true, `${id}: staff unchanged`)
    }
  })

  it('a row naming CLIENT and SSA opens a client and an SSA on its ward\'s account; FAMILY a family member; no row stays the master\'s', () => {
    for (const id of RELAY_CONTAINED_APPS) {
      assert.equal(badgeAllowsApp(id, MARY, { [id]: ['CLIENT', 'SSA', 'FAMILY', 'STAFF'] }), true, id)
      assert.equal(badgeAllowsApp(id, JANE, { [id]: ['CLIENT'] }), true, id)
      assert.equal(badgeAllowsApp(id, DENA, { [id]: ['SSA'] }), true, `${id}: SSA on role staff`)
      assert.equal(badgeAllowsApp(id, FRAN, { [id]: ['FAMILY'] }), true, `${id}: family`)
      assert.equal(badgeAllowsApp(id, OLGA, { [id]: ['FAMILY'] }), true, `${id}: an old GUARDIAN cell`)
      assert.equal(badgeAllowsApp(id, JANE, {}), false, id)
      assert.equal(badgeAllowsApp(id, { ...MARY, isMaster: true }, {}), true, id)
    }
  })

  it('an SSA\'s or a family member\'s role word never counts: CLIENT or STAFF alone opens them nothing', () => {
    for (const id of RELAY_CONTAINED_APPS) {
      assert.equal(badgeAllowsApp(id, MARY, { [id]: ['CLIENT', 'STAFF'] }), false, `${id}: SSA on a client role`)
      for (const who of [DENA, FRAN, OLGA]) {
        assert.equal(badgeAllowsApp(id, who, { [id]: ['CLIENT', 'STAFF'] }), false, `${id}: ${who.name}`)
      }
      // the two columns are their own: an SSA is never opened by FAMILY, nor a family member by SSA
      assert.equal(badgeAllowsApp(id, DENA, { [id]: ['FAMILY'] }), false, `${id}: SSA by FAMILY`)
      assert.equal(badgeAllowsApp(id, FRAN, { [id]: ['SSA'] }), false, `${id}: family by SSA`)
    }
  })

  it('the trainee and the interviewer are held the same way on the four, by their own word', () => {
    const trainee = { role: 'onboarding', types: ['ONBOARDING'], isMaster: false }
    assert.equal(badgeAllowsApp('my-work', trainee, { 'my-work': ['STAFF', 'CLIENT'] }), false)
    assert.equal(badgeAllowsApp('my-work', trainee, { 'my-work': ['ONBOARDING'] }), true)
  })

  it('every other app keeps its own law: Forms, Finance and Travel released to SSA or FAMILY alone still open to its wearer', () => {
    for (const id of ['forms', 'finance', 'travel', 'dr-appointments']) {
      // no CLIENT on the row: an SSA on its ward's client-role account is not contained here
      assert.equal(badgeAllowsApp(id, MARY, { [id]: ['SSA'] }), true, `${id}: SSA on a client role`)
      assert.equal(badgeAllowsApp(id, DENA, { [id]: ['SSA'] }), true, `${id}: SSA on role staff`)
      assert.equal(badgeAllowsApp(id, FRAN, { [id]: ['FAMILY'] }), true, `${id}: family`)
      assert.equal(badgeAllowsApp(id, OLGA, { [id]: ['FAMILY'] }), true, `${id}: an old GUARDIAN cell`)
      // and the role word never stands in for the badge
      assert.equal(badgeAllowsApp(id, MARY, { [id]: ['CLIENT'] }), false, `${id}: SSA by CLIENT`)
      assert.equal(badgeAllowsApp(id, FRAN, { [id]: ['STAFF'] }), false, `${id}: family by STAFF`)
    }
  })

  it('the one checker draws the tile for a client only with the CLIENT row', () => {
    signIn(JANE)
    rules({ 'my-work': ['CLIENT', 'STAFF'], 'my-calendar': ['SSA', 'FAMILY', 'STAFF'] })
    assert.equal(isAllowedWith(appManifests, 'client', 'my-work'), true)
    assert.equal(isAllowedWith(appManifests, 'client', 'my-calendar'), false)
    const tiles = visibleManifests(appManifests, { role: 'client' }, (id) => isAllowedWith(appManifests, 'client', id))
    assert.ok(tiles.some((a) => a.id === 'my-work'))
    assert.ok(!tiles.some((a) => a.id === 'my-calendar'))
  })

  it('My Profile\'s Requirements and Docs are gated from a client, an SSA or a family member, and the route guard says so', () => {
    assert.deepEqual(MY_PROFILE_PAGES.map((p) => [p.id, p.gate ?? '']),
      [['details', ''], ['requirements', 'no-client'], ['docs', 'no-client']])
    assert.deepEqual(myProfileManifests[0].pages.map((p) => p.gate ?? ''), ['', 'no-client', 'no-client'])
    assert.equal(pageGateAllows('no-client', JANE), false)
    // whatever its role says: an SSA or a FAMILY is refused as a client is
    for (const who of [MARY, DENA, FRAN, OLGA]) assert.equal(pageGateAllows('no-client', who), false, who.name)
    assert.equal(pageGateAllows('no-client', ANN), true)
    for (const [who, role, badge] of [[MARY, 'client', 'SSA'], [FRAN, 'staff', 'FAMILY']] as const) {
      signIn(who)
      rules({ 'my-profile': ['CLIENT', badge] })
      assert.equal(isAllowedWith(appManifests, role, 'my-profile', 'details'), true, `${who.name}: details`)
      assert.equal(isAllowedWith(appManifests, role, 'my-profile', 'requirements'), false, `${who.name}: requirements`)
      assert.equal(isAllowedWith(appManifests, role, 'my-profile', 'docs'), false, `${who.name}: docs`)
    }
  })
})

describe('the wording follows the reader, never the scope', () => {
  it('viewerKind reads the answer first, then SSA or FAMILY on a client-role account', () => {
    assert.equal(viewerKind({ viewer: 'guardian' }, ANN), 'guardian')
    assert.equal(viewerKind({ viewer: 'client' }, MARY), 'client')
    assert.equal(viewerKind(null, MARY), 'guardian')
    assert.equal(viewerKind(null, { role: 'client', types: ['FAMILY'] }), 'guardian')
    // a cell written before 10-30 says GUARDIAN, and reads FAMILY
    assert.equal(viewerKind(null, { role: 'client', types: ['GUARDIAN'] }), 'guardian')
    assert.equal(viewerKind(null, JANE), 'client')
    assert.equal(viewerKind(null, FRAN), 'client')
    assert.equal(viewerKind(null, DENA), 'client')
  })

  it('"Your" for a client, the first name for a guardian, and a plain word when no record gave one', () => {
    assert.equal(whose('client', 'Jane Doe'), 'Your')
    assert.equal(whose('guardian', 'Jane Doe'), 'Jane’s')
    assert.equal(whose('guardian', ''), 'Your family member’s')
    assert.equal(familyTitle('client', 'Jane Doe', 'My Week', 'week'), 'My Week')
    assert.equal(familyTitle('guardian', 'Jane Doe', 'My Week', 'week'), 'Jane’s week')
  })

  it('a source says why it holds nothing, and a staff answer is never taken for the family read', () => {
    assert.equal(sourceLine(src('x', 'unreadable', { why: 'The hotline calendar could not be read' })),
      'The hotline calendar could not be read.')
    assert.equal(sourceLine(src('x', 'not_applicable')), 'Not open to this account.')
    assert.equal(sourceLine(null), 'Could not be read.')
    assert.equal(isFamily({ family: true }), true)
    assert.equal(isFamily({ scope: { mode: 'own' } }), false)
  })
})

describe('My Calendar for a client or a guardian', () => {
  afterEach(() => signIn(null))

  it('a client reads "My Week": its own appointments on their days, the next one after, and the house manager', () => {
    const html = draw(<FamilyWeekScreen state={ready(week())} onWeek={noop} onRetry={noop} />)
    assert.match(html, />My Week</)
    assert.match(html, /data-day="2026-09-30"[\s\S]*?Dentist/)
    assert.match(html, /Dr Ada · 12 Main St/)
    assert.match(html, /Next appointment after this week: Eye doctor on Oct 9, 2026\./)
    assert.match(html, /One appointment on file has no date yet, so it is not placed on a day\./)
    assert.match(html, /data-manager=""[^>]*>Mary Manager/)
    assert.match(html, /href="tel:[^"]*3305550100"/)
  })

  it('draws no time off request and no staff-only mark', () => {
    const html = draw(<FamilyWeekScreen state={ready(week())} onWeek={noop} onRetry={noop} />)
    for (const staffOnly of ['Time off', 'Vacation', 'Request time off', 'As written', 'Also on', 'Called off', 'Covered']) {
      assert.doesNotMatch(html, new RegExp(staffOnly, 'i'), staffOnly)
    }
  })

  it('a guardian reads the client\'s week in the client\'s name', () => {
    const html = draw(<FamilyWeekScreen state={ready(week({ viewer: 'guardian' }))} onWeek={noop} onRetry={noop} />)
    assert.match(html, />Jane’s week</)
    assert.match(html, /data-appointment=""[\s\S]*?Dentist/)
    assert.doesNotMatch(html, />My Week</)
  })

  it('a source that could not be read says so, and one shut to the account says that — never "no appointment"', () => {
    const shut = week({
      appointments: { rows: [], next: null, undated: 0, source: src('appointments', 'not_applicable', { why: 'This is not open to this account in App Control.' }) },
      manager: { rows: [], source: src('manager', 'unreadable', { why: 'The hotline calendar could not be read (down).' }) },
    })
    const html = draw(<FamilyWeekScreen state={ready(shut)} onWeek={noop} onRetry={noop} />)
    assert.match(html, /This is not open to this account in App Control\./)
    assert.match(html, /The hotline calendar could not be read \(down\)\./)
    assert.doesNotMatch(html, /No appointment/)
  })

  it('an account not linked to anybody is the worded card, never an empty week', () => {
    const html = draw(<FamilyWeekScreen state={ready(week({ linked: false, why: 'Not linked.', appointments: undefined, week: undefined }))}
      onWeek={noop} onRetry={noop} />)
    assert.match(html, /data-unlinked=""/)
    assert.match(html, /isn’t linked to a family member yet/)
    assert.doesNotMatch(html, /data-day=/)
  })

  it('a refusal keeps the relay\'s words', () => {
    const html = draw(<FamilyWeekScreen state={{ ...familyIdle<FamilyCalendar>(), status: 'refused', error: 'My Calendar is not open to client accounts unless App Access names that role.' }}
      onWeek={noop} onRetry={noop} />)
    assert.match(html, /not open to client accounts unless App Access names that role/)
  })

  it('the page draws the family week for a client-role login and the staff calendar for staff', () => {
    // mounted by the real client renderer: a server render reads a store's first state, never the signed-in one
    signIn(MARY)
    const client = mountHook((_: null) => MyCalendarPage(), null)
    assert.equal(client.current.type, FamilyCalendarPage)
    client.unmount()
    signIn(ANN)
    const staff = mountHook((_: null) => MyCalendarPage(), null)
    assert.notEqual(staff.current.type, FamilyCalendarPage)
    assert.equal(typeof staff.current.type, 'function')
    staff.unmount()
  })
})

describe('My Work for a client or a guardian', () => {
  afterEach(() => signIn(null))

  it('what the account filed, each source with its status and day — and no actions card', () => {
    const html = draw(<FamilyWorkScreen state={ready(work())} opens={() => true} onRetry={noop} />)
    assert.match(html, /data-row="sug:SUG_1"[\s\S]*?More walks, please[\s\S]*?Sent/)
    assert.match(html, /data-row="rep:0a1b2c3d4e"[\s\S]*?Open/)
    assert.match(html, /This is not open to this account in App Control\./)
    assert.doesNotMatch(html, /Actions &amp; Requests|Open actions|Overdue|Upload asset/)
  })

  it('the header counts only its open requests and the sources that could not be read', () => {
    const figures = familyWorkFigures(work())
    assert.deepEqual(figures.map((f) => [f.label, f.value]), [['Open requests', 1], ['Sources unread', 0]])
    const blind = familyWorkFigures(work({ sources: [src('repairs', 'unreadable', { label: 'House repairs' })] }))
    assert.deepEqual(blind.map((f) => f.value), [null, 1])
  })

  it('a row\'s app is a link only while it is open to the account', () => {
    const shut = draw(<FamilyWorkScreen state={ready(work())} opens={() => false} onRetry={noop} />)
    assert.doesNotMatch(shut, /Open in House Repair/)
    assert.match(shut, /Kept in House Repair\./)
    const open = draw(<FamilyWorkScreen state={ready(work())} opens={(id) => id === 'house-repair'} onRetry={noop} />)
    assert.match(open, /href="\/app\/house-repair\/orders"[^>]*>Open in House Repair/)
  })

  it('a guardian reads the repairs at the client\'s house', () => {
    assert.equal(sourceTitle(src('repairs', 'ok', { label: 'House repairs' }), 'guardian', 'Jane Doe'), 'Repairs at Jane’s house')
    assert.equal(sourceTitle(src('repairs', 'ok', { label: 'House repairs' }), 'client', 'Jane Doe'), 'Repairs at your house')
    assert.equal(sourceTitle(src('repairs', 'ok', { label: 'House repairs' }), 'guardian', ''), 'Repairs at your family member’s house')
  })

  it('an account not linked to anybody is the worded card', () => {
    const html = draw(<FamilyWorkScreen state={ready(work({ linked: false, sources: undefined, rows: undefined }))} opens={() => true} onRetry={noop} />)
    assert.match(html, /data-unlinked=""/)
  })

  it('the page draws the family board for a client-role login and the staff board for staff', () => {
    signIn(JANE)
    const client = mountHook((_: null) => MyWorkPage(), null)
    assert.equal(client.current.type, FamilyWorkPage)
    client.unmount()
    signIn(ANN)
    const staff = mountHook((_: null) => MyWorkPage(), null)
    assert.notEqual(staff.current.type, FamilyWorkPage)
    assert.equal(typeof staff.current.type, 'function')
    staff.unmount()
  })
})

describe('My Inbox for a client or a guardian', () => {
  const head = (key: string, over: Partial<MyInboxView['heads'][number]> = {}): MyInboxView['heads'][number] => ({
    key, label: key === 'new_staff' ? 'New staff' : 'Company notices', state: 'ready', why: '', as_of: '', count: 0,
    note: '', gap: '', ...over,
  })
  const heads = [head('new_staff'), head('notices')]
  const famView = (over: Partial<MyInboxView> = {}): MyInboxView => ({
    scope: { mode: 'own', why: '', person: '', readonly: false },
    subject: { name: 'Jane Doe', key_why: '' }, heads, capped: '', read_at: '2026-09-29T13:00:00Z',
    marks: { readable: true, why: '', kept: true, kept_why: '' },
    items: [
      { id: 'fam:staff:0a1b2c3d4e', type: 'new_staff', title: 'New staff at Jane Doe’s house: Nia New', body: '',
        at: '2026-09-27', flag: false, link: { href: '/app/staff-profiles/profile?staff=nianew', label: 'Open in Staff' },
        read: false },
      { id: 'srv-41', type: 'notices', title: 'Ann Roe takes the shift at JH', body: 'Sat 9/26 · 8A-4P',
        at: '2026-09-25T13:01:00Z', flag: false, link: null, read: true },
      { id: 'hiring_count:abc', type: 'hiring', title: '12 candidates in the hiring process', body: '',
        at: '2026-09-28', flag: false, link: null, read: false },
    ],
    unread: 2, family: true, viewer: 'guardian', ward: { name: 'Jane Doe' }, linked: true, why: '', ...over,
  })
  const screen = (v: MyInboxView, state: MyInboxState = { ...MY_INBOX_IDLE, status: 'ready', data: v, readAt: 1 }) =>
    draw(<AlertsScreen state={state} view={v} chat={null} chooser={null} person="" acting={false}
      onPerson={noop} onOpen={noop} onMarkRead={noop} onClear={noop} onRetry={noop} />)

  it('the Type filter offers a client New staff, Company notices and Messages alone; a staff answer keeps the whole list', () => {
    assert.deepEqual(FAMILY_CHIPS.map((c) => c.label), ['New staff', 'Company notices', 'Messages'])
    assert.deepEqual(chipsOf(famView()).map((c) => c.type), ['new_staff', 'notices', MESSAGES])
    assert.deepEqual(chipsOf(famView({ heads: [heads[1]] })).map((c) => c.type), ['notices', MESSAGES])
    // a head of another type is never offered, whatever an answer carries
    assert.deepEqual(chipsOf(famView({ heads: [...heads, head('hiring'), head('updates')] })).map((c) => c.type),
      ['new_staff', 'notices', MESSAGES])
    assert.deepEqual(chipsOf(famView({ heads: [] })), FAMILY_CHIPS)
    assert.equal(chipsOf({ heads: [] }), TYPE_CHIPS)
    assert.equal(chipsOf(null), TYPE_CHIPS)
    assert.ok(TYPE_CHIPS.length > FAMILY_CHIPS.length)
    assert.equal(typeOfChip('New staff'), 'new_staff')
    assert.equal(typeOfChip('Company notices'), 'notices')
    assert.equal(typeOfChip('Hiring'), 'hiring')
    for (const t of ['new_staff', 'notices', MESSAGES]) assert.notEqual(lookOf(t).icon, 'info', t)
  })

  it('the list draws its new staff and its notices, and never an item of another type', () => {
    const html = screen(famView())
    assert.match(html, /data-alert="fam:staff:0a1b2c3d4e"/)
    assert.match(html, /New staff at Jane Doe’s house: Nia New/)
    assert.match(html, /data-alert="srv-41"/)
    assert.match(html, /Ann Roe takes the shift at JH/)
    assert.doesNotMatch(html, /hiring_count|candidates in the hiring process/)
    assert.match(html, /data-unread-pill="[^"]*"[^>]*>1 unread/)
    for (const staffOnly of ['Missing punch', 'Prospects', 'Reimbursement', 'Hiring', 'Medication errors', 'Requests']) {
      assert.doesNotMatch(html, new RegExp(staffOnly), staffOnly)
    }
  })

  it('a backend that could not answer draws the list and its Sources, never the red could-not-be-read line', () => {
    const why = 'the backend is still reading this account’s alerts; they are listed on the next read'
    const v = famView({ items: [], unread: 0, linked: null,
      heads: [head('new_staff', { state: 'unreadable', why, count: null }), head('notices', { state: 'unreadable', why, count: null })] })
    const html = screen(v)
    assert.doesNotMatch(html, /My Inbox could not be read/)
    assert.doesNotMatch(html, /role="alert"/)
    assert.match(html, /data-empty="[^"]*"/)
    assert.match(html, /Nothing from the sources that answered/)
    assert.match(html, /data-source="new_staff" data-state="unreadable"/)
    assert.match(html, /The backend is still reading this account’s alerts/)
    // with Sources hidden by Settings the list still draws, in its plain words
    const hidden = screen({ ...v, heads: [], whole: false, display: { hidden: { inbox_sources: true } } })
    assert.doesNotMatch(hidden, /My Inbox could not be read/)
    assert.match(hidden, /Nothing to show right now — some alerts could not be checked/)
  })

  it('an account tied to no client is told so above its list', () => {
    const v = famView({ linked: false, items: [], subject: { name: '', key_why: 'This account is not linked to a client yet.' } })
    const html = draw(<AlertsScreen state={{ ...MY_INBOX_IDLE, status: 'ready', data: v, readAt: 1 }} view={v} chat={null}
      chooser={null} person="" acting={false} onPerson={noop} onOpen={noop} onMarkRead={noop} onClear={noop} onRetry={noop} />)
    assert.match(html, /This account is not linked to a client yet\./)
  })

  it('a client-role account\'s chat is its care team; staff keep their line', () => {
    assert.equal(subtitleOf('chat', true), CLIENT_CHAT_SUBTITLE)
    assert.equal(subtitleOf('chat', false), 'The people on the platform, and what they said.')
    assert.equal(subtitleOf('alerts', true), subtitleOf('alerts', false))
    assert.match(draw(<MyInboxHeader page="chat" chatUnread={0} onRefresh={noop} onPick={noop} client />), /Your care team/)
  })
})

describe('My Profile for a guardian', () => {
  afterEach(() => signIn(null))
  const f = (key: string, label: string, value: string): Field => ({ key, label, value, why: '', note: '' })
  const profile = (over: Partial<MyProfileView['person']> = {}): MyProfileView => ({
    scope: { mode: 'own', why: '', person: '' },
    person: { name: 'Jane Doe', key: '', key_why: '', roster_id: '', own: true, kind: 'client', notes: [], viewer: 'client', ...over },
    details: { state: 'ready', why: '', notes: [], as_of: '', fields: [f('client_id', 'Client ID', '104233'), f('house', 'House', 'Maple House')] },
    requirements: { state: 'not_applicable', why: '', rows: [], note: '', as_of: '', copy_why: '', gap: '',
      totals: { current: 0, soon: 0, attention: 0, unknown: 0 } },
    read_at: '2026-09-29T13:00:00Z',
  })

  it('a client keeps "My Info" and no account block', () => {
    const html = draw(<DetailsCard view={profile()} />)
    assert.match(html, />My Info</)
    assert.doesNotMatch(html, /data-account=""/)
    assert.equal(isGuardianView(profile()), false)
  })

  it('a guardian reads its own account first, then the client\'s details under the client\'s name', () => {
    const v = profile({ viewer: 'guardian', account: { name: 'Mary Doe', email: 'mary@example.invalid', phone: '3305550202', guardian_of: 'Jane Doe' } })
    const html = draw(<DetailsCard view={v} />)
    assert.ok(html.indexOf('data-account=""') < html.indexOf('data-field="client_id"'))
    assert.match(html, />Your account</)
    assert.match(html, /data-field="guardian_of"[\s\S]*?Jane Doe/)
    assert.match(html, /data-field="account_email"[\s\S]*?mary@example\.invalid/)
    assert.match(html, />Jane’s info</)
    assert.doesNotMatch(html, />My Info</)
    assert.equal(guardianTitle(profile({ viewer: 'guardian', name: '' })), 'Your family member’s info')
  })

  it('the rail offers a client, an SSA or a family member My Details alone; staff keep all three, My Docs while the master\'s switch shows it', () => {
    // the rail is built by the real client renderer against the signed-in account, then drawn
    const rail = () => {
      const m = mountHook((_: null) => ProfileNav({ page: 'details', person: '' }), null)
      const html = draw(m.current)
      m.unmount()
      return html
    }
    for (const who of [MARY, DENA, FRAN, OLGA]) {
      signIn(who)
      const narrowed = rail()
      assert.match(narrowed, /My Details/, who.name)
      assert.doesNotMatch(narrowed, /My Requirements|My Docs/, who.name)
    }
    // even once the master's switch shows My Docs and the row names every badge
    rules({ 'my-profile.requirements': ['DIRECTOR', 'STAFF', 'CLIENT', 'SSA', 'FAMILY'] })
    primeShellHides(SHELL_SHOWN)
    for (const who of [MARY, FRAN]) {
      signIn(who)
      assert.doesNotMatch(rail(), /My Requirements|My Docs/, `${who.name}: shown and released`)
    }
    primeShellHides(SHELL_HIDDEN)
    rules({})
    signIn(ANN)
    // My Requirements is the master's until App Control's own row names a badge (the operator's sheet: every staff badge)
    assert.doesNotMatch(rail(), /My Requirements/)
    rules({ 'my-profile.requirements': ['DIRECTOR', 'ADMIN', 'SUPERVISOR', 'HM', 'TEAMLEAD', 'STAFF'] })
    // Settings › My Work hides My Docs from everyone but the master until the switch shows it
    primeShellHides(SHELL_HIDDEN)
    const hidden = rail()
    assert.match(hidden, /My Details[\s\S]*My Requirements/)
    assert.doesNotMatch(hidden, /My Docs/)
    primeShellHides(SHELL_SHOWN)
    assert.match(rail(), /My Details[\s\S]*My Requirements[\s\S]*My Docs/)
    primeShellHides(SHELL_HIDDEN)
    rules({})
  })
})
