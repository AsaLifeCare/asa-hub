/**
 * SETTINGS → BACK-END PER APP — which engine answers each migrated app's reads. The section is the master's alone (at
 * home, never a badge's), draws each app on Python or its one move there (Apps Script is never offered), reads and moves
 * through the relay's own door, and adopts only what the relay answered.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { AppManifest } from '@/engine/types'
import { MASTER_ONLY_SECTIONS, SETTINGS_NAV, configAccessSections, settingsNavFor } from '@/lib/settingsNav'
import { appControlManifest } from '@/registry/apps-appcontrol'
import BackendsSection, { BACKENDS_PATH, BackendsView, backendViewFrom, switchedWords } from '@/pages/settings/BackendsSection'
import { useAuthStore } from '@/auth/useAuthStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { mountHook } from './react-host'

const ROOT = resolve(process.cwd())
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
const flat = (html: string) => html.replace(/<!-- -->/g, '')
const draw = (node: ReactNode) => flat(renderToString(createElement(MemoryRouter, null, node)))
const noop = () => {}

type Who = { id: string; name: string; email: string; role: string; types: string[]; isMaster: boolean }
const MASTER: Who = { id: 'u-boss', name: 'Boss', email: 'boss@example.org', role: 'admin', types: [], isMaster: true }
const DIRECTOR: Who = { id: 'u-dir', name: 'Dir', email: 'dir@example.org', role: 'admin', types: ['DIRECTOR'], isMaster: false }

function apps(): AppManifest[] {
  const all = useRegistryStore.getState().apps
  return all.some((a) => a.id === appControlManifest.id) ? all : [...all, appControlManifest]
}

function home() {
  useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
  useWorldStore.setState({ currentWorldId: '' })
  useMemberStore.setState({ currentMemberId: '' } as never)
}

/** The relay's answer as it ships: Locations on Apps Script, never switched, Python reachable. */
const SHIPPED = {
  apps: [{ id: 'locations', label: 'Locations', reads: ['locationOverview', 'locationScope', 'locationStaff'],
    backend: 'apps_script', set_by: '', set_at: '' }],
  python: { reachable: true, why: '' }, store_why: '', settling: false,
}

describe('Settings → Back-end per app is the master\'s alone', () => {
  beforeEach(() => { useRegistryStore.setState({ apps: apps() }); home() })

  it('is a master-only section, at home only, never named to anybody else in Access control', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('backends'))
    assert.equal(SETTINGS_NAV.find((n) => n.id === 'backends')?.label, 'Back-end per app')
    const ids = (isMaster: boolean, user: Who) =>
      settingsNavFor(apps(), { isAdmin: user.role === 'admin', isMaster, configRules: {}, user: user as never }).map((n) => n.id)
    assert.ok(ids(true, MASTER).includes('backends'))
    assert.ok(!ids(false, DIRECTOR).includes('backends'), 'another admin never sees it')
    assert.ok(!settingsNavFor(apps(), { isAdmin: true, isMaster: false, configRules: { backends: ['ADMIN'] },
      user: DIRECTOR as never }).some((n) => n.id === 'backends'), 'no badge rule opens it')
    assert.ok(!configAccessSections(apps(), false).some((n) => n.id === 'backends'))
    assert.ok(configAccessSections(apps(), true).some((n) => n.id === 'backends'))
    useTenantStore.setState({ currentTenantId: 'fr-1' })
    assert.ok(!ids(true, MASTER).includes('backends'), 'away from home it stays home')
  })

  it('the page renders it only through that verdict, beside Editions', () => {
    const src = read('src/pages/SettingsPage.tsx')
    assert.ok(src.includes("{has('backends') && <BackendsSection />}"))
    assert.ok(src.indexOf("{has('editions') && <EditionsSection />}") < src.indexOf("{has('backends') && <BackendsSection />}"))
  })
})

