/**
 * THE PAGES ARE CHUNKS; THE SHELL IS NOT.
 *
 * Every screen shipped in one bundle, so each visit downloaded, parsed and ran all of them before the
 * first frame. The resolver's bespoke pages and App.tsx's routes are lazy chunks now (lib/lazyPage).
 * The registry manifests stay in the entry: the sidebar, the palette and every access check read them
 * before any page is opened. A tab older than a deploy reloads once onto the new index, never in a loop.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, Suspense } from 'react'
import { renderToString } from 'react-dom/server'
import { CUSTOM_PAGES } from '@/pages/AppRoutePage'
import { lazyPage, reloadForStaleChunk } from '@/lib/lazyPage'
import SsaProfilesPage from '@/pages/features/ssaprofiles/SsaProfilesPage'
import AppControlPage from '@/pages/features/appcontrol/AppControlPage'
import { appManifests } from '@/registry/apps'
import { useRegistryStore } from '@/stores/useRegistryStore'

const ROOT = process.env.SPA_ROOT ?? process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
const LAZY = Symbol.for('react.lazy')
const kind = (c: unknown) => (c as { $$typeof?: symbol }).$$typeof

/** The default imports a source file takes from `@/pages/…`, by local name. */
function eagerPageImports(src: string): string[] {
  return [...src.matchAll(/^import (\w+)(?:,[^\n]*)? from '@\/pages\/[^']+'/gm)].map((m) => m[1])
}

describe('the resolver\'s bespoke pages are lazy chunks', () => {
  const entries = Object.entries(CUSTOM_PAGES)

  it('every CUSTOM_PAGES entry is a React.lazy component carrying load()', () => {
    assert.ok(entries.length > 100, `the map still holds the platform's screens (${entries.length})`)
    for (const [key, page] of entries) {
      assert.equal(kind(page), LAZY, `${key} is lazy`)
      assert.equal(typeof page.load, 'function', `${key} can be fetched ahead`)
    }
  })

  it('each entry loads to the screen itself, the same component its module exports', async () => {
    assert.equal(await CUSTOM_PAGES['ssa-profiles/profile'].load(), SsaProfilesPage)
    assert.equal(await CUSTOM_PAGES['app-control/board'].load(), AppControlPage)
    const loaded = await Promise.all(entries.map(async ([key, page]) => [key, await page.load()] as const))
    for (const [key, screen] of loaded) {
      assert.ok(typeof screen === 'function' || (typeof screen === 'object' && screen !== null), `${key} resolves to a component`)
      assert.notEqual(kind(screen), LAZY, `${key} resolves past the lazy wrapper`)
    }
  })

  it('AppRoutePage imports no page module eagerly: only the sheet-mode switch, whose map the resolver reads', () => {
    const src = read('src/pages/AppRoutePage.tsx')
    assert.deepEqual(eagerPageImports(src), ['SheetModePage'])
    assert.match(src, /^const PageRenderer = lazyPage\(\(\) => import\('@\/engine\/PageRenderer'\)\)/m, 'the generic renderer is a chunk too')
    assert.doesNotMatch(src, /^import PageRenderer\b/m)
    // the source-reading tests elsewhere keep finding the map's lines as they were
    assert.match(src, /'app-control\/board': AppControlPage/)
  })
})

describe('App.tsx routes pages lazily and keeps the shell eager', () => {
  const app = read('src/App.tsx')

  it('no route page is a static import; the resolver and the world overlay stay in the shell', () => {
    assert.deepEqual(eagerPageImports(app).sort(), ['AppRoutePage', 'WorldHomePage'])
    for (const page of ['LoginPage', 'SettingsPage', 'AppsPage', 'ClientsPage', 'UsersPage', 'OnboardingHome']) {
      assert.match(app, new RegExp(`^const ${page} = lazyPage\\(\\(\\) => import\\('@/`, 'm'), `${page} is a chunk`)
    }
    for (const shell of ['@/components/Layout', '@/auth/useAuthStore', '@/components/shell/DialogHost', '@/lib/snapshotClient']) {
      assert.match(app, new RegExp(`^import [^\\n]* from '${shell}'`, 'm'), `${shell} is imported statically`)
    }
  })

  it('the public routes are held by the boot spinner while their code arrives', () => {
    const open = app.indexOf('<Suspense fallback={<BootScreen />}>')
    assert.ok(open > 0 && open < app.indexOf('<Routes>') && app.indexOf('</Routes>') < app.indexOf('</Suspense>'))
  })

  it('Layout has one boundary per route, inside the error card keyed on the route, drawing the page skeleton', () => {
    const layout = read('src/components/Layout.tsx')
    const at = layout.indexOf('<ErrorBoundary key={pathname}')
    const suspense = layout.indexOf('<Suspense fallback={<PageSkeleton', at)
    assert.ok(at > 0 && suspense > at && layout.indexOf('<Outlet />', suspense) > suspense)
  })
})

describe('the manifests stay in the entry', () => {
  it('every self-registering registry is a static side-effect import of App.tsx', () => {
    const app = read('src/App.tsx')
    const registries = [...app.matchAll(/^import '@\/registry\/([\w-]+)'$/gm)].map((m) => m[1])
    for (const id of ['apps-ops3', 'apps-opsdash', 'apps-potclients', 'apps-guardian', 'apps-forms', 'apps-engine',
      'apps-finance', 'apps-personal', 'apps-leadership', 'apps-ist', 'apps-appcontrol', 'apps-houses', 'apps-timeoff']) {
      assert.ok(registries.includes(id), `${id} is imported eagerly`)
    }
  })

  it('the registry store reads appManifests statically, and nothing in the SPA imports a registry lazily', () => {
    assert.match(read('src/stores/useRegistryStore.ts'), /^import \{ appManifests \} from '@\/registry\/apps'$/m)
    for (const file of ['src/App.tsx', 'src/pages/AppRoutePage.tsx', 'src/components/Layout.tsx', 'src/components/shell/Sidebar.tsx']) {
      assert.doesNotMatch(read(file), /import\(\s*'@\/registry\//, file)
    }
    assert.ok(appManifests.length > 50)
    const held = new Set(useRegistryStore.getState().apps.map((a) => a.id))
    assert.ok(appManifests.every((m) => held.has(m.id)), 'the store holds them the moment it exists')
  })
})

describe('a loaded page draws on the same render', () => {
  it('before its code is in, the boundary draws the fallback; after load(), a fresh render draws the page', async () => {
    const view = (node: ReturnType<typeof createElement>) =>
      renderToString(createElement(Suspense, { fallback: createElement('i', null, 'waiting') }, node))
    const Cold = lazyPage(async () => ({ default: () => createElement('b', null, 'drawn') }))
    assert.match(view(createElement(Cold)), /waiting/)
    const Warm = lazyPage(async () => ({ default: () => createElement('b', null, 'drawn') }))
    await Warm.load()
    assert.match(renderToString(createElement(Warm)), /drawn/, 'no boundary needed: nothing suspends')
  })
})

describe('a tab older than the deploy', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const had = g.location
  let reloads = 0
  const KEY = 'asa-preload-reload-at'
  const pending = <T,>(p: Promise<T>) => Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 40))])
  before(() => {
    Object.defineProperty(globalThis, 'location', { value: { reload: () => { reloads++ } }, configurable: true, writable: true })
  })
  after(() => {
    Object.defineProperty(globalThis, 'location', { value: had, configurable: true, writable: true })
    sessionStorage.removeItem(KEY)
  })

  it('reloads once, then refuses inside the guard', () => {
    sessionStorage.removeItem(KEY)
    reloads = 0
    assert.equal(reloadForStaleChunk(), true)
    assert.equal(reloads, 1)
    assert.equal(reloadForStaleChunk(), false, 'a second failure right after is a real one')
    assert.equal(reloads, 1)
  })

  it('a chunk that fails to arrive reloads and holds the fallback; failing again inside the guard reaches the error card', async () => {
    sessionStorage.removeItem(KEY)
    reloads = 0
    const gone = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
    assert.equal(await pending(lazyPage(gone).load()), 'pending', 'the skeleton stays while the tab reloads')
    assert.equal(reloads, 1)
    await assert.rejects(lazyPage(gone).load(), /Failed to fetch dynamically imported module/)
    assert.equal(reloads, 1, 'never a loop')
  })

  it('when Vite\'s preload guard already caught it (the import answers undefined), the fallback holds', async () => {
    const swallowed = () => Promise.resolve(undefined as unknown as { default: () => null })
    assert.equal(await pending(lazyPage(swallowed).load()), 'pending')
  })

  it('with no storage to remember a reload in, it does not reload at all', () => {
    const store = g.sessionStorage
    reloads = 0
    Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem() { throw new Error('denied') } }, configurable: true, writable: true })
    try {
      assert.equal(reloadForStaleChunk(), false)
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true, writable: true })
    }
    assert.equal(reloads, 0)
  })

  it('main.tsx hands Vite\'s own preload error to the same guard', () => {
    assert.match(read('src/main.tsx'), /addEventListener\('vite:preloadError', \(event\) => \{\n[^\n]*\n\s*if \(reloadForStaleChunk\(\)\) event\.preventDefault\(\)/)
  })
})

describe('the build', () => {
  it('keeps the entry named index-<hash>.js (the served-bundle check reads it) and groups the vendors', () => {
    const cfg = read('vite.config.ts')
    assert.match(cfg, /entryFileNames: 'assets\/index-\[hash\]\.js'/)
    assert.match(cfg, /manualChunks: vendorChunk/)
    for (const chunk of ['vendor-react', 'vendor-icons', 'vendor-charts']) assert.ok(cfg.includes(`'${chunk}'`), chunk)
  })
})
