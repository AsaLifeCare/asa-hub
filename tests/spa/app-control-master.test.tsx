/**
 * APP CONTROL IS THE MASTER'S — hidden from every other account on every
 * surface (sidebar, App Hub and ⌘K all read `visibleManifests` through the one
 * access checker), refused at its route with nothing of it drawn, gone from
 * Settings for everybody else, and immune to a rule row naming a badge. The
 * access maps every session reads keep drawing everybody's other apps.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { MASTER_ONLY_APPS, TENANT_BASIC_APPS, badgeAllowsApp, useBadgeAccessStore } from '@/lib/badgeAccess'
import { isAllowedWith, selectAccessChecker } from '@/lib/appAccess'
import { isManifestVisible, visibleManifests } from '@/lib/audience'
import { MASTER_ONLY_SECTIONS, settingsNavFor } from '@/lib/settingsNav'
import { reachForApp, reachForSection } from '@/lib/badgeReach'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { appControlManifest } from '@/registry/apps-appcontrol'
import AppRoutePage, { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { Breadcrumb } from '@/components/shell/Topbar'
import { personAccessUpdate } from '@/pages/settings/UsersSection'
import type { AppManifest } from '@/engine/types'

const ROOT = resolve(process.cwd())
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

type Who = { id: string; name: string; email: string; role: string; types: string[]; isMaster: boolean }
const MASTER: Who = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const DIRECTOR: Who = { id: 'u-dir', name: 'Dee Rector', email: 'dee@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }
const MANAGER: Who = { id: 'u-man', name: 'Manny', email: 'manny@example.org', role: 'manager', types: ['DIRECTOR'], isMaster: false }
const STAFF: Who = { id: 'u-staff', name: 'Stella', email: 'stella@example.org', role: 'staff', types: [], isMaster: false }

/** Rows naming every badge on App Control, as a matrix written before the rule could. */
const RULES: Record<string, string[]> = {
  'app-control': ['ADMIN', 'DIRECTOR', 'MANAGER', 'ONBOARDING', 'INTERVIEWER'],
  chat: ['ADMIN', 'DIRECTOR', 'MANAGER'],
  users: ['ADMIN', 'MANAGER'],
}

const signIn = (user: Who) => useAuthStore.setState({ user } as never)

function apps(): AppManifest[] {
  const all = useRegistryStore.getState().apps
  return all.some((a) => a.id === appControlManifest.id) ? all : [...all, appControlManifest]
}

describe('App Control is the master\'s, whatever the matrix says', () => {
  beforeEach(() => {
    useRegistryStore.setState({ apps: apps() })
    useBadgeAccessStore.setState({ rules: RULES, tenantRules: {}, configRules: {} })
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  after(() => useAuthStore.setState({ user: null } as never))

  it('is declared master-only once', () => {
    assert.deepEqual([...MASTER_ONLY_APPS], ['app-control'])
    assert.ok(MASTER_ONLY_SECTIONS.includes('appcontrol'))
  })

  it('a rule row naming ADMIN and DIRECTOR opens nothing — the master alone passes', () => {
    assert.equal(badgeAllowsApp('app-control', DIRECTOR, RULES), false)
    assert.equal(badgeAllowsApp('app-control', MANAGER, RULES), false)
    assert.equal(badgeAllowsApp('app-control', null, RULES), false)
    assert.equal(badgeAllowsApp('app-control', MASTER, RULES), true)
    // the same row on an ordinary app still opens it
    assert.equal(badgeAllowsApp('chat', DIRECTOR, RULES), true)
  })

  it('a non-master admin (director) is refused by the one checker; the master is let through', () => {
    signIn(DIRECTOR)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), false)
    signIn(MASTER)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), true)
  })

  it('launcher, sidebar and ⌘K lists (visibleManifests) drop it for a director and keep it for the master', () => {
    signIn(DIRECTOR)
    const theirs = visibleManifests(apps(), { role: 'admin' }, selectAccessChecker(apps(), 'admin')).map((a) => a.id)
    assert.ok(!theirs.includes('app-control'), 'App Control is not on the director\'s launcher')
    // THE ACCESS MAPS STILL REACH A NON-MASTER: their granted apps are all there
    assert.ok(theirs.includes('chat') && theirs.includes('users'), 'the director keeps every app the matrix grants')
    signIn(MASTER)
    const mine = visibleManifests(apps(), { role: 'admin' }, selectAccessChecker(apps(), 'admin')).map((a) => a.id)
    assert.ok(mine.includes('app-control'))
  })

  it('a master visiting somebody carries no pass — the visit is refused like its owner', () => {
    signIn(MASTER)
    useMemberStore.setState({ currentMemberId: 'u-dir', memberName: 'Dee Rector', memberRole: 'admin', memberTypes: ['DIRECTOR'] } as never)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), false)
  })

  it('a restricted role cannot be handed it by naming its own word on the row', () => {
    assert.equal(isManifestVisible(appControlManifest, { role: 'onboarding' }), false)
    assert.equal(isManifestVisible(appControlManifest, { role: 'interviewer' }), false)
  })

  it('the matrix draws every badge dead on its own row', () => {
    const reach = reachForApp(['ADMIN', 'DIRECTOR', 'HM', 'STAFF'], appControlManifest)
    assert.deepEqual(reach.badges, [])
    assert.deepEqual(reach.dropped, ['ADMIN', 'DIRECTOR', 'HM', 'STAFF'])
    assert.ok(reach.why.includes('master'))
  })

  it('Settings → App control (and so its ⌘K entry) is the master\'s alone', () => {
    const ids = (isMaster: boolean, user: Who) =>
      settingsNavFor(apps(), { isAdmin: true, isMaster, configRules: {}, user: user as never }).map((n) => n.id)
    assert.ok(!ids(false, DIRECTOR).includes('appcontrol'))
    assert.ok(ids(false, DIRECTOR).includes('access'), 'the director keeps the sections the platform gave them')
    assert.ok(ids(true, MASTER).includes('appcontrol'))
  })

  it('the Settings page renders the section only through that verdict', () => {
    const page = read('src/pages/SettingsPage.tsx')
    assert.ok(page.includes("{has('appcontrol') && <AppControlSection />}"))
    assert.ok(!page.includes('{isAdmin && <AppControlSection />}'))
  })
})

