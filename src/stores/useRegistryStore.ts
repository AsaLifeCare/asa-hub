// Registry store (§5).
// App manifests + enable/disable with the required side effects: success toast + system notification ("X was added…
import { create } from 'zustand'
import { appManifests } from '@/registry/apps'
import { toast } from '@/stores/useToastStore'
import { useNotificationStore } from '@/stores/useNotificationStore'
import { tenantById } from '@/lib/tenancy'
import { noteAppInstalled } from '@/lib/appNew'
import { useTenantStore } from '@/stores/useTenantStore'
// safe: @/lib/api and @/auth/useAuthStore never import this store (no cycle)
import { api } from '@/lib/api'
import { useAuthStore } from '@/auth/useAuthStore'
// safe: useWorldStore and features/hiring/shared never import this store
import { activeWorldId } from '@/stores/useWorldStore'
import { gasAction } from '@/features/hiring/shared'
import type { AppManifest, PageSchema, TintName } from '@/engine/types'

// ---------------- USER WORLDS: the world-shaped boot ---------------- IN A WORLD THE STORE MUST NOT SERVE COMPANY…
const WORLD_BASELINE: AppManifest[] = [
  {
    id: 'world-home',
    name: 'World Home',
    tagline: 'Your world — what it is, and everything that lives in it.',
    icon: 'sparkles',
    accent: 'lavender',
    category: 'Core',
    version: '1.0.0',
    audience: ['all'],
    enabled: true,
    // Rendered by the static /app/world-home/home route in App.tsx (inside the world exemption); this schema exists…
    pages: [
      { id: 'home', type: 'dashboard', title: 'Home', icon: 'sparkles', dataSource: { resource: 'activity' }, config: { widgets: [] } },
    ],
  },
  {
    // The id IS 'playground' on purpose: AppRoutePage mounts bespoke screens by `${appId}/${pageId}`, and…
    id: 'playground',
    name: 'World Studio',
    tagline: 'Design an app for your world and publish it.',
    icon: 'flask-conical',
    accent: 'mint',
    category: 'Core',
    version: '1.0.0',
    audience: ['all'],
    enabled: true,
    pages: [
      { id: 'studio', type: 'dashboard', title: 'Studio', icon: 'flask-conical', dataSource: { resource: 'activity' }, config: { widgets: [] } },
    ],
  },
]

// Ids lawful inside the active world: the baseline plus whatever `worldAppsList` has answered this session.
const worldAppIds = new Set(WORLD_BASELINE.map((a) => a.id))

/** The world active AT BOOT — a switch reloads, so this is constant per tab. */
const bootWorldId = activeWorldId()

type RegistryState = {
  apps: AppManifest[]
  // The world's default-apps gallery (WorldDefaults.gs) — filled by loadWorldApps; empty outside a world.
  worldDefaults: WorldDefaultApp[]
  toggleEnabled: (id: string) => void
  getApp: (id: string) => AppManifest | undefined
}

// One entry of the world's default-apps gallery (mirrors worldDefaultsSummary_ in apps-script/WorldDefaults.gs).
export type WorldDefaultApp = {
  id: string
  name: string
  tagline: string
  icon: string
  accent: TintName
  category: string
  pages: number
  installed: boolean
}

// WHICH APPS THIS PERSON HAS PUT AWAY.
const UNINSTALLED_KEY = 'asa-apps-uninstalled'

// THE MIRROR EXCEPTION (2026-09-08, the People test): a person can also install an app whose CODE BASELINE is off…
const INSTALLED_KEY = 'asa-apps-installed'

function readIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const list = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.map(String) : [])
  } catch {
    return new Set()   // a malformed cache decides nothing
  }
}
const readUninstalled = () => readIdSet(UNINSTALLED_KEY)
const readInstalled = () => readIdSet(INSTALLED_KEY)

// One toggle writes BOTH exception lists: off adds to put-away and leaves turned-on; on adds to turned-on and…
function setUninstalled(id: string, off: boolean): void {
  try {
    const offSet = readUninstalled()
    const onSet = readInstalled()
    if (off) { offSet.add(id); onSet.delete(id) }
    else { offSet.delete(id); onSet.add(id) }
    localStorage.setItem(UNINSTALLED_KEY, JSON.stringify([...offSet]))
    localStorage.setItem(INSTALLED_KEY, JSON.stringify([...onSet]))
    void import('@/lib/prefsSync').then((m) => m.schedulePrefsPush())
  } catch {
    /* storage unavailable — the toggle still holds for this session */
  }
}

// The pure half: one apps array with this person's exceptions applied.
function withPersonalChoices(apps: AppManifest[]): AppManifest[] {
  const off = readUninstalled()
  const on = readInstalled()
  if (!off.size && !on.size) return apps
  return apps.map((a) => {
    // put-away wins over turned-on when both name the same id: the sets are kept disjoint by setUninstalled, but a…
    if (off.has(a.id)) return { ...a, enabled: false }
    if (on.has(a.id)) return { ...a, enabled: true, unlisted: false }
    return a
  })
}

