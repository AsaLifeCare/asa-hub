/**
 * SETTINGS > MY WORK, THE APP LIST: the block is drawn for the master, a matrix the server cut shuts the app for
 * staff on every surface the access checker answers (the route guard included) while the master keeps it, and the
 * list itself lives only in the master's own session.
 */
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { useAuthStore } from '@/auth/useAuthStore'
import type { AppManifest } from '@/engine/types'
import { isAllowedWith } from '@/lib/appAccess'
import {
  APPS_CUT_KEY, adoptAppsCut, appsCutCell, appsCutNow, appsCutOffered, parseAppsCut, useAppsCutStore,
} from '@/lib/appsCut'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { dropAlertsCache, fetchAlerts } from '@/lib/hiringAlerts'
import { MASTER_ONLY_SECTIONS } from '@/lib/settingsNav'
import { AppsCutView, APPS_CUT_LANDS } from '@/pages/settings/AppsCutBody'
import { useMemberStore } from '@/stores/useMemberStore'
import { useRegistryStore } from '@/stores/useRegistryStore'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(<MemoryRouter>{node}</MemoryRouter>))
const noop = () => {}

const base = (): AppManifest => {
  const chat = useRegistryStore.getState().apps.find((a) => a.id === 'chat')
  assert.ok(chat, 'the registry carries the Chat app this test copies')
  return chat
}
const QUIET = 'st-quiet'
const OPEN = 'st-open'
const appsOf = (): AppManifest[] => [
  { ...base(), id: QUIET, name: 'Quiet Board' },
  { ...base(), id: OPEN, name: 'Open Board' },
  { ...base(), id: 'myasa', name: 'My asa.' },
  { ...base(), id: 'app-control', name: 'App Control' },
]
const STAFF = { id: 'u-ann', name: 'Ann Roe', email: 'ann@example.org', role: 'staff', types: ['STAFF'], isMaster: false }
const MASTER = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const WHOLE = { [QUIET]: ['STAFF'], [OPEN]: ['STAFF'] }
const CUT = { [OPEN]: ['STAFF'] }

const signIn = (user: typeof STAFF | typeof MASTER, token: string, rules: Record<string, string[]>) => {
  useAuthStore.setState({ user, token } as never)
  useBadgeAccessStore.setState({ rules, tenantRules: {}, configRules: {} })
}

describe('the block in Settings > My Work', () => {
  it('is drawn inside the master-only section, with a search and a switch for every app it can take', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('mywork'))
    const section = readFileSync(resolve(ROOT, 'src/pages/settings/MyWorkDisplaySection.tsx'), 'utf8')
    assert.ok(section.includes('<AppsCutBody />'))
    const body = readFileSync(resolve(ROOT, 'src/pages/settings/AppsCutBody.tsx'), 'utf8')
    assert.ok(body.includes('Apps — hidden from everyone else'))
    assert.match(body, /gasAction\('hiringAlertsSet', \{ values: \{ \[APPS_CUT_KEY\]: appsCutCell\(next\) \} \}\)/,
      'every flip saves the whole list')
    assert.equal(APPS_CUT_LANDS, 'Everyone else stops seeing it the next time their Hub opens or reloads')

    const html = draw(<AppsCutView apps={appsOf()} ids={[QUIET]} known busy={false} query="" onQuery={noop}
      onFlip={noop} />)
    assert.ok(html.includes('data-apps-search') && html.includes('placeholder="Search apps"'))
    assert.ok(html.includes(`data-app-cut="${QUIET}"`) && html.includes(`data-app-cut="${OPEN}"`))
    assert.ok(!html.includes('data-app-cut="myasa"') && !html.includes('data-app-cut="app-control"'),
      'the floor and a master-only app are never offered')
    assert.ok(html.includes('Quiet Board') && html.includes('Open Board'))
    assert.equal((html.match(/role="switch"/g) ?? []).length, 2)
    assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1)
    assert.match(html, new RegExp(`data-app-cut-word="${QUIET}">Hidden from everyone else<`))
    assert.match(html, new RegExp(`data-app-cut-word="${OPEN}">Shown as released<`))
    assert.ok(!html.includes('handed App Control'), 'no sentence says another account is handed App Control')
  })

  it('the search narrows the list; a backend that does not know the key offers no switch', () => {
    const found = draw(<AppsCutView apps={appsOf()} ids={[]} known busy={false} query="open" onQuery={noop}
      onFlip={noop} />)
    assert.ok(found.includes(`data-app-cut="${OPEN}"`) && !found.includes(`data-app-cut="${QUIET}"`))
    const none = draw(<AppsCutView apps={appsOf()} ids={[]} known busy={false} query="zzz" onQuery={noop}
      onFlip={noop} />)
    assert.ok(none.includes('data-apps-none'))
    const unknown = draw(<AppsCutView apps={appsOf()} ids={[QUIET]} known={false} busy={false} query=""
      onQuery={noop} onFlip={noop} />)
    assert.ok(unknown.includes('data-apps-not-known') && !unknown.includes('role="switch"'))
  })

  it('the cell reads and writes as its ids, once each', () => {
    assert.deepEqual(parseAppsCut(' a, b;a  c ,'), ['a', 'b', 'c'])
    assert.deepEqual(parseAppsCut(undefined), [])
    assert.equal(appsCutCell(['a', 'b', 'a', ' ']), 'a, b')
    assert.equal(appsCutOffered('myasa'), false)
    assert.equal(appsCutOffered('app-control'), false)
    assert.equal(appsCutOffered(OPEN), true)
  })
})

