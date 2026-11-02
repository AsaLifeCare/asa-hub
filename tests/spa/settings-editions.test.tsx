/**
 * SETTINGS → EDITIONS — who else makes each app's delicate edits. The section is the master's alone (at home, never a
 * badge's), lists every edition with its key at the front, what it lets a person change and its people, chooses the
 * people in the standard right panel and saves with Apply — the whole list, adopting only what the server answered.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { AppManifest } from '@/engine/types'
import { EDITION_IDS, editionIdsOf, editionsByApp, editionsFrom, editionsPayload, type Edition } from '@/lib/editions'
import { MASTER_ONLY_SECTIONS, SETTINGS_NAV, configAccessSections, settingsNavFor } from '@/lib/settingsNav'
import { appControlManifest } from '@/registry/apps-appcontrol'
import EditionsSection, { EditionPeoplePicker, EditionsView, withEdition } from '@/pages/settings/EditionsSection'
import { acPeopleFrom } from '@/pages/settings/AppControlAccessSection'
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
const ANN: Who = { id: 'u-ann', name: 'Ann', email: 'ann@example.org', role: 'staff', types: [], isMaster: false }

function apps(): AppManifest[] {
  const all = useRegistryStore.getState().apps
  return all.some((a) => a.id === appControlManifest.id) ? all : [...all, appControlManifest]
}

function home() {
  useTenantStore.setState({ currentTenantId: 'hq', homeTenantId: 'hq', tenantsLoaded: true })
  useWorldStore.setState({ currentWorldId: '' })
  useMemberStore.setState({ currentMemberId: '' } as never)
}

/** The server's answer for every edition (six of Locations, four of Clients), every key off and nobody listed, as they ship. */
const SHIPPED = EDITION_IDS.map((id) => ({ id, ...(id.startsWith('clients.')
  ? { app: 'client-profiles', app_name: 'Clients' } : { app: 'locations', app_name: 'Locations' }),
label: `Label ${id}`, description: `What ${id} lets a person change.`, on: false, people: [] as string[] }))

describe('Settings → Editions is the master\'s alone', () => {
  beforeEach(() => { useRegistryStore.setState({ apps: apps() }); home() })

  it('is a master-only section, at home only, never named to anybody else in Access control', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('editions'))
    assert.equal(SETTINGS_NAV.find((n) => n.id === 'editions')?.label, 'Editions')
    const ids = (isMaster: boolean, user: Who) =>
      settingsNavFor(apps(), { isAdmin: user.role === 'admin', isMaster, configRules: {}, user: user as never }).map((n) => n.id)
    assert.ok(ids(true, MASTER).includes('editions'))
    assert.ok(!ids(false, DIRECTOR).includes('editions'), 'another admin never sees it')
    assert.ok(!ids(false, ANN).includes('editions'), 'a person on a list never sees who else is on it')
    assert.ok(!settingsNavFor(apps(), { isAdmin: true, isMaster: false, configRules: { editions: ['ADMIN'] },
      user: DIRECTOR as never }).some((n) => n.id === 'editions'), 'no badge rule opens it')
    assert.ok(!configAccessSections(apps(), false).some((n) => n.id === 'editions'))
    assert.ok(configAccessSections(apps(), true).some((n) => n.id === 'editions'))
    useTenantStore.setState({ currentTenantId: 'fr-1' })
    assert.ok(!ids(true, MASTER).includes('editions'), 'away from home it stays home')
  })

  it('the page renders it only through that verdict', () => {
    assert.ok(read('src/pages/SettingsPage.tsx').includes("{has('editions') && <EditionsSection />}"))
  })
})