// Apply this person's own choices over the code manifests: at boot, after EVERY exit of the merge, and again after…
export function applyUninstalled(): void {
  // The put-away list is a COMPANY memory: 'playground' put away there must not switch the World Studio off inside…
  if (activeWorldId()) return
  useRegistryStore.setState((s) => ({ apps: withPersonalChoices(s.apps) }))
}

export const useRegistryStore = create<RegistryState>((set, get) => ({
  // IN A WORLD the baseline is the world's own two doors, never the company registry (see the USER WORLDS block…
  apps: bootWorldId ? WORLD_BASELINE : withPersonalChoices(appManifests),
  worldDefaults: [],

  // IT NOW REACHES THE SERVER.
  toggleEnabled: (id) => {
    const app = get().apps.find((a) => a.id === id)
    if (!app) return
    const enabled = !app.enabled
    set((s) => ({ apps: s.apps.map((a) => (a.id === id ? { ...a, enabled } : a)) }))
    setUninstalled(id, !enabled)
    // the "new" dot lives for ONE DAY from this moment
    if (enabled) noteAppInstalled(id)

    toast({
      type: 'success',
      title: enabled ? `${app.name} installed` : `${app.name} removed`,
      body: enabled
        ? 'It is back in your sidebar.'
        : 'It leaves your sidebar and its settings. Nothing is deleted — it waits in the App Hub under Available.',
      action: { label: 'Open App Hub', href: '/apps' },
    })
    useNotificationStore.getState().push({
      type: 'system',
      appId: app.id,
      title: enabled ? `${app.name} was added to your workspace` : `${app.name} was removed from your workspace`,
      body: `Version ${app.version} · ${app.tagline}.`,
      href: enabled && app.pages[0] ? `/app/${app.id}/${app.pages[0].id}` : '/apps',
      priority: 'normal',
    })
  },

  getApp: (id) => get().apps.find((a) => a.id === id),
}))

export const selectEnabledApps = (s: { apps: AppManifest[] }) => s.apps.filter((a) => a.enabled)

/* ---------------- tenant-aware overview greeting ---------------- */

type GreetingConfig = { greeting?: { name: string; subtitle: string } }

// Real tenant-switch effect: the Overview dashboard greeting subtitle names the active tenant ("Here's what's…
function applyTenantGreeting(tenantId: string) {
  const tenant = tenantById(tenantId)
  if (!tenant) return
  const subtitle = `Here's what's happening across ${tenant.name} today.`
  useRegistryStore.setState((s) => ({
    apps: s.apps.map((a) =>
      a.id !== 'overview'
        ? a
        : {
            ...a,
            pages: a.pages.map((p) => {
              const greeting = (p.config as GreetingConfig | undefined)?.greeting
              if (!greeting || greeting.subtitle === subtitle) return p
              return { ...p, config: { ...p.config, greeting: { ...greeting, subtitle } } }
            }),
          },
    ),
  }))
}

applyTenantGreeting(useTenantStore.getState().currentTenantId)
useTenantStore.subscribe((state, prev) => {
  if (state.currentTenantId !== prev.currentTenantId) applyTenantGreeting(state.currentTenantId)
})

/* ---------------- dynamic registry (App Studio) ---------------- */

// Server row from the `apps` tab.
type AppsRow = {
  id?: unknown
  name?: unknown
  tagline?: unknown
  icon?: unknown
  accent?: unknown
  category?: unknown
  version?: unknown
  enabled?: unknown
  drag_focus?: unknown
  pages?: unknown
}

// Studio rows whose SCREENS moved inside another surface: they stop being rungs and keep everything else (see the…
const ABSORBED_STUDIO_APPS = new Set(['app_recruitment'])

const KNOWN_TINTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber', 'green']
const asStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const asTint = (v: unknown): TintName | undefined =>
  KNOWN_TINTS.includes(v as TintName) ? (v as TintName) : undefined
/** `enabled` arrives as boolean OR 'true'/'false' string — normalize. */
const asBool = (v: unknown): boolean | undefined =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined

/** Build an AppManifest from a studio row; null when the row is malformed. */
function buildStudioManifest(row: AppsRow): AppManifest | null {
  const id = asStr(row.id)
  if (!id || !Array.isArray(row.pages)) return null
  const pages: PageSchema[] = []
  for (const p of row.pages as any[]) {
    const pid = asStr(p?.id)
    const resource = asStr(p?.dataSource?.resource)
    if (!pid || !asStr(p?.type) || !resource) continue // skip malformed pages
    pages.push({
      id: pid,
      type: p.type,
      title: asStr(p.title) ?? pid,
      icon: asStr(p.icon),
      dataSource: { ...p.dataSource, resource },
      config: p.config && typeof p.config === 'object' ? p.config : {},
    })
  }
  if (pages.length === 0) return null
  return {
    id,
    name: asStr(row.name) ?? id,
    tagline: asStr(row.tagline) ?? 'Imported from Google Sheets.',
    icon: asStr(row.icon) ?? 'table',
    accent: asTint(row.accent) ?? 'blue',
    category: asStr(row.category) ?? 'Imported',
    version: asStr(row.version) ?? '1.0.0',
    isNew: true,
    enabled: asBool(row.enabled) ?? true,
    pages,
  }
}

