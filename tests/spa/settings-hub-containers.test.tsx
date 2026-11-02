/**
 * SETTINGS → HUB CONTAINERS — the asa-hub containers on the host, read by the status sidecar through the relay. The
 * section is the master's alone (at home, never a badge's), draws one row per container with its state pill, uptime,
 * image, CPU and memory, and says the sidecar's failure as it is — never an empty list.
 */
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { AppManifest } from '@/engine/types'
import {
  HUB_CONTAINERS_PATH, containerLabel, containerTone, containersFrom, cpuText, memoryText, uptimeText,
  type HubContainer,
} from '@/lib/hubContainers'
import { MASTER_ONLY_SECTIONS, SETTINGS_NAV, configAccessSections, settingsNavFor } from '@/lib/settingsNav'
import { appControlManifest } from '@/registry/apps-appcontrol'
import {
  HUB_CONTAINERS_IDLE, HubContainersBody, useHubContainers, type HubContainersState,
} from '@/pages/settings/HubContainersSection'
import { useMemberStore } from '@/stores/useMemberStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { mountHook } from './react-host'

const ROOT = resolve(process.cwd())
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
const draw = (state: HubContainersState) =>
  renderToString(createElement(HubContainersBody, { state })).replace(/<!-- -->/g, '')

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

const NOW = Date.parse('2026-10-08T12:00:00.000Z')
const SIDECAR = [
  { name: 'asa-hub-snapshot', image: 'asa-intelligence:4.0', state: 'running', status: 'Up 3 hours (healthy)',
    health: 'healthy', started_at: '2026-10-08T09:00:00.000Z', finished_at: null, restart_count: 2,
    cpu_percent: 12.34, mem_used: 1903550464, mem_limit: 6442450944, error: '' },
  { name: 'asa-hub-chat', image: 'asa/hub-chat:local', state: 'running', status: 'Up 2 days (unhealthy)',
    health: 'unhealthy', started_at: '2026-10-06T11:30:00.000Z', finished_at: null, restart_count: 0,
    cpu_percent: 0.3, mem_used: 60715008, mem_limit: 536870912, error: '' },
  { name: 'asa-hub-web', image: 'nginx:alpine', state: 'exited', status: 'Exited (0) 2 hours ago',
    health: '', started_at: '2026-09-14T17:02:18.410Z', finished_at: '2026-10-08T10:00:00.000Z', restart_count: 0,
    cpu_percent: null, mem_used: null, mem_limit: null, error: '' },
  { name: '', state: 'running' },
]
const UNREACHABLE = 'Status sidecar unreachable: it did not answer (ConnectError). No list was read.'

describe('Settings → Hub containers is the master\'s alone', () => {
  beforeEach(() => { useRegistryStore.setState({ apps: apps() }); home() })

  it('is a master-only section, at home only, never offered by badge in Access control', () => {
    assert.ok(MASTER_ONLY_SECTIONS.includes('hubcontainers'))
    assert.equal(SETTINGS_NAV.find((n) => n.id === 'hubcontainers')?.label, 'Hub containers')
    const ids = (isMaster: boolean, user: Who, rules: Record<string, string[]> = {}) =>
      settingsNavFor(apps(), { isAdmin: user.role === 'admin', isMaster, configRules: rules, user: user as never })
        .map((n) => n.id)
    assert.ok(ids(true, MASTER).includes('hubcontainers'))
    assert.ok(!ids(false, DIRECTOR).includes('hubcontainers'), 'another admin never sees it')
    assert.ok(!ids(false, DIRECTOR, { hubcontainers: ['DIRECTOR'] }).includes('hubcontainers'), 'no badge rule opens it')
    assert.ok(!configAccessSections(apps(), false).some((n) => n.id === 'hubcontainers'))
    useTenantStore.setState({ currentTenantId: 'fr-1' })
    assert.ok(!ids(true, MASTER).includes('hubcontainers'), 'away from home it stays home')
  })

  it('the page renders it only through that verdict', () => {
    assert.ok(read('src/pages/SettingsPage.tsx').includes("{has('hubcontainers') && <HubContainersSection />}"))
  })
})

