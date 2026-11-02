/**
 * STAFF · the tabs App Control splits off (the operator's access sheet, 2026-10-29): Performance, HR Admin, Employee
 * Pay and Activity, each under its own row. A viewer whose badges a row does not name is offered neither the tab nor
 * the panels that are its own — on their own profile too — and an address naming a shut tab opens Staff Profile. The
 * master is never narrowed; a holder of staff.hr keeps HR Admin, since an edition only ever adds people.
 *
 * The rows are asked of the real checker (featureAllowsWith, and useFeatureAllowed under real React) with the badges
 * the operator's rows will carry; the screen is drawn whole by react-dom/server for the viewer the page builds.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { APP_FEATURES, featureAllowsWith, featureOf } from '@/lib/featureAccess'
import type { ReadState } from '@/lib/readCache'
import { useMemberStore } from '@/stores/useMemberStore'
import { StaffScreen, useShutTabs } from '@/pages/features/staffprofiles/StaffProfilesPage'
import { StaffViewerContext } from '@/pages/features/staffprofiles/staffViewer'
import {
  STAFF_TABS, STAFF_TAB_FEATURES, actionGroupsFor, askFor, rosterOf, shutTabsOf, tabShown, tabsFor, viewerOf,
  type SplitTab, type StaffAsk, type StaffEdition, type StaffTab, type StaffViewer,
} from '@/pages/features/staffprofiles/staffModel'
import { mountHook } from './react-host'

// motion mounts its projection nodes against the window; a screen drawn whole reaches them
for (const hook of ['addEventListener', 'removeEventListener'] as const) {
  if (typeof (globalThis as Record<string, unknown>)[hook] !== 'function') {
    Object.defineProperty(globalThis, hook, { value: () => {}, configurable: true, writable: true })
  }
}

const noop = () => {}
const draw = (node: ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>).replace(/<!-- -->/g, '')
const ready = <T,>(data: T): ReadState<T> => ({ status: 'ready', data, error: '', refreshing: false })

// the rows the operator writes before the release: the leads on every tab, the whole team a little wider
const LEADS = ['DIRECTOR', 'PLATFORMLEAD', 'ADMIN', 'ADMINISTRATOR', 'SUPERVISOR']
const RULES: Record<string, string[]> = {
  'staff-profiles.team': [...LEADS, 'ENTITY', 'MANAGER'],
  'staff-profiles.performance': LEADS,
  'staff-profiles.hrAdmin': LEADS,
  'staff-profiles.employeePay': LEADS,
  'staff-profiles.activity': LEADS,
}
const ALL_SPLIT: SplitTab[] = ['performance', 'hr', 'pay', 'activity']
const EVERY_TAB = STAFF_TABS.map((t) => t.id)
const OWN_TABS: StaffTab[] = ['profile', 'clients', 'locations', 'actions', 'calendar', 'preferences', 'driving', 'compliance', 'documents']

type Who = { isMaster?: boolean; types?: string[]; role?: string }
const who = (types: string[], role = 'staff'): Who => ({ isMaster: false, types, role })
const MASTER: Who = { isMaster: true, types: [], role: 'admin' }

/** The split tabs the rows shut for this person, as the page asks them. */
const shutFor = (user: Who, rules: Record<string, string[]>): SplitTab[] =>
  shutTabsOf({
    performance: featureAllowsWith(STAFF_TAB_FEATURES.performance, user, rules),
    hr: featureAllowsWith(STAFF_TAB_FEATURES.hr, user, rules),
    pay: featureAllowsWith(STAFF_TAB_FEATURES.pay, user, rules),
    activity: featureAllowsWith(STAFF_TAB_FEATURES.activity, user, rules),
  })
const viewerFor = (user: Who, rules = RULES, editions: StaffEdition[] = []): StaffViewer =>
  viewerOf(user.isMaster === true, 'full', { assign: '', selfKey: 'bealee' }, editions, false, shutFor(user, rules))
const ids = (viewer: StaffViewer) => tabsFor(viewer).map((t) => t.id)