// Fetch the server `apps` rows and merge them into the live registry: (a) rows matching a registered manifest id →…
export async function initDynamicApps(): Promise<void> {
  // The `apps` tab is company furniture — a world has no override rows, and reading the resource there would only…
  if (activeWorldId()) return
  let rows: AppsRow[]
  try {
    rows = await api.list<AppsRow>('apps')
  } catch {
    // unreachable backend — registry stays code-defined, but the PERSON'S choices still apply: this early return…
    applyUninstalled()
    return
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    // an EMPTY apps tab is this installation's normal state since the migration — it must not disable the…
    applyUninstalled()
    return
  }
  useRegistryStore.setState((s) => {
    const byId = new Map(rows.flatMap((r) => (asStr(r.id) ? [[asStr(r.id)!, r] as const] : [])))
    const apps = s.apps.map((a) => {
      const row = byId.get(a.id)
      if (!row) return a
      return {
        ...a,
        name: asStr(row.name) ?? a.name,
        tagline: asStr(row.tagline) ?? a.tagline,
        icon: asStr(row.icon) ?? a.icon,
        accent: asTint(row.accent) ?? a.accent,
        enabled: asBool(row.enabled) ?? a.enabled,
        dragFocus: asBool(row.drag_focus) ?? a.dragFocus,
      }
    })
    const known = new Set(apps.map((a) => a.id))
    for (const row of rows) {
      // RETIRED IMPORTS (2026-08-17): the Studio-imported System logs was merged into the code-defined `logs` app…
      if (asStr(row.id) === 'app_system_logs') continue
      const m = buildStudioManifest(row)
      if (m && !known.has(m.id)) {
        known.add(m.id)
        // ABSORBED STUDIO APPS — Recruitment is taken in and the app itself killed, its work diluted into the…
        apps.push(ABSORBED_STUDIO_APPS.has(m.id) ? { ...m, unlisted: true } : m)
      }
    }
    return { apps }
  })
  // The person's own choices are applied LAST: a workspace row must not put back an app they put away.
  applyUninstalled()
}

// Self-wired trigger: run the merge once per session as soon as a GAS token exists — sign-in/bootstrap via the auth…
let dynamicAppsToken: string | null = null
function kickDynamicApps() {
  const token = useAuthStore.getState().token
  if (!token || token === dynamicAppsToken) return
  dynamicAppsToken = token
  void initDynamicApps()
}
queueMicrotask(() => {
  kickDynamicApps()
  kickWorldApps()
  useAuthStore.subscribe((state, prev) => {
    if (state.token && state.token !== prev.token) {
      kickDynamicApps()
      kickWorldApps()
    }
  })
})

/* ---------------- USER WORLDS: the world registry lanes ---------------- */

// The user's own apps, from `worldAppsList` — manifests in the exact `appsBuilt` grammar, merged the loadSheetApps…
let worldAppsKey: string | null = null
export async function loadWorldApps(force = false): Promise<void> {
  const world = activeWorldId()
  const token = useAuthStore.getState().token
  if (!world || !token) return
  const key = `${token}::${world}`
  if (!force && worldAppsKey === key) return
  worldAppsKey = key
  let incoming: AppManifest[]
  let defaults: WorldDefaultApp[] = []
  try {
    const res = await gasAction<{ apps?: AppManifest[]; defaults?: WorldDefaultApp[] }>('worldAppsList', {})
    incoming = (res.apps ?? []).map((a) => ({
      ...a,
      source: 'sheet',
      audience: ['all'] as AppManifest['audience'],
      enabled: a.enabled !== false,
    }))
    defaults = res.defaults ?? []
  } catch {
    // an unreachable backend must not wedge the world at two tiles forever — the next kick (next token event /…
    worldAppsKey = null
    return
  }
  for (const a of incoming) worldAppIds.add(a.id)
  const current = useRegistryStore.getState().apps
  const byWorld = new Set(incoming.map((a) => a.id))
  useRegistryStore.setState({
    apps: [...current.filter((a) => !byWorld.has(a.id)), ...incoming],
    worldDefaults: defaults,
  })
}

function kickWorldApps() {
  if (activeWorldId()) void loadWorldApps()
}

// THE WORLD FILTER — the gate that drops every company self-registration.
if (bootWorldId) {
  useRegistryStore.subscribe((state) => {
    let changed = false
    const kept: AppManifest[] = []
    for (const a of state.apps) {
      if (!worldAppIds.has(a.id)) { changed = true; continue }
      if ((a.id === 'world-home' || a.id === 'playground') && !a.enabled) {
        kept.push({ ...a, enabled: true })
        changed = true
      } else {
        kept.push(a)
      }
    }
    if (changed) useRegistryStore.setState({ apps: kept })
  })
}