describe('the editions as the screen keeps them', () => {
  it('each known edition once, each person once, a key on only for a plain true; an unknown one dropped', () => {
    const list = editionsFrom([
      { id: 'locations.house', app: 'locations', app_name: 'Locations', label: 'House', description: 'd', on: true,
        people: ['u-ann', 'u-ann', ' ', 'u-bo'] },
      { id: 'locations.house', on: false, people: [] },
      { id: 'nope.edition', on: true, people: ['u-x'] },
      { id: 'locations.documents', on: 'yes', people: 'u-ann' },
    ])
    assert.deepEqual(list.map((e) => [e.id, e.on, e.people]), [['locations.house', true, ['u-ann', 'u-bo']],
      ['locations.documents', false, []]])
    assert.deepEqual(editionsPayload(list), [{ id: 'locations.house', on: true, people: ['u-ann', 'u-bo'] },
      { id: 'locations.documents', on: false, people: [] }])
    assert.deepEqual(editionIdsOf(['locations.documents', 'x', 'locations.house']), ['locations.house', 'locations.documents'])
    const clientIds = EDITION_IDS.filter((id) => id.startsWith('clients.'))
    assert.deepEqual(editionsByApp(editionsFrom(SHIPPED)).map((g) => [g.appName, g.editions.length]),
      [['Locations', EDITION_IDS.length - clientIds.length], ['Clients', clientIds.length]])
    const next = withEdition(list, { ...list[1], on: true })
    assert.deepEqual(next.map((e) => e.on), [true, true])
  })

  it('every row draws its key at the front, what it lets a person change, and its people — nobody, said so', () => {
    const list: Edition[] = editionsFrom(SHIPPED).map((e, i) => (i === 0 ? { ...e, on: true, people: ['u-ann'] } : e))
    const html = draw(createElement(EditionsView, {
      list, busy: false, onKey: noop, onChoose: noop,
      people: [{ id: 'u-ann', name: 'Ann Lee', email: 'ann@example.org', avatar: '', role: 'staff' }],
    }))
    for (const id of EDITION_IDS) {
      const row = html.indexOf(`data-edition="${id}"`)
      const key = html.indexOf(`data-edition-key="${id}"`)
      const label = html.indexOf(`>Label ${id}<`)
      assert.ok(row !== -1 && key > row && label > key, `${id}: the key stands before the words`)
      assert.match(html, new RegExp(`What ${id.replace('.', '\\.')} lets a person change`))
    }
    assert.match(html, /data-edition-person="u-ann"/)
    assert.match(html, /Ann Lee/)
    assert.match(html, /Nobody but you\./)
    assert.match(html, /aria-label="Label locations\.house key"/)
    assert.ok(!html.includes('role="dialog"') && !html.includes('aria-modal'))
    const bad = draw(createElement(EditionsView, { list, busy: false, onKey: noop, onChoose: noop, people: [], malformed: true }))
    assert.match(bad, /data-editions-malformed/)
  })

  it('the panel offers active employees, never the master account, and carries the key too', () => {
    const people = acPeopleFrom([
      { id: 'u-boss', email: 'asatech@asalifecare.com', role: 'admin', is_master: true },
      { id: 'u-ann', display_name: 'Ann Lee', email: 'ann@example.org', role: 'staff' },
      { id: 'u-cli', display_name: 'Cli', email: 'cli@example.org', role: 'client' },
    ])
    const html = draw(createElement(EditionPeoplePicker, { draft: editionsFrom(SHIPPED)[0], people, onChange: noop }))
    assert.match(html, /data-edition-picker-person="u-ann"/)
    assert.doesNotMatch(html, /data-edition-picker-person="u-boss"/)
    assert.doesNotMatch(html, /data-edition-picker-person="u-cli"/)
    assert.match(html, /data-edition-picker-key/)
    assert.match(html, /Nobody chosen\./)
  })
})

describe('the section reads and applies through its own doors', () => {
  const calls: { action: string; payload: Record<string, unknown> }[] = []
  let answer: (action: string, payload: Record<string, unknown>) => unknown = () => ({})
  const realFetch = globalThis.fetch
  before(() => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const env = JSON.parse(decodeURIComponent(body.replace(/^body=/, ''))) as { action: string; payload: Record<string, unknown> }
      calls.push({ action: env.action, payload: env.payload ?? {} })
      return new Response(JSON.stringify(answer(env.action, env.payload ?? {})))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('reads editionsGet once; a read that failed is never drawn as "nobody"', async () => {
    answer = (action) => (action === 'editionsGet' ? { status: 200, data: { editions: SHIPPED, malformed: false } }
      : { status: 200, data: [] })
    const h = mountHook(() => EditionsSection(), {})
    await h.settle(() => calls.some((c) => c.action === 'editionsGet'))
    assert.ok(calls.some((c) => c.action === 'editionsGet'))
    h.unmount()
    const src = read('src/pages/settings/EditionsSection.tsx')
    assert.ok(src.includes("gasAction<{ editions?: unknown }>('editionsSet', { editions: editionsPayload(next) })"),
      'every save sends the whole list and adopts the answer')
    assert.match(src, /Nothing is shown, so nothing is saved over a list nobody read/)
    assert.match(src, /data-editions-apply/)
    assert.match(src, /<SidePanel/)
  })
})