describe('the rows as the screen draws them', () => {
  const rows = containersFrom(SIDECAR)

  it('keeps every named row, drops a nameless one, and reads each one plainly', () => {
    assert.deepEqual(rows.map((c) => c.name), ['asa-hub-snapshot', 'asa-hub-chat', 'asa-hub-web'])
    assert.deepEqual(rows.map((c) => [containerTone(c), containerLabel(c)]),
      [['good', 'healthy'], ['warn', 'unhealthy'], ['bad', 'exited']])
    assert.equal(uptimeText(rows[0], NOW), '3h 0m')
    assert.equal(uptimeText(rows[1], NOW), '2d 0h')
    assert.equal(uptimeText(rows[2], NOW), 'down 2h 0m')
    assert.equal(cpuText(rows[0]), '12.3%')
    assert.equal(cpuText(rows[2]), '—')
    assert.equal(memoryText(rows[0]), '1.8 GiB / 6.0 GiB')
    assert.equal(memoryText(rows[1]), '58 MiB / 512 MiB')
    assert.equal(memoryText(rows[2]), '—')
  })

  it('draws one row per container with its pill, uptime, image, CPU and memory', () => {
    const html = draw({ ...HUB_CONTAINERS_IDLE, status: 'ready', rows, readAt: '2026-10-08T12:00:00.000Z', checkedAt: NOW })
    for (const c of rows) assert.match(html, new RegExp(`data-container="${c.name}"`))
    assert.match(html, /data-container-tone="good"[^>]*>healthy</)
    assert.match(html, /data-container-tone="warn"[^>]*>unhealthy</)
    assert.match(html, /data-container-tone="bad"[^>]*>exited</)
    assert.match(html, /asa-intelligence:4\.0/)
    assert.match(html, /12\.3%/)
    assert.match(html, /1\.8 GiB \/ 6\.0 GiB/)
    assert.match(html, /restarted 2×/)
    assert.doesNotMatch(html, /data-hub-containers-failed/)
  })

  it('says the sidecar failure as it is — never an empty list — and marks old rows as not live', () => {
    const cold = draw({ ...HUB_CONTAINERS_IDLE, status: 'failed', error: UNREACHABLE, checkedAt: NOW })
    assert.match(cold, /data-hub-containers-failed/)
    assert.ok(cold.includes(UNREACHABLE))
    assert.match(cold, /Nothing is shown, because nothing was read\./)
    assert.doesNotMatch(cold, /data-container=|data-hub-containers-empty/)
    const stale = draw({ ...HUB_CONTAINERS_IDLE, status: 'failed', error: UNREACHABLE, rows, checkedAt: NOW })
    assert.match(stale, /data-hub-containers-failed/)
    assert.match(stale, /the last good read/)
    assert.match(stale, /data-container="asa-hub-web"/)
    const empty = draw({ ...HUB_CONTAINERS_IDLE, status: 'ready', rows: [], checkedAt: NOW })
    assert.match(empty, /data-hub-containers-empty/)
  })
})

describe('the section reads through its own relay door', () => {
  const asked: string[] = []
  let answer: () => unknown = () => ({})
  const realFetch = globalThis.fetch
  before(() => {
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url))
      return new Response(JSON.stringify(answer()))
    }) as typeof fetch
  })
  after(() => { globalThis.fetch = realFetch })

  it('adopts the list the relay answered, and holds the error when the sidecar is unreachable', async () => {
    answer = () => ({ status: 200, data: { containers: SIDECAR, read_at: '2026-10-08T12:00:00.000Z' } })
    const h = mountHook(({ on }: { on: boolean }) => useHubContainers(on), { on: true })
    await h.settle(() => h.current.state.status === 'ready')
    assert.equal(h.current.state.status, 'ready')
    assert.deepEqual(h.current.state.rows?.map((c: HubContainer) => c.name), ['asa-hub-snapshot', 'asa-hub-chat', 'asa-hub-web'])
    assert.ok(asked.length > 0 && asked.every((u) => u === HUB_CONTAINERS_PATH))
    answer = () => ({ status: 503, reason: 'unreachable', message: UNREACHABLE })
    h.run(() => { void h.current.refresh() })
    await h.settle(() => h.current.state.status === 'failed')
    assert.equal(h.current.state.status, 'failed')
    assert.equal(h.current.state.error, UNREACHABLE)
    assert.equal(h.current.state.rows?.length, 3, 'a failed read never empties what was read')
    answer = () => ({ status: 404, reason: 'unknown', message: 'Unknown lane.' })
    h.run(() => { void h.current.refresh() })
    await h.settle(() => h.current.state.status === 'refused')
    assert.equal(h.current.state.status, 'refused')
    assert.equal(h.current.state.rows, null)
    h.unmount()
  })

  it('asks nothing while it is not enabled', async () => {
    asked.length = 0
    const h = mountHook(({ on }: { on: boolean }) => useHubContainers(on), { on: false })
    await h.settle(() => false)
    assert.equal(asked.length, 0)
    assert.equal(h.current.state.status, 'idle')
    h.unmount()
  })
})