describe('the back-ends as the screen keeps them', () => {
  it('reads the relay\'s list; an unknown engine is Apps Script, and an answer that is not the list is none', () => {
    const view = backendViewFrom({ ...SHIPPED, apps: [...SHIPPED.apps, { id: 'other', backend: 'cobol' }, { label: 'x' }] })
    assert.ok(view)
    assert.deepEqual(view.apps.map((a) => [a.id, a.label, a.backend]), [['locations', 'Locations', 'apps_script'],
      ['other', 'other', 'apps_script']])
    assert.equal(view.python.reachable, true)
    assert.equal(backendViewFrom({ apps: 'no' }), null)
    assert.equal(backendViewFrom(null), null)
    assert.match(switchedWords(view.apps[0]), /Never switched/)
    assert.match(switchedWords({ ...view.apps[0], setAt: '2026-10-08T12:00:00Z', setBy: 'Boss' }), /by Boss\.$/)
  })

  it('an app not on Python offers its one move there; one on Python offers nothing; Apps Script is never offered', () => {
    const view = backendViewFrom(SHIPPED)!
    const html = draw(createElement(BackendsView, { view, busy: '', onMove: noop }))
    assert.match(html, /data-backend="locations"/)
    assert.match(html, /data-backend-move="locations"/)
    assert.match(html, /aria-label="Locations: move to Python"/)
    assert.ok(!html.includes('Apps Script'), 'no choice names Apps Script')
    assert.ok(!html.includes('role="switch"') && !html.includes('data-backend-switch'))
    const on = draw(createElement(BackendsView, { view: { ...view, apps: [{ ...view.apps[0], backend: 'python' }] }, busy: '', onMove: noop }))
    assert.match(on, /aria-label="Locations: answered by Python"/)
    assert.match(on, /data-backend-on="locations"/)
    assert.ok(!on.includes('data-backend-move') && !on.includes('<button'), 'nothing moves an app off Python')
    assert.ok(!html.includes('role="dialog"') && !html.includes('aria-modal'))
  })

  it('says why Python cannot answer, and that a recent App Control change waits for the copy', () => {
    const view = backendViewFrom({ ...SHIPPED, python: { reachable: false, why: 'asa-hub-app did not answer (ConnectError).' },
      settling: true })!
    const html = draw(createElement(BackendsView, { view, busy: '', onMove: noop }))
    assert.match(html, /data-backends-python-down/)
    assert.match(html, /asa-hub-app did not answer/)
    assert.match(html, /data-backends-settling/)
  })
})

describe('the section reads and flips through the relay\'s own door', () => {
  const calls: { url: string; method: string; body: string; auth: string }[] = []
  let answer: (method: string, body: string) => unknown = () => ({})
  const realFetch = globalThis.fetch
  before(() => {
    useAuthStore.setState({ token: 'tok-boss' } as never)
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '',
        auth: headers.Authorization ?? '' })
      return new Response(JSON.stringify(answer(init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : '')))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('reads the list once with the session, and a read that failed draws no switch', async () => {
    answer = () => ({ status: 200, data: SHIPPED })
    const h = mountHook(() => BackendsSection(), {})
    await h.settle(() => calls.some((c) => c.url === BACKENDS_PATH))
    const got = calls.find((c) => c.url === BACKENDS_PATH)
    assert.ok(got && got.method === 'GET' && got.auth === 'Bearer tok-boss')
    h.unmount()
    const src = read('src/pages/settings/BackendsSection.tsx')
    assert.ok(src.includes("method: 'POST', body: JSON.stringify({ app: app.id, backend })"), 'a move names one app and one engine')
    assert.ok(src.includes("const backend: Backend = 'python'") && !src.includes("'apps_script')"),
      'the only engine a move names is Python')
    assert.match(src, /Nothing is shown, so nothing is switched blind/)
    assert.doesNotMatch(src, /gasAction/, 'the switch is the relay\'s, never an Apps Script action')
  })
})