describe('a matrix the server cut', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null, token: null } as never)
    useBadgeAccessStore.setState({ rules: {}, tenantRules: {}, configRules: {} })
    useAppsCutStore.setState({ token: null, ids: [] })
    useMemberStore.setState({ currentMemberId: '', memberName: '', memberRole: '', memberTypes: [] } as never)
  })

  it('shuts the app for staff on the access checker the route guard asks; the master keeps it', () => {
    const apps = appsOf()
    signIn(STAFF, 'tok-ann', WHOLE)
    assert.equal(isAllowedWith(apps, 'staff', QUIET), true, 'released, it opens for staff')
    signIn(STAFF, 'tok-ann', CUT)
    assert.equal(isAllowedWith(apps, 'staff', QUIET), false, 'cut, it is an app never released')
    assert.equal(isAllowedWith(apps, 'staff', OPEN), true, 'the others stay')
    signIn(MASTER, 'tok-boss', WHOLE)
    assert.equal(isAllowedWith(apps, 'admin', QUIET), true, 'the master sees every app')
    const route = readFileSync(resolve(ROOT, 'src/pages/AppRoutePage.tsx'), 'utf8')
    assert.ok(route.includes("if (role !== 'onboarding' && !isAllowedWith(apps, role, app.id)) return <DeniedRedirect"),
      'the route guard asks the same checker')
  })

  it('the list rides the master\'s own config read, for that token alone, and never a non-master\'s', async () => {
    const realFetch = globalThis.fetch
    const answer = { rows: [{ key: APPS_CUT_KEY, value: `${QUIET}, ${QUIET}`, group: 'mywork', note: '' }] }
    let body: unknown = answer
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 200, data: body }))) as typeof fetch
    try {
      signIn(MASTER, 'tok-boss', WHOLE)
      dropAlertsCache()
      await fetchAlerts({ force: true })
      assert.deepEqual(appsCutNow(), [QUIET])
      useAuthStore.setState({ token: 'tok-ann' } as never)
      assert.deepEqual(appsCutNow(), [], 'another token is handed nothing')
      body = { rows: [{ key: 'interview_scorecard_emails', value: '', group: 'access', note: '' }] }
      signIn(STAFF, 'tok-ann', CUT)
      await fetchAlerts({ force: true })
      assert.deepEqual(appsCutNow(), [])
      adoptAppsCut(undefined)
      assert.deepEqual(appsCutNow(), [])
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? ''
        assert.ok(!String(localStorage.getItem(k)).includes(QUIET), `nothing of the list is kept in ${k}`)
      }
    } finally {
      globalThis.fetch = realFetch
      dropAlertsCache()
    }
  })

  it('a visit inside the master\'s session sees a listed app shut, as the server answers the visit', () => {
    const apps = appsOf()
    signIn(MASTER, 'tok-boss', WHOLE)
    useAppsCutStore.setState({ token: 'tok-boss', ids: [QUIET] })
    assert.equal(isAllowedWith(apps, 'admin', QUIET), true)
    useMemberStore.setState({ currentMemberId: 'mem_1', memberName: 'Ann Roe', memberRole: 'staff',
      memberTypes: ['STAFF'] } as never)
    assert.equal(isAllowedWith(apps, 'staff', QUIET), false)
    assert.equal(isAllowedWith(apps, 'staff', OPEN), true)
  })
})