describe('the route: refused without a frame of it, drawn for the master', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const had = { add: g.addEventListener, remove: g.removeEventListener }
  before(() => {
    g.addEventListener = () => {}
    g.removeEventListener = () => {}
    useRegistryStore.setState({ apps: apps() })
    useBadgeAccessStore.setState({ rules: RULES, tenantRules: {}, configRules: {} })
    useMemberStore.setState({ currentMemberId: '' } as never)
  })
  after(() => {
    g.addEventListener = had.add
    g.removeEventListener = had.remove
    useAuthStore.setState({ user: null } as never)
  })

  // renderToString reads a zustand store's INITIAL state (its server snapshot); the page must see the live one
  const serveLive = () => {
    Object.assign(useRegistryStore.getInitialState(), { apps: useRegistryStore.getState().apps })
    Object.assign(useAuthStore.getInitialState(), { user: useAuthStore.getState().user })
  }
  const open = () => {
    serveLive()
    return renderToString(createElement(MemoryRouter, { initialEntries: ['/app/app-control/board'] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) }))))
  }

  it('has no bare route of its own — it answers only through the resolver\'s guards', () => {
    const app = read('src/App.tsx')
    assert.ok(!app.includes('/app/app-control/'), 'no static /app/app-control route in App.tsx')
    assert.match(read('src/pages/AppRoutePage.tsx'), /'app-control\/board': AppControlPage/)
  })

  it('a director opening the address gets nothing of App Control drawn', () => {
    signIn(DIRECTOR)
    const html = open()
    assert.ok(!html.includes('App Control'), 'not a flash of the screen')
    assert.ok(!html.includes('grant by badge'), 'nor its words')
  })

  it('a manager opening the address gets nothing of it either', () => {
    signIn(MANAGER)
    assert.ok(!open().includes('App Control'))
  })

  it('the master opens it — the same render draws the whole screen, so the refusals above are real', async () => {
    // the screen is a lazy chunk: in before the render, so the render draws it rather than a fallback
    await CUSTOM_PAGES['app-control/board'].load()
    signIn(MASTER)
    const html = open()
    assert.ok(html.includes('App Control'), 'the header')
    assert.ok(html.includes('grant by badge'), 'its words')
  })
})

/** Every place and world test leaves the stores at company ground, at home. */
function home() {
  useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
  useWorldStore.setState({ currentWorldId: '' })
}

describe('the master is never locked out of his own screen by a place', () => {
  beforeEach(() => {
    useRegistryStore.setState({ apps: apps() })
    useBadgeAccessStore.setState({ rules: RULES, tenantRules: {}, configRules: {} })
    useMemberStore.setState({ currentMemberId: '' } as never)
    home()
  })
  after(() => {
    home()
    useAuthStore.setState({ user: null } as never)
  })

  it('a tenant row naming only a franchise does not shut App Control at home', () => {
    useBadgeAccessStore.setState({ tenantRules: { 'app-control': ['fr-1'] } })
    signIn(MASTER)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), true)
    signIn(DIRECTOR)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), false, 'and it hands nobody else a pass')
  })

  it('away from home the master opens it with no tenant row, while an ordinary app stays uninstalled there', () => {
    useTenantStore.setState({ currentTenantId: 'fr-1' })
    signIn(MASTER)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), true)
    const ordinary = apps().find((a) => a.enabled && !TENANT_BASIC_APPS.includes(a.id) && !MASTER_ONLY_APPS.includes(a.id))
    assert.ok(ordinary, 'an app outside the floor exists')
    assert.equal(isAllowedWith(apps(), 'admin', ordinary.id), false, 'the away gate is live in this test')
  })
})

