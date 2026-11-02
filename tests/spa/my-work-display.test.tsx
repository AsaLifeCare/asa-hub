/**
 * SETTINGS > MY WORK: each switch hides its part of My Work for everybody the relay says it hides it
 * for, the master's own session still sees everything with a line naming what is hidden, and the
 * Settings section is drawn for the master alone.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { MASTER_ONLY_SECTIONS, SECTION_APP, SETTINGS_NAV, configAccessSections, settingsNavFor } from '@/lib/settingsNav'
import { reachForSection } from '@/lib/badgeReach'
import { useAuthStore } from '@/auth/useAuthStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { safeLocalStorage } from '@/lib/safeStorage'
import {
  SHOWN_ALL, emptyWords, eventDayOf, forUsersLine, headerHiddenKey, heroFiguresOf, hiddenOf, isConcluded,
  readHeaderHidden, saveHeaderHidden, visibleActions, visibleRequests, visibleSourceLines, type ActionRow,
  type HideParts, type MyWorkView, type RequestRow, type SourceHead,
} from '@/pages/features/mywork/myWorkModel'
import { ActionsCard, MyWorkScreen, RequestsCard, useMyWorkPage } from '@/pages/features/mywork/MyWorkPage'
import { mountHook } from './react-host'
import { MY_WORK_IDLE, type MyWorkState } from '@/pages/features/mywork/useMyWork'
import MyWorkDisplaySection, { MyWorkDisplayBody } from '@/pages/settings/MyWorkDisplaySection'
import { MY_WORK_SWITCHES, SWITCHES_OFF, hideWord } from '@/pages/settings/myWorkDisplay'
import type { AppManifest } from '@/engine/types'

for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))

const head = (key: string, label: string, over: Partial<SourceHead> = {}): SourceHead => ({
  key, label, state: 'ready', why: '', as_of: '', count: 1, hidden: 0, capped: false, stale_why: '', note: '', ...over,
})

function act(id: string, over: Partial<ActionRow> = {}): ActionRow {
  return {
    id, source: 'requirements', due: '2026-10-22', due_tone: 'soon', due_why: '', condition: `Renew ${id}`,
    flow: 'Training renewal', phase: 'Expires in 26 days', family: 'credential', action: null,
    action_why: 'Your house manager books this training.', details: [], ...over,
  }
}

function req(id: string, over: Partial<RequestRow> = {}): RequestRow {
  return {
    id, source: 'call_offs', ref: `CO_${id}`, request: `Late Show ${id}`, submitted: '2026-05-24', submitted_why: '',
    status: { class: 'open', word: 'Being covered' }, details: [], link: null, ...over,
  }
}

const HR_NOTE = '5 background or admin checks HR runs are not listed'
const COPY = 'the copy read here was mirrored Sep 8, 2026 — anything filed since may not show yet'
const REPAIRS = 'House repair requests keep no reporter column, so none can be shown as yours.'

function view(hidden: Partial<HideParts> | null, over: Partial<MyWorkView> = {}): MyWorkView {
  return {
    scope: { mode: 'own', why: 'The master check could not be made (the sign-in check was not made), so only your own rows are shown.', person: '' },
    me: { name: 'Ann Roe', key_why: '' },
    actions: {
      sources: [head('requirements', 'Compliance requirements', { note: HR_NOTE })],
      rows: [act('dodd'), act('requirements:annroe:missing', { condition: 'Nothing on file for 5 requirements', folded: true,
        phase: 'Not on file', due: '', due_tone: '', due_why: 'Nothing is on file, so there is no date to run out.' })],
      note: '',
    },
    requests: {
      sources: [
        head('support_requests', 'Support requests', { copy_why: COPY }),
        head('house_repairs', 'House repairs', { state: 'not_attributable', structural: true, count: null, why: REPAIRS }),
        head('hotline', 'Phone requests', { state: 'unreadable', count: null, why: 'the lane did not answer' }),
      ],
      rows: [req('open1'), req('late1', { status: { class: 'recorded', word: 'Late call logged' }, ref: 'CO_LATE_PAST',
        details: [{ label: 'Shift day', value: '5/24/2026' }] }),
      req('late2', { status: { class: 'recorded', word: 'Late call logged' }, ref: 'CO_LATE_AHEAD',
        details: [{ label: 'Shift day', value: '1/5/2099' }] }),
      req('past1', { status: { class: 'resolved', word: 'Past' }, ref: 'CO_PAST' })],
      note: '',
    },
    totals: { actions: 2, overdue: 0, open_requests: 1, resolved: 1 },
    read_at: '2026-09-26T17:05:00Z',
    ...(hidden ? { display: { hidden: { ...SHOWN_ALL, ...hidden } } } : {}),
    ...over,
  }
}

const ready = (v: MyWorkView): MyWorkState => ({ ...MY_WORK_IDLE, status: 'ready', data: v, readAt: Date.parse('2026-09-26T17:05:00Z') })
const noop = () => {}
const ALL_PARTS = MY_WORK_SWITCHES.map((s) => s.part)
const screen =(s: MyWorkState, accountId = 'u-ann') =>
  draw(<MyWorkScreen state={s} person="" onPerson={noop} onRetry={noop} opens={() => true} onUpload={noop}
    accountId={accountId} />)

describe('each switch hides its part', () => {
  const heldAuth = useAuthStore.getState().user
  afterEach(() => {
    for (const id of ['u-ann', 'u-boss']) void safeLocalStorage.removeItem(headerHiddenKey(id))
    useAuthStore.setState({ user: heldAuth } as never)
  })

  it('the page hands the screen the session\'s own account id', async () => {
    const page = readFileSync(resolve(ROOT, 'src/pages/features/mywork/MyWorkPage.tsx'), 'utf8')
    assert.ok(page.includes("const accountId = useAuthStore((s) => s.user?.id ?? '')"))
    assert.match(page, /<MyWorkScreen state=\{state\}[\s\S]{0,200}?\baccountId=\{accountId\} \/>/)
    const realFetch = globalThis.fetch
    const heldToken = useAuthStore.getState().token
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 503, message: 'held here' }))) as typeof fetch
    try {
      useAuthStore.setState({ user: { id: 'u-ann', name: 'Ann Roe', role: 'staff', types: [] }, token: 'tok-ann' } as never)
      const h = mountHook(() => useMyWorkPage(), {})
      await h.settle(() => h.current.state.status === 'failed')
      assert.equal(h.current.accountId, 'u-ann')
      h.unmount()
    } finally {
      globalThis.fetch = realFetch
      useAuthStore.setState({ token: heldToken } as never)
    }
  })

  it('nothing hidden — and a relay that sends no display — draws the page as it shipped', () => {
    for (const v of [view(null), view({})]) {
      const html = screen(ready(v))
      assert.ok(html.includes('bg-detail-hero') && html.includes('Open actions') && html.includes('Sources unread'))
      assert.ok(html.includes(`Compliance requirements: ${HR_NOTE}`) && html.includes(`Support requests: ${COPY}`))
      assert.ok(html.includes('Nothing on file for 5 requirements'))
      assert.ok(html.includes('Show resolved (1)'))
      assert.ok(!html.includes('data-for-users'), 'no line for anybody but the master')
    }
    assert.deepEqual(hiddenOf(view(null)), SHOWN_ALL)
    const rows = view(null).requests.rows
    assert.deepEqual(visibleRequests(rows, SHOWN_ALL, '2026-09-26'), rows, 'the switch off lists every row')
  })

  it('hide_header: the black band, its figures and its footer line are gone; the cards stay', () => {
    const html = screen(ready(view({ header: true })))
    assert.ok(!html.includes('bg-detail-hero'))
    assert.ok(!html.includes('Open actions') && !html.includes('Sources unread') && !html.includes('Overdue'))
    assert.ok(!html.includes('The master check could not be made'), 'the footer line goes with the band')
    assert.ok(html.includes('>My Actions<') && html.includes('>My Requests<') && html.includes('Renew dodd'))
  })

  it('hide_header before the first read: this account\'s last read decides, and a read in flight is still said plainly', () => {
    const shown = screen({ ...MY_WORK_IDLE, status: 'loading' })
    assert.ok(shown.includes('bg-detail-hero'), 'nothing remembered yet: the header shows')
    saveHeaderHidden('u-ann', true)
    const reading = screen({ ...MY_WORK_IDLE, status: 'loading' })
    assert.ok(!reading.includes('bg-detail-hero') && reading.includes('Reading your actions and requests…'),
      `the remembered header stays hidden: ${reading.slice(0, 300)}`)
    const failed = screen({ ...MY_WORK_IDLE, status: 'failed', error: 'the relay answered 503' })
    assert.ok(!failed.includes('bg-detail-hero') && failed.includes('My Work could not be read: the relay answered 503.')
      && failed.includes('Try again'))
  })

  it('the remembered header is per account: another account\'s hidden header never decides this first paint', () => {
    saveHeaderHidden('u-ann', true)
    assert.equal(readHeaderHidden('u-ann'), true)
    assert.equal(readHeaderHidden('u-boss'), false)
    assert.ok(!screen({ ...MY_WORK_IDLE, status: 'loading' }, 'u-ann').includes('bg-detail-hero'))
    assert.ok(screen({ ...MY_WORK_IDLE, status: 'loading' }, 'u-boss').includes('bg-detail-hero'),
      'the master\'s own first paint is not decided by the account he last acted as')
    assert.ok(screen({ ...MY_WORK_IDLE, status: 'loading' }, '').includes('bg-detail-hero'), 'no account, nothing remembered')
    saveHeaderHidden('', true)
    assert.equal(safeLocalStorage.getItem(headerHiddenKey('')), null, 'nothing is kept for no account')
    assert.equal(readHeaderHidden(''), false)
  })

  it('hide_source_notes: the grey and amber lines are gone; a source that could not be read is still said', () => {
    const v = view({ source_notes: true })
    const html = screen(ready(v))
    assert.ok(!html.includes(HR_NOTE) && !html.includes(COPY) && !html.includes(REPAIRS))
    assert.ok(html.includes('Phone requests could not be read: the lane did not answer'))
    assert.deepEqual(visibleSourceLines(v.requests.sources, hiddenOf(v)).map((l) => l.tone), ['danger'])
  })

  it('hide_missing_row: the folded "Nothing on file" row is gone, every other action stays', () => {
    const v = view({ missing_row: true })
    const html = draw(<ActionsCard view={v} mass={false} opens={() => true} onUpload={noop} />)
    assert.ok(!html.includes('Nothing on file for 5 requirements') && html.includes('Renew dodd'))
    assert.deepEqual(visibleActions(v.actions.rows, hiddenOf(v)).map((r) => r.id), ['dodd'])
    const only = view({ missing_row: true }, { actions: { ...v.actions, rows: [v.actions.rows[1]] } })
    assert.ok(draw(<ActionsCard view={only} mass={false} opens={() => true} onUpload={noop} />)
      .includes('Nothing is asked of you right now.'), 'with the row hidden an empty card is said as empty')
  })

  it('hide_completed: no concluded request is listed, even when asked for, and Show resolved is gone', () => {
    const v = view({ completed: true })
    const html = draw(<RequestsCard view={v} mass={false} opens={() => true} initiallyShowResolved />)
    assert.ok(!html.includes('CO_PAST') && !html.includes('>Past<'))
    assert.ok(!html.includes('Show resolved'))
    assert.ok(!html.includes('CO_LATE_PAST'), 'a late call about a day already gone is concluded')
    assert.ok(html.includes('CO_open1') && html.includes('CO_LATE_AHEAD'), 'open rows and a late call still ahead stay')
    assert.deepEqual(visibleRequests(v.requests.rows, hiddenOf(v)).map((r) => r.id), ['open1', 'late2'])
    const landedAll = (h: Partial<HideParts>) => view(h, { requests: { ...v.requests, sources: [head('time_off', 'Time off')] } })
    assert.equal(heroFiguresOf(landedAll({ completed: true }))[2].note, 'Concluded requests are not listed')
    assert.equal(heroFiguresOf(landedAll({}))[2].note, '1 resolved on record')
    const none = view({ completed: true }, { requests: { sources: [head('time_off', 'Time off')], rows: [], note: '' } })
    const empty = draw(<RequestsCard view={none} mass={false} opens={() => true} initiallyShowResolved={false} />)
    assert.ok(empty.includes('Nothing you have asked for is still open.') && !empty.includes('on record'))
    assert.equal(emptyWords('requests', none.requests.sources, false, true), 'Nothing you have asked for is still open.')
  })

  it('concluded is the relay\'s rule: resolved, or recorded about a day before today in Ohio', () => {
    const TODAY = '2026-09-26'
    const late = (day: string) => req(`late-${day}`, { status: { class: 'recorded', word: 'Late call logged' },
      details: [{ label: 'Shift day', value: day }] })
    const filed = (day: string) => req(`filed-${day}`, { status: { class: 'recorded', word: 'Filed' },
      details: [{ label: 'Shift day', value: day }] })
    const incident = (at: string) => req(`in-${at}`, { source: 'incidents', submitted: at,
      status: { class: 'recorded', word: 'Filed' } })
    assert.equal(isConcluded(req('r', { status: { class: 'resolved', word: 'Covered' } }), TODAY), true)
    assert.equal(isConcluded(late('9/25/2026'), TODAY), true, 'a past late call')
    assert.equal(isConcluded(late('9/26/2026'), TODAY), false, 'today\'s late call stays')
    assert.equal(isConcluded(late('2026-09-30'), TODAY), false, 'a late call ahead stays')
    assert.equal(isConcluded(filed('9/1/2026'), TODAY), true, 'a filed call-off whose day passed')
    assert.equal(isConcluded(filed('sometime'), TODAY), false, 'no day to judge by stays')
    assert.equal(isConcluded(incident('2026-09-20T14:00:00Z'), TODAY), true, 'an incident filed before today')
    assert.equal(isConcluded(incident('2026-09-26T03:30:00Z'), TODAY), true, 'late on the 25th in Ohio is the 25th')
    assert.equal(isConcluded(incident('2026-09-26T15:00:00Z'), TODAY), false, 'an incident filed today stays')
    assert.equal(isConcluded(req('o', { details: [{ label: 'Shift day', value: '1/1/2020' }] }), TODAY), false,
      'an open request never is')
    assert.equal(isConcluded(req('s', { source: 'support_requests', status: { class: 'recorded', word: 'Escalated' },
      submitted: '2020-01-01' }), TODAY), false, 'a recorded row whose day the row does not carry stays')
    assert.equal(eventDayOf(late('9/5/2026')), '2026-09-05')
    const rows = [late('9/25/2026'), late('9/26/2026'), incident('2026-09-20T14:00:00Z'), req('open')]
    assert.deepEqual(visibleRequests(rows, { ...SHOWN_ALL, completed: true }, TODAY).map((r) => r.id),
      ['late-9/26/2026', 'open'])
    assert.deepEqual(visibleRequests(rows, SHOWN_ALL, TODAY), rows)
  })

  it('only a plain true hides', () => {
    const odd = { display: { hidden: { header: 'yes', source_notes: 1, missing_row: null, completed: true } } }
    assert.deepEqual(hiddenOf(odd as never), { ...SHOWN_ALL, completed: true })
  })
})

describe('the master\'s own session', () => {
  const massView = (display: MyWorkView['display']) => view(null, {
    scope: { mode: 'mass', why: 'Signed in as the master account: every person\'s rows, each naming its person.', person: '',
      people: [] },
    display,
  })

  it('sees everything, with a line naming what everyone else does not see', () => {
    const v = massView({ hidden: SHOWN_ALL, for_users: { header: true, source_notes: true, missing_row: false, completed: true },
      readable: true, why: '' })
    const html = screen(ready(v))
    assert.ok(html.includes('bg-detail-hero') && html.includes(HR_NOTE) && html.includes('Nothing on file for 5 requirements')
      && html.includes('Show resolved (1)'))
    assert.equal(forUsersLine(v),
      'Hidden from everyone else by Settings › My Work: the header, the source notes and concluded requests. You see everything.')
    assert.ok(html.includes('data-for-users') && html.includes('the header, the source notes and concluded requests'))
  })

  it('is told when nothing is hidden because the settings could not be read — and nobody else ever is', () => {
    const v = massView({ hidden: SHOWN_ALL, for_users: SHOWN_ALL, readable: false,
      why: 'the display settings could not be read (the tab could not be opened)' })
    assert.equal(forUsersLine(v),
      'The display settings could not be read (the tab could not be opened), so nothing is hidden from anyone.')
    assert.equal(forUsersLine(massView({ hidden: SHOWN_ALL, for_users: SHOWN_ALL, readable: true, why: '' })), '')
    const own = view({ header: true }, { display: { hidden: { ...SHOWN_ALL, header: true }, readable: false, why: 'x' } })
    assert.equal(forUsersLine(own), '', 'an own session never draws the line, whatever arrives')
  })

  it('names only My Work\'s parts: the relay\'s fifth part, My Inbox\'s Sources card, is said on My Inbox', () => {
    const inbox = { ...SHOWN_ALL, inbox_sources: true } as HideParts
    assert.equal(forUsersLine(massView({ hidden: SHOWN_ALL, for_users: inbox, readable: true, why: '' })), '')
    const both = { ...SHOWN_ALL, header: true, inbox_sources: true } as HideParts
    assert.equal(forUsersLine(massView({ hidden: SHOWN_ALL, for_users: both, readable: true, why: '' })),
      'Hidden from everyone else by Settings › My Work: the header. You see everything.')
    assert.deepEqual(hiddenOf(view(null, { display: { hidden: { ...SHOWN_ALL, inbox_sources: true } as HideParts } })),
      SHOWN_ALL, 'hiding the inbox card hides nothing of My Work')
  })
})

describe('the Settings section is the master\'s alone', () => {
  type Who = { id: string; name: string; email: string; role: string; types: string[]; isMaster: boolean }
  const MASTER: Who = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
  const DIRECTOR: Who = { id: 'u-dir', name: 'Dee', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
  const STAFF: Who = { id: 'u-st', name: 'Stella', email: 'st@example.org', role: 'staff', types: ['STAFF'], isMaster: false }
  const apps = (): AppManifest[] => useRegistryStore.getState().apps
  const ids = (user: Who, list: AppManifest[] = apps(), rules: Record<string, string[]> = {}) =>
    settingsNavFor(list, { isAdmin: user.role === 'admin', isMaster: user.isMaster, configRules: rules, user: user as never })
      .map((n) => n.id)

  it('is a master-only section, labelled My Work, that no badge rule can hand over', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('mywork'))
    assert.equal(SETTINGS_NAV.find((n) => n.id === 'mywork')?.label, 'My Work')
    assert.ok(apps().some((a) => a.id === 'my-work' && a.enabled), 'the registry carries My Work')
    assert.ok(ids(MASTER).includes('mywork'))
    assert.ok(!ids(DIRECTOR).includes('mywork'))
    assert.ok(!ids(DIRECTOR, apps(), { mywork: ['DIRECTOR'] }).includes('mywork'), 'a rule naming a badge grants nothing')
    assert.ok(!ids(STAFF, apps(), { mywork: ['STAFF'] }).includes('mywork'))
    assert.deepEqual(reachForSection(['ADMIN', 'DIRECTOR', 'STAFF'], true, true).badges, [])
  })

  it('the master acting as someone is that someone: the section is gone', () => {
    assert.ok(!ids({ ...MASTER, isMaster: false }).includes('mywork'))
  })

  it('travels with the app, and stays home', () => {
    const off = apps().map((a) => (a.id === 'my-work' ? { ...a, enabled: false } : a))
    assert.ok(!ids(MASTER, off).includes('mywork'))
    const held = useTenantStore.getState()
    try {
      useTenantStore.setState({ currentTenantId: 'franchise', homeTenantId: 'home', tenantsLoaded: true } as never)
      assert.ok(!ids(MASTER).includes('mywork'), 'the relay reads headquarters\' lane alone')
    } finally {
      useTenantStore.setState(held as never)
    }
  })

  it('Your apps never tells a My Work user that a section configures it', () => {
    assert.ok(!('mywork' in SECTION_APP))
  })

  it('Access control\'s config-access list names it to the master alone; App control and Members stay listed', () => {
    const forAdmin = configAccessSections(apps(), false).map((n) => n.id)
    const forMaster = configAccessSections(apps(), true).map((n) => n.id)
    assert.ok(!forAdmin.includes('mywork'))
    assert.ok(forAdmin.includes('appcontrol') && forAdmin.includes('members'))
    assert.ok(forMaster.includes('mywork') && forMaster.includes('appcontrol') && forMaster.includes('members'))
    // App Control access, Editions, Hub containers and Back-end per app are named to the master alone too
    // (tests/spa/app-control-delegate.test.tsx, tests/spa/settings-editions.test.tsx, tests/spa/settings-backends.test.tsx)
    assert.deepEqual(forMaster.filter((id) => id !== 'mywork' && id !== 'appcontrolaccess' && id !== 'editions' &&
      id !== 'hubcontainers' && id !== 'backends' && id !== 'routes'), forAdmin)
    const src = readFileSync(resolve(ROOT, 'src/pages/settings/AccessControlSection.tsx'), 'utf8')
    assert.ok(src.includes('...configAccessSections(apps, isMaster),') && src.includes('const isMaster = useEffectiveIsMaster()'))
    assert.ok(!src.includes('settingsNavFor(apps, { isAdmin: true, isMaster: true })'))
  })

  it('the concluded switch says what concluded means', () => {
    const desc = MY_WORK_SWITCHES.find((s) => s.part === 'completed')?.desc ?? ''
    assert.ok(desc.includes('late calls, call-offs and incident reports about a day before today'), desc)
  })

  it('the Settings page draws it only through that verdict', () => {
    const page = readFileSync(resolve(ROOT, 'src/pages/SettingsPage.tsx'), 'utf8')
    assert.ok(page.includes("{has('mywork') && <MyWorkDisplaySection />}"))
    assert.equal((page.match(/<MyWorkDisplaySection \/>/g) ?? []).length, 1)
  })

  it('draws a switch per part with what it does now; a backend that does not know them offers none', () => {
    const html = flat(renderToString(<MyWorkDisplayBody hidden={{ ...SWITCHES_OFF, completed: true }} known={ALL_PARTS}
      catalogue={null} busy={false} onFlip={noop} />))
    for (const s of MY_WORK_SWITCHES) assert.ok(html.includes(s.label.replace(/&/g, '&amp;')), s.label)
    assert.equal((html.match(/role="switch"/g) ?? []).length, MY_WORK_SWITCHES.length)
    assert.equal(MY_WORK_SWITCHES.length, 15)
    assert.match(html, /data-part="completed">Hidden from everyone else</)
    assert.match(html, /data-part="header">Shown to everyone</)
    assert.match(html, /data-part="inbox_sources">Shown to everyone</)
    const unknown = flat(renderToString(<MyWorkDisplayBody hidden={SWITCHES_OFF} known={[]} catalogue={null} busy={false}
      onFlip={noop} />))
    assert.ok(unknown.includes('data-not-known') && !unknown.includes('role="switch"'))
    assert.deepEqual(MY_WORK_SWITCHES.map((s) => s.key),
      ['mywork_hide_header', 'mywork_hide_source_notes', 'mywork_hide_missing_row', 'mywork_hide_completed',
        'mywork_hide_inbox_sources', 'mywork_hide_ssa_updated', 'mywork_hide_ssa_county', 'mywork_hide_ssa_count',
        'mywork_hide_ssa_role', 'mywork_hide_sched_hours', 'mywork_hide_record_notes', 'mywork_hide_staff_doc_counts',
        'mywork_hide_client_activity', 'mywork_hide_client_group_titles', 'mywork_hide_family_details'])
    assert.equal(hideWord(' YES '), true)
    assert.equal(hideWord('maybe'), false)
    assert.equal(hideWord(undefined), false)
  })

  it('the fifth switch is My Inbox\'s Sources card, and says its save lands on My Inbox', () => {
    const sw = MY_WORK_SWITCHES.find((s) => s.part === 'inbox_sources')
    assert.ok(sw)
    assert.equal(sw.key, 'mywork_hide_inbox_sources')
    assert.equal(sw.label, 'The Sources card in My Inbox')
    assert.equal(sw.page, 'My Inbox')
    assert.ok(MY_WORK_SWITCHES.filter((s) => s.part !== 'inbox_sources' && !s.part.startsWith('ssa_') && s.part !== 'sched_hours' && s.part !== 'record_notes')
      .every((s) => s.page === 'My Work'))
    const html = flat(renderToString(<MyWorkDisplayBody hidden={{ ...SWITCHES_OFF, inbox_sources: true }} known={ALL_PARTS}
      catalogue={null} busy={false} onFlip={noop} />))
    assert.match(html, /data-part="inbox_sources">Hidden from everyone else</)
    assert.ok(html.includes('aria-label="Hide the sources card in my inbox"'))
    const src = readFileSync(resolve(ROOT, 'src/pages/settings/MyWorkDisplaySection.tsx'), 'utf8')
    assert.ok(src.includes('Everyone else sees it on ${sw.page} within about three minutes.'))
  })

  it('a backend that knows the four My Work keys but not the fifth still offers those four, and says so of the fifth', () => {
    const four = MY_WORK_SWITCHES.filter((s) => s.page === 'My Work').map((s) => s.part)
    const html = flat(renderToString(<MyWorkDisplayBody hidden={SWITCHES_OFF} known={four} catalogue={null} busy={false}
      onFlip={noop} />))
    assert.equal((html.match(/role="switch"/g) ?? []).length, 4)
    assert.match(html, /data-not-known="inbox_sources"/)
    assert.ok(!html.includes('data-part="inbox_sources"') && html.includes('data-part="completed"'))
    assert.ok(!html.includes('aria-label="Hide the sources card in my inbox"'))
  })

  it('reads the config before it offers a switch', () => {
    const html = flat(renderToString(<MyWorkDisplaySection />))
    assert.ok(html.includes('My Work — what everyone else sees') && html.includes('Reading the config…'))
    assert.ok(!html.includes('role="switch"'))
  })
})