describe('the split tabs', () => {
  it('each is a row App Control lists under Staff, under the id the server asks, the master\'s until released', () => {
    const listed = (APP_FEATURES['staff-profiles'] ?? []).map((f) => f.id)
    for (const id of Object.values(STAFF_TAB_FEATURES)) {
      assert.ok(listed.includes(id), id)
      assert.equal(featureOf(id)?.masterUntilReleased, true, id)
    }
    assert.deepEqual(Object.values(STAFF_TAB_FEATURES),
      ['staff-profiles.performance', 'staff-profiles.hrAdmin', 'staff-profiles.employeePay', 'staff-profiles.activity'])
  })

  it('Director, Platform Lead, Admin, Administrator and Supervisor are offered every tab, a role read as its badge too', () => {
    for (const badge of LEADS) assert.deepEqual(ids(viewerFor(who([badge]))), EVERY_TAB, badge)
    assert.deepEqual(ids(viewerFor(who([], 'admin'))), EVERY_TAB, 'the admin role')
    assert.equal(viewerFor(who(['SUPERVISOR'])).shut, undefined, 'nothing shut is said')
  })

  it('House Manager, Team Lead and DSP are offered their own profile\'s nine tabs; Performance, HR Admin, Employee Pay and Activity never', () => {
    for (const types of [['HM'], ['TEAMLEAD'], ['STAFF'], ['HM', 'STAFF', 'INTERVIEWER']]) {
      const viewer = viewerFor(who(types))
      assert.deepEqual(viewer.shut, ALL_SPLIT, types.join())
      assert.deepEqual(ids(viewer), OWN_TABS, types.join())
    }
    // a manager role is no lead: the tab rows do not name MANAGER
    assert.deepEqual(ids(viewerFor(who(['INTERVIEWER', 'HM'], 'manager'))), OWN_TABS)
  })

  it('before the rows are written the tabs are the master\'s alone; the master is never narrowed, whatever is passed', () => {
    assert.deepEqual(shutFor(who(['DIRECTOR']), {}), ALL_SPLIT)
    assert.deepEqual(shutFor(MASTER, {}), [])
    assert.deepEqual(shutFor(MASTER, RULES), [])
    assert.deepEqual(ids(viewerOf(true, 'full', undefined, [], false, ALL_SPLIT)), EVERY_TAB)
    assert.deepEqual(ids(viewerOf(false, 'basic', undefined, [], false, ALL_SPLIT)), ['profile'], 'a basic viewer keeps the profile alone')
  })

  it('a holder of staff.hr keeps HR Admin, and only HR Admin', () => {
    const holder = viewerFor(who(['HM']), RULES, ['staff.hr'])
    assert.deepEqual(holder.shut, ['performance', 'pay', 'activity'])
    assert.ok(ids(holder).includes('hr') && !ids(holder).includes('activity'))
    assert.deepEqual(viewerFor(who(['HM']), RULES, ['staff.profile']).shut, ALL_SPLIT, 'another edition opens no tab')
  })

  it('an address naming a shut tab opens Staff Profile; one the viewer is offered opens itself', () => {
    const hm = viewerFor(who(['HM'])), director = viewerFor(who(['DIRECTOR']))
    for (const tab of ALL_SPLIT) {
      assert.equal(tabShown(hm, tab), 'profile', tab)
      assert.equal(tabShown(director, tab), tab, tab)
    }
    assert.equal(tabShown(hm, 'calendar'), 'calendar')
  })

  it('a shut tab takes its panels: Employee Pay its loan and payment, Activity a transcript, HR Admin its pencil', () => {
    const hm = viewerFor(who(['HM']), RULES, ['staff.profile'])
    const director = viewerFor(who(['DIRECTOR']), RULES, ['staff.profile'])
    const asks: StaffAsk[] = [{ kind: 'payment' }, { kind: 'transcript', id: 'AC1' }, { kind: 'edit', section: 'hr' }]
    for (const ask of asks) {
      assert.equal(askFor(ask, hm, 'bealee'), null, ask.kind)
      assert.deepEqual(askFor(ask, director, 'bealee'), ask, ask.kind)
    }
    assert.deepEqual(askFor({ kind: 'edit', section: 'profile' }, hm, 'bealee'), { kind: 'edit', section: 'profile' },
      'a pencil of a tab still offered stays')
    const labels = (v: StaffViewer) => actionGroupsFor(v, 'bealee').flatMap((g) => g.items.map((i) => i.label))
    assert.ok(!labels(hm).includes('Add Payment') && labels(director).includes('Add Payment'))
    const master = viewerOf(true, 'full', undefined, [], false, ALL_SPLIT)
    assert.equal(askFor({ kind: 'loan' }, master, 'bealee')?.kind, 'loan', 'the master opens every panel')
  })
})