describe('inside a world, no app wearing the id mounts the company screen', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const had = { add: g.addEventListener, remove: g.removeEventListener }
  before(() => {
    g.addEventListener = () => {}
    g.removeEventListener = () => {}
  })
  beforeEach(() => {
    useRegistryStore.setState({ apps: apps() })
    useBadgeAccessStore.setState({ rules: RULES, tenantRules: {}, configRules: {} })
    useMemberStore.setState({ currentMemberId: '' } as never)
    home()
    useWorldStore.setState({ currentWorldId: 'w-selftest' })
  })
  after(() => {
    g.addEventListener = had.add
    g.removeEventListener = had.remove
    home()
    useAuthStore.setState({ user: null } as never)
  })

  it('the world owner and the master are both refused by the checker', () => {
    signIn(STAFF)
    assert.equal(isAllowedWith(apps(), 'staff', 'app-control'), false)
    assert.equal(isAllowedWith(apps(), 'staff', 'app-control', 'board'), false)
    signIn(MASTER)
    assert.equal(isAllowedWith(apps(), 'admin', 'app-control'), false)
  })

  it('the address draws nothing of App Control there', () => {
    signIn(STAFF)
    Object.assign(useRegistryStore.getInitialState(), { apps: useRegistryStore.getState().apps })
    Object.assign(useAuthStore.getInitialState(), { user: useAuthStore.getState().user })
    const html = renderToString(createElement(MemoryRouter, { initialEntries: ['/app/app-control/board'] },
      createElement(Routes, null, createElement(Route, { path: '/app/:appId/:pageId', element: createElement(AppRoutePage) }))))
    assert.ok(!html.includes('grant by badge'))
  })
})

describe('the top bar does not name it for the frame before the guard answers', () => {
  beforeEach(() => {
    useRegistryStore.setState({ apps: apps() })
    useMemberStore.setState({ currentMemberId: '' } as never)
    home()
  })
  after(() => useAuthStore.setState({ user: null } as never))

  const crumb = () => {
    Object.assign(useRegistryStore.getInitialState(), { apps: useRegistryStore.getState().apps })
    Object.assign(useAuthStore.getInitialState(), { user: useAuthStore.getState().user })
    return renderToString(createElement(MemoryRouter, { initialEntries: ['/app/app-control/board'] },
      createElement(Breadcrumb)))
  }

  it('a director sees a generic crumb', () => {
    signIn(DIRECTOR)
    assert.ok(!crumb().includes('App Control'))
  })

  it('the master sees the name', () => {
    signIn(MASTER)
    assert.ok(crumb().includes('App Control'))
  })
})

describe('what stays delegated, and what does not', () => {
  it('the settings-sections matrix offers no badge on a master-only section', () => {
    const all = ['ADMIN', 'DIRECTOR', 'HM', 'STAFF']
    for (const id of MASTER_ONLY_SECTIONS) {
      const reach = reachForSection(all, true, true)
      assert.deepEqual(reach.badges, [], id)
      assert.deepEqual(reach.dropped, all, id)
    }
    assert.ok(reachForSection(all, true).badges.includes('DIRECTOR'), 'an ordinary admin section still offers its badges')
  })

  it('an app\'s own configuration is ordinary work: Clients and Hiring are opened by badge', () => {
    // Three sections of one kind used to sit under three different rules, and
    // the screen told whoever asked that a badge could not open what a badge
    // opens next door.
    for (const id of ['clientsmaster', 'hiringmaster', 'potclientsmaster']) {
      assert.ok(!MASTER_ONLY_SECTIONS.includes(id), id + ' is granted by badge like any other section')
    }
    const all = ['ADMIN', 'DIRECTOR', 'HM', 'STAFF']
    assert.ok(reachForSection(all, true).badges.includes('DIRECTOR'), 'and the badges are really offered')
  })

  it('the app matrix, who else opens it, the platform roster, what My Work shows everybody, who makes each edition, the Hub containers and which engine answers each app stay the master\'s alone', () => {
    assert.deepEqual([...MASTER_ONLY_SECTIONS].sort(),
      ['appcontrol', 'appcontrolaccess', 'backends', 'editions', 'hubcontainers', 'members', 'mywork', 'routes'])
  })

  it('a non-master admin\'s person save carries the capabilities and no denial list', () => {
    const theirs = personAccessUpdate('u1', new Set(['chat']), { 'hiring.interview': true } as never, false)
    assert.deepEqual(Object.keys(theirs).sort(), ['perm_overrides', 'user_id'])
    const mine = personAccessUpdate('u1', new Set(['chat']), {}, true)
    assert.deepEqual(mine.app_denials, ['chat'])
  })
})
