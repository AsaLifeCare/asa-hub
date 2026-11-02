/**
 * THE ENTRY IS MY WORK: a sign-in, and a session that opens the domain or the installed app, land on My Work for
 * every badge App Control releases it to — the master included — and never pass by the Overview first. The two
 * restricted roles keep their own app.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import { useAppsCutStore } from '@/lib/appsCut'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { MY_WORK_HOME, homeRouteFor } from '@/lib/homeRoute'
import { markMatrixLanded, useMatrixLanded } from '@/lib/matrixLanded'
import WelcomePage from '@/pages/WelcomePage'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { container, mountHook } from './react-host'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
// App Control's my-work row as the Core book holds it, less the words that follow another badge
const RELEASED = ['DIRECTOR', 'ADMINISTRATOR', 'ONBOARDING', 'GUARDIAN', 'ADMIN', 'ENTITY', 'STAFF',
  'INTERVIEWER', 'HM', 'MANAGER', 'CLIENT']
const person = (role: string, types: string[], isMaster = false) =>
  ({ id: `u-${role}`, name: 'Ann Roe', email: 'ann@example.org', role, types, isMaster })
const PEOPLE = [
  person('staff', ['STAFF']), person('staff', ['HM']), person('client', ['CLIENT']),
  person('manager', ['MANAGER']), person('admin', ['ADMIN']), person('admin', [], true),
]
const signIn = (user: ReturnType<typeof person> | null) => {
  useAuthStore.setState({ user, token: user ? 'tok' : null } as never)
  useBadgeAccessStore.setState({ rules: { 'my-work': RELEASED }, tenantRules: {}, configRules: {} })
  // Settings > My Work keeps the Overview to the master's own session
  useAppsCutStore.setState({ token: 'tok', ids: ['overview'] })
  if (user) markMatrixLanded('tok')
}
// the landing animates in, and the animation asks the bare test window for a resize listener
const welcome = () => {
  const g = globalThis as unknown as Record<string, unknown>
  const held = { add: g.addEventListener, remove: g.removeEventListener }
  g.addEventListener = held.add ?? (() => {})
  g.removeEventListener = held.remove ?? (() => {})
  try {
    return renderToString(<MemoryRouter initialEntries={['/']}><WelcomePage /></MemoryRouter>)
  } finally {
    g.addEventListener = held.add
    g.removeEventListener = held.remove
  }
}
// the domain's root opened by real React: where the router stands once the page has answered
function enter(): string {
  const router = createMemoryRouter([
    { path: '/', element: <WelcomePage /> },
    { path: '/app/:appId/:pageId', element: null },
  ], { initialEntries: ['/'] })
  const root = createRoot(container())
  try {
    act(() => root.render(<RouterProvider router={router} />))
    return router.state.location.pathname
  } finally {
    act(() => root.unmount())
    router.dispose()
  }
}

afterEach(() => signIn(null))

describe('the entry app is My Work', () => {
  it('a sign-in lands every badge on My Work, the master included', () => {
    assert.ok(useRegistryStore.getState().apps.some((a) => a.id === 'my-work'), 'the registry carries My Work')
    for (const p of PEOPLE) {
      signIn(p)
      assert.equal(homeRouteFor(p.role as never), MY_WORK_HOME, `${p.role} ${p.types.join(',') || 'master'}`)
    }
    assert.equal(MY_WORK_HOME, '/app/my-work/actions')
  })

  it('a trainee and an interview-day account keep their own app, which the My Work door does not serve', () => {
    signIn(person('onboarding', ['ONBOARDING']))
    assert.equal(homeRouteFor('onboarding'), '/app/onboarding/steps')
    signIn(person('interviewer', ['INTERVIEWER']))
    assert.equal(homeRouteFor('interviewer'), '/app/hiring/pipeline')
    const relay = readFileSync(resolve(ROOT, 'server/snapshot_service.py'), 'utf8')
    assert.match(relay, /^_MY_WORK_ROLES_REFUSED = \("onboarding", "interviewer"\)$/m)
  })

  it('a session opening the domain is sent to its home; a visitor still gets the welcome page', () => {
    for (const p of [PEOPLE[0], PEOPLE[5]]) {
      signIn(p)
      assert.equal(enter(), MY_WORK_HOME, `${p.role} opening the domain`)
    }
    signIn(null)
    const html = welcome()
    assert.ok(html.includes('Enter workspace'))
    assert.ok(!html.includes('/app/overview/home'), 'no door on the landing leads to the Overview')
    assert.match(html, /href="\/login"/)
  })

  it('every way in asks the same home, once this sign-in\'s matrix has landed', () => {
    const page = readFileSync(resolve(ROOT, 'src/pages/WelcomePage.tsx'), 'utf8')
    assert.match(page, /if \(user && !landed\)/)
    assert.match(page, /if \(user\) return <Navigate to=\{homeRouteFor\(user\.role\)\} replace \/>/)
    const login = readFileSync(resolve(ROOT, 'src/pages/LoginPage.tsx'), 'utf8')
    // the form no longer chooses: the page does, after the matrix
    assert.doesNotMatch(login, /navigate\(back \?\? homeRouteFor\(signedIn\.role\)/)
    assert.match(login, /if \(user && !landed\) return <LandingWait \/>/)
    assert.match(login, /<Navigate to=\{back \?\? homeRouteFor\(user\.role\)\} replace \/>/)
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8')
    assert.match(app, /if \(signedIn && !landed\) return <BootScreen \/>/)
    assert.match(app, /<Navigate to=\{homeRouteFor\(role\)\} replace \/>/)
  })

  it('a new browser never lands a sign-in on the Overview: it waits for the matrix, and no fallback is the Overview', () => {
    signIn(PEOPLE[0])
    // a new browser: nothing kept, and this sign-in's read not answered yet
    useAuthStore.setState({ token: 'tok-new' } as never)
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} })
    const landed = mountHook(() => useMatrixLanded(), undefined)
    assert.equal(landed.current, false, 'the page waits instead of choosing against an empty matrix')
    assert.notEqual(homeRouteFor('staff'), '/app/overview/home')
    // another session's answer is not this one's
    landed.run(() => markMatrixLanded('tok'))
    assert.equal(landed.current, false)
    useBadgeAccessStore.setState({ rules: { 'my-work': RELEASED } })
    landed.run(() => markMatrixLanded('tok-new'))
    assert.equal(landed.current, true)
    landed.unmount()
    assert.equal(enter(), MY_WORK_HOME)
  })
})
