/**
 * SETTINGS → APP CONTROL ACCESS — App Control shared with a person, app by app. The account the master lists, signed
 * in as itself at home, gets App Control's door on every surface; inside, the screen draws only the apps the server's
 * own read names, with the tenant half and the sections gone and every control locked while May change is off. The
 * master and everybody not listed are answered exactly as before, and the section that writes the list is the
 * master's alone.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { mapBackendUser, useAuthStore } from '@/auth/useAuthStore'
import type { AppManifest } from '@/engine/types'
import { isAllowedWith, masterOnlyRefused, selectAccessChecker } from '@/lib/appAccess'
import { appControlGrantFrom } from '@/lib/appControlGrant'
import { visibleManifests } from '@/lib/audience'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { MASTER_ONLY_SECTIONS, SETTINGS_NAV, configAccessSections, settingsNavFor } from '@/lib/settingsNav'
import { appControlManifest } from '@/registry/apps-appcontrol'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import {
  MatrixGroup, delegateApps, delegateReadFrom, type Row,
} from '@/pages/features/appcontrol/AppControlPage'
import {
  AppControlAccessView, DelegateAppsPicker, acOfferedApps, acPeopleFrom, delegatesFrom, delegatesPayload,
} from '@/pages/settings/AppControlAccessSection'
import { useMemberStore } from '@/stores/useMemberStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'

const ROOT = resolve(process.cwd())
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(createElement(MemoryRouter, null, node)))
const noop = () => {}

type Who = { id: string; name: string; email: string; role: string; types: string[]; isMaster: boolean;
             appControl?: { apps: string[]; mayChange: boolean } }
const MASTER: Who = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const DEE: Who = { id: 'u-dee', name: 'Dee', email: 'dee@example.org', role: 'manager', types: ['DIRECTOR'], isMaster: false,
                   appControl: { apps: ['scheduling'], mayChange: false } }
const MAX: Who = { id: 'u-max', name: 'Max', email: 'max@example.org', role: 'staff', types: [], isMaster: false,
                   appControl: { apps: ['scheduling', 'chat'], mayChange: true } }
const DIRECTOR: Who = { id: 'u-dir', name: 'Dir', email: 'dir@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
const CLIENT: Who = { id: 'u-cli', name: 'Cli', email: 'cli@example.org', role: 'client', types: [], isMaster: false,
                      appControl: { apps: ['scheduling'], mayChange: true } }

const signIn = (user: Who | null) => useAuthStore.setState({ user } as never)

function apps(): AppManifest[] {
  const all = useRegistryStore.getState().apps
  return all.some((a) => a.id === appControlManifest.id) ? all : [...all, appControlManifest]
}

function home() {
  useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
  useWorldStore.setState({ currentWorldId: '' })
  useMemberStore.setState({ currentMemberId: '' } as never)
}

describe('the session carries the share it was given, and nothing else', () => {
  it('the auth answer maps to the session: each app once, never a control id, absent without an app', () => {
    const u = mapBackendUser({ id: 'u-dee', email: 'dee@example.org', role: 'manager',
                               app_control: { apps: ['scheduling', 'scheduling', 'chat.liveChat', ''], may_change: true } } as never)
    assert.deepEqual(u.appControl, { apps: ['scheduling'], mayChange: true })
    assert.equal(mapBackendUser({ id: 'u-x', role: 'staff', app_control: { apps: [] } } as never).appControl, undefined)
    assert.equal(mapBackendUser({ id: 'u-x', role: 'staff' } as never).appControl, undefined)
    assert.equal(mapBackendUser({ id: 'u-x', role: 'staff', app_control: { apps: ['x'], may_change: 'yes' } } as never)
      .appControl?.mayChange, false)
  })

  it('a share opens only for the account itself, at home, outside a world and a visit — never for the master', () => {
    const at = { memberId: '', worldId: '', away: false }
    assert.deepEqual(appControlGrantFrom({ ...at, user: DEE }), { apps: ['scheduling'], mayChange: false })
    assert.equal(appControlGrantFrom({ ...at, user: { ...MASTER, appControl: { apps: ['chat'], mayChange: true } } }), null)
    assert.equal(appControlGrantFrom({ ...at, user: DIRECTOR }), null)
    assert.equal(appControlGrantFrom({ ...at, user: DEE, memberId: 'u-max' }), null)
    assert.equal(appControlGrantFrom({ ...at, user: DEE, worldId: 'w-1' }), null)
    assert.equal(appControlGrantFrom({ ...at, user: DEE, away: true }), null)
    assert.equal(appControlGrantFrom({ ...at, user: null }), null)
  })
})

describe('the door: App Control opens for a listed account, and for nobody else it did not open for before', () => {
  beforeEach(() => {
    useRegistryStore.setState({ apps: apps() })
    useBadgeAccessStore.setState({ rules: { 'app-control': ['ADMIN', 'DIRECTOR'], chat: ['STAFF'] }, tenantRules: {}, configRules: {} })
    home()
  })
  after(() => { home(); signIn(null) })

  it('a listed manager and a listed staff member pass the one checker; a director nobody listed does not', () => {
    signIn(DEE)
    assert.equal(masterOnlyRefused('app-control'), false)
    assert.equal(isAllowedWith(apps(), 'manager', 'app-control'), true)
    signIn(MAX)
    assert.equal(isAllowedWith(apps(), 'staff', 'app-control'), true)
    signIn(DIRECTOR)
    assert.equal(masterOnlyRefused('app-control'), true)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), false, 'a badge row still opens nothing')
    signIn(MASTER)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), true, 'the master is unchanged')
  })

  it('the share opens App Control alone — it is no pass for any other app', () => {
    signIn(MAX)
    assert.equal(isAllowedWith(apps(), 'staff', 'chat'), true, 'the badge row decides Chat, as before')
    useBadgeAccessStore.setState({ rules: {} })
    assert.equal(isAllowedWith(apps(), 'staff', 'chat'), false, 'a shared app with no row is still the master\'s')
  })

  it('a listed client is refused: App Control is never a client\'s screen', () => {
    signIn(CLIENT)
    assert.equal(isAllowedWith(apps(), 'client', 'app-control'), false)
  })

  it('a visit, a world and a place away from home carry no share', () => {
    signIn(DEE)
    useMemberStore.setState({ currentMemberId: 'u-max', memberName: 'Max', memberRole: 'staff', memberTypes: [] } as never)
    assert.equal(isAllowedWith(apps(), 'manager', 'app-control'), false)
    home()
    useWorldStore.setState({ currentWorldId: 'w-1' })
    assert.equal(isAllowedWith(apps(), 'manager', 'app-control'), false)
    home()
    useTenantStore.setState({ currentTenantId: 'fr-1' })
    assert.equal(isAllowedWith(apps(), 'manager', 'app-control'), false)
  })

  it('the launcher, sidebar and ⌘K lists carry the tile for the listed account alone', () => {
    signIn(DEE)
    const theirs = visibleManifests(apps(), { role: 'manager' }, selectAccessChecker(apps(), 'manager')).map((a) => a.id)
    assert.ok(theirs.includes('app-control'))
    signIn(DIRECTOR)
    const others = visibleManifests(apps(), { role: 'admin' }, selectAccessChecker(apps(), 'admin')).map((a) => a.id)
    assert.ok(!others.includes('app-control'))
  })
})

describe('inside App Control: only the apps on the list, as the master sees them', () => {
  it('the delegate read is held to its own list a second time — App Control itself, a control id and a foreign row never drawn', () => {
    const got = delegateReadFrom({
      apps: ['scheduling', 'scheduling', 'app-control', 'chat.liveChat', ''],
      may_change: true,
      rules: { scheduling: ['staff'], 'scheduling.builder': ['DIRECTOR'], chat: ['STAFF'], 'app-control': ['ADMIN'] },
    })
    assert.deepEqual(got, { apps: ['scheduling'], mayChange: true,
                            rules: { scheduling: ['STAFF'], 'scheduling.builder': ['DIRECTOR'] } })
    assert.equal(delegateReadFrom({ apps: ['x'], may_change: 'yes' }).mayChange, false)
    assert.deepEqual(delegateReadFrom(null), { apps: [], mayChange: false, rules: {} })
  })

  it('the rows are the registry apps the read names, and only those', () => {
    const all = apps()
    const shown = delegateApps(all, { apps: ['scheduling', 'chat', 'not-in-registry'], mayChange: false, rules: {} }).map((a) => a.id)
    assert.deepEqual([...shown].sort(), ['chat', 'scheduling'].filter((id) => all.some((a) => a.id === id)).sort())
    assert.ok(!shown.includes('app-control'))
    assert.deepEqual(delegateApps(all, null), [])
  })

  const scheduling = () => {
    const app = apps().find((a) => a.id === 'scheduling')
    assert.ok(app, 'the registry carries Scheduling')
    return app
  }
  const rowOf = (app: AppManifest): Row => ({
    app, currentId: app.category, overridden: false, pending: false,
    suggestion: { appId: app.id, categoryId: app.category, label: '', confidence: 0, reasons: [], scores: [], hasSignal: false },
  })
  const matrix = (viewer: 'master' | 'delegate', locked: boolean) => draw(createElement('table', null, createElement('tbody', null,
    createElement(MatrixGroup, {
      def: { id: 'ops', label: 'Ops', tint: 'blue', icon: 'layout-grid', custom: false },
      rows: [rowOf(scheduling())], collapsed: false, onToggle: noop, compact: false,
      rules: { scheduling: ['STAFF'] }, busy: {}, locked,
      tenants: viewer === 'delegate' ? [] : [{ id: 'hq', name: 'Headquarters' }, { id: 'fr', name: 'Franchise' }] as never,
      tenantRules: {}, onToggleBadge: noop, onStage: noop, onStageTenant: noop, onApply: noop, onDismiss: noop, viewer,
    }))))

  it('view only: the row and its controls are drawn, every control locked, and no tenant half', () => {
    const html = matrix('delegate', true)
    assert.match(html, /Staff Calendars/, 'the controls inside the app are drawn')
    assert.match(html, /Back to the master alone/, 'the clear speaks of the master, not of the reader')
    assert.doesNotMatch(html, /Make it mine alone/)
    assert.doesNotMatch(html, /Tenants/, 'no tenant half')
    const buttons = html.match(/<button[^>]*>/g) ?? []
    const live = buttons.filter((b) => !/disabled=""/.test(b) && !/aria-expanded/.test(b))
    assert.deepEqual(live, [], 'every control is locked')
  })

  it('may change: the same row with its controls live; the master\'s own row still speaks to the master', () => {
    const html = matrix('delegate', false)
    const buttons = html.match(/<button[^>]*>/g) ?? []
    assert.ok(buttons.some((b) => /aria-label="STAFF access to/.test(b) && !/disabled=""/.test(b)), 'a badge cell is live')
    const mine = matrix('master', false)
    assert.match(mine, /Make it mine alone/)
    assert.match(mine, /Tenants/, 'the master keeps the tenant half')
  })

  const g = globalThis as unknown as Record<string, unknown>
  const had = { add: g.addEventListener, remove: g.removeEventListener }
  before(() => {
    g.addEventListener = () => {}
    g.removeEventListener = () => {}
  })
  after(() => {
    g.addEventListener = had.add
    g.removeEventListener = had.remove
    home()
    signIn(null)
  })

  it('the route opens for the listed account on the Matrix alone — no Board, no List, no master\'s words', async () => {
    await CUSTOM_PAGES['app-control/board'].load()
    useRegistryStore.setState({ apps: apps() })
    home()
    signIn(DEE)
    Object.assign(useRegistryStore.getInitialState(), { apps: useRegistryStore.getState().apps })
    Object.assign(useAuthStore.getInitialState(), { user: useAuthStore.getState().user })
    const html = flat(renderToString(createElement(MemoryRouter, { initialEntries: ['/app/app-control/board'] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) })))))
    assert.match(html, /The apps the master shares with you/)
    assert.match(html, /Reading the apps shared with you/)
    assert.doesNotMatch(html, /grant by badge and tenant/)
    assert.doesNotMatch(html, />Board</)
    assert.doesNotMatch(html, />List</)
  })
})

describe('Settings → App Control access is the master\'s alone', () => {
  beforeEach(() => { useRegistryStore.setState({ apps: apps() }); home() })

  it('is a master-only section, at home only, named to the master alone in Access control', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('appcontrolaccess'))
    assert.equal(SETTINGS_NAV.find((n) => n.id === 'appcontrolaccess')?.label, 'App Control access')
    const ids = (isMaster: boolean, user: Who) =>
      settingsNavFor(apps(), { isAdmin: user.role === 'admin', isMaster, configRules: {}, user: user as never }).map((n) => n.id)
    assert.ok(ids(true, MASTER).includes('appcontrolaccess'))
    assert.ok(!ids(false, DIRECTOR).includes('appcontrolaccess'))
    assert.ok(!ids(false, DEE).includes('appcontrolaccess'), 'a delegate never sees who else is on the list')
    assert.ok(!configAccessSections(apps(), false).some((n) => n.id === 'appcontrolaccess'))
    assert.ok(configAccessSections(apps(), true).some((n) => n.id === 'appcontrolaccess'))
    useTenantStore.setState({ currentTenantId: 'fr-1' })
    assert.ok(!ids(true, MASTER).includes('appcontrolaccess'), 'away from home it stays home')
  })

  it('the page renders it only through that verdict', () => {
    assert.ok(read('src/pages/SettingsPage.tsx').includes("{has('appcontrolaccess') && <AppControlAccessSection />}"))
  })

  it('the picker offers active employees, never the master account, a client or an inactive account', () => {
    const people = acPeopleFrom([
      { id: 'u-boss', email: 'asatech@asalifecare.com', role: 'admin', is_master: true },
      { id: 'u-dee', display_name: 'Dee', email: 'dee@example.org', role: 'manager' },
      { id: 'u-max', display_name: 'Max', email: 'max@example.org', role: 'staff' },
      { id: 'u-cli', display_name: 'Cli', email: 'cli@example.org', role: 'client' },
      { id: 'u-old', display_name: 'Old', email: 'old@example.org', role: 'staff', active: false },
      { id: 'u-int', display_name: 'Int', email: 'int@example.org', role: 'interviewer' },
    ])
    assert.deepEqual(people.map((p) => p.id), ['u-dee', 'u-max'])
  })

  it('the list round-trips exactly: each app once, May change only when switched on', () => {
    const list = delegatesFrom([{ id: 'u-dee', apps: ['scheduling', 'scheduling', 'chat'], may_change: true },
                                { id: 'u-dee', apps: ['x'] }, { id: 'u-max', apps: ['chat'], may_change: 'yes' }, { apps: ['y'] }])
    assert.deepEqual(list, [{ id: 'u-dee', apps: ['scheduling', 'chat'], mayChange: true },
                            { id: 'u-max', apps: ['chat'], mayChange: false }])
    assert.deepEqual(delegatesPayload(list), [{ id: 'u-dee', apps: ['scheduling', 'chat'], may_change: true },
                                              { id: 'u-max', apps: ['chat'], may_change: false }])
  })

  it('App Control itself is never offered as an app to share', () => {
    assert.ok(!acOfferedApps(apps()).some((a) => a.id === 'app-control'))
    const html = draw(createElement(DelegateAppsPicker, { draft: { id: 'u-dee', apps: [], mayChange: false }, apps: apps(), onChange: noop }))
    assert.doesNotMatch(html, /data-ac-picker-app="app-control"/)
    assert.match(html, /data-ac-picker-app="scheduling"/)
    assert.match(html, /Choose at least one app/)
    assert.match(html, /May change/)
  })

  it('each person shows their own apps and their own May change; the search never offers someone already listed', () => {
    const html = draw(createElement(AppControlAccessView, {
      list: [{ id: 'u-dee', apps: ['scheduling'], mayChange: false }, { id: 'u-max', apps: ['chat'], mayChange: true }],
      people: [{ id: 'u-dee', name: 'Dee', email: 'dee@example.org', avatar: '', role: 'manager' },
               { id: 'u-max', name: 'Max', email: 'max@example.org', avatar: '', role: 'staff' },
               { id: 'u-ann', name: 'Ann Dee', email: 'ann@example.org', avatar: '', role: 'staff' }],
      apps: apps(), query: 'dee', busy: false,
      onQuery: noop, onAdd: noop, onEdit: noop, onRemove: noop, onMayChange: noop,
    }))
    assert.match(html, /data-ac-delegate="u-dee"/)
    assert.match(html, /data-ac-delegate-app="scheduling"/)
    assert.match(html, /data-ac-delegate="u-max"/)
    assert.match(html, /data-ac-access-add="u-ann"/)
    assert.doesNotMatch(html, /data-ac-access-add="u-dee"/)
    const none = draw(createElement(AppControlAccessView, {
      list: [], people: [], apps: apps(), query: '', busy: false,
      onQuery: noop, onAdd: noop, onEdit: noop, onRemove: noop, onMayChange: noop,
    }))
    assert.match(none, /Nobody but you opens App Control/)
  })
})