describe('the screen', () => {
  const ROSTER = rosterOf({ staff: [{ key: 'bealee', name: 'Bea Lee', status: 'active', role: 'DSP' }] })
  const ROW = ROSTER.staff[0]
  const inactive = { on: false, reading: false, why: '' }
  const screen = (viewer: StaffViewer, tab: StaffTab) => draw(
    <StaffViewerContext.Provider value={viewer}>
      <StaffScreen roster={ready(ROSTER)} onRetry={noop} staff={ROSTER.staff} wanted="bealee" row={ROW} tab={tab} view=""
        inactive={inactive} onInactive={noop} actionsCount={null} favorite={false} onFavorite={noop} onStaff={noop} onTab={noop}
        onView={noop} onAsk={noop} />
    </StaffViewerContext.Provider>)
  const nav = (html: string) => html.slice(html.indexOf('aria-label="Staff sections"'), html.indexOf('</nav>'))

  it('an own-profile viewer is drawn the nine tabs, and the profile where the address names Activity', () => {
    const html = screen(viewerFor(who(['STAFF'])), 'activity')
    for (const t of ['Staff Profile', 'Calendar', 'Driving', 'Compliance', 'Documents']) assert.ok(nav(html).includes(`>${t}</span>`), t)
    for (const t of ['Performance', 'HR Admin', 'Employee Pay', 'Activity']) assert.ok(!nav(html).includes(`>${t}</span>`), t)
    assert.ok(html.includes('data-section="profile"') && !html.includes('data-section="activity"'))
  })

  it('a lead is drawn every tab, and the one the address names', () => {
    const html = screen(viewerFor(who(['SUPERVISOR'])), 'pay')
    for (const t of ['Performance', 'HR Admin', 'Employee Pay', 'Activity']) assert.ok(nav(html).includes(`>${t}</span>`), t)
    assert.ok(html.includes('data-section="pay"'))
  })
})

describe('the page asks the rows of the signed-in person', () => {
  const signIn = (user: Record<string, unknown>) => useAuthStore.setState({ user: { id: 'u1', name: 'Bea Lee', email: '', ...user } } as never)
  after(() => {
    useAuthStore.setState({ user: null } as never)
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} } as never)
  })

  it('useShutTabs: nothing for the master or a lead, the four for a house manager, the four for anyone before release', () => {
    useMemberStore.setState({ currentMemberId: '' } as never)
    const shut = (user: Record<string, unknown>, rules: Record<string, string[]>) => {
      useBadgeAccessStore.setState({ rules, tenantRules: {}, configRules: {} } as never)
      signIn(user)
      const hook = mountHook(() => useShutTabs(), {})
      const got = hook.current
      hook.unmount()
      return got
    }
    assert.deepEqual(shut({ role: 'admin', types: [], isMaster: true }, {}), [])
    assert.deepEqual(shut({ role: 'admin', types: ['DIRECTOR'], isMaster: false }, RULES), [])
    assert.deepEqual(shut({ role: 'staff', types: ['HM'], isMaster: false }, RULES), ALL_SPLIT)
    assert.deepEqual(shut({ role: 'admin', types: ['DIRECTOR'], isMaster: false }, {}), ALL_SPLIT)
  })
})
