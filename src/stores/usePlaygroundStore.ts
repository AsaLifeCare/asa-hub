// Playground store (zustand, persisted to localStorage key "asa-playground").
// Home of every app the admin publishes from EDIT IN PLAYGROUND (src/pages/features/playground/PlaygroundPage.tsx).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useRegistryStore } from '@/stores/useRegistryStore'
import type { AppManifest, PageType } from '@/engine/types'
import type { RearrangeToggles } from '@/pages/features/playground/rearrange'
import { isBoundResource } from '@/pages/features/playground/datasource'

/** One page of a playground app, kept as the studio edits it (raw JSON text). */
export type PlaygroundDraftPage = {
  /** Page id inside the app ('main', 'page-2', …) — kebab-case. */
  id: string
  type: PageType
  title: string
  // Data resource the published page points at (`pg_<slug>` / `pg_<slug>_<pageId>`).
  resource: string
  /** Raw JSON object text from the config editor (source of truth). */
  configText: string
  /** Raw JSON array text from the sample-data editor. */
  rowsText: string
  /** Per-page rearrange toggles (what end users may reorder/export/edit). */
  toggles: RearrangeToggles
}

export type PlaygroundApp = {
  /** The published manifest (id is `custom-<slug>`). */
  manifest: AppManifest
  /** One draft per manifest page, same order. */
  pages: PlaygroundDraftPage[]
  createdAt: string // ISO
  updatedAt: string // ISO
}

/** Kebab-case slug for app ids / page ids. */
export function playgroundSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  )
}

// Resource (tab) name for a page of app `custom-<base>`: `pg_<base>` for the first page, `pg_<base>_<pageId>` for…
export function playgroundResource(base: string, pageIndex: number, pageId: string): string {
  const root = `pg_${base.replace(/-/g, '_')}`
  return pageIndex === 0 ? root : `${root}_${pageId.replace(/-/g, '_')}`
}

/** Append a manifest to the live registry store if it isn't there (ops-suite pattern). */
export function registerManifest(manifest: AppManifest) {
  const registered = useRegistryStore.getState().apps
  if (registered.some((a) => a.id === manifest.id)) {
    // A registry entry from loadSheetApps carries source:'sheet' — that lane is the fresher truth (live server…
    if (registered.find((a) => a.id === manifest.id)?.source === 'sheet') return
    // keep the live copy in sync with the persisted one (edits re-publish)
    useRegistryStore.setState({
      apps: registered.map((a) => (a.id === manifest.id ? manifest : a)),
    })
    return
  }
  useRegistryStore.setState({ apps: [...registered, manifest] })
}

function unregisterManifest(id: string) {
  useRegistryStore.setState((s) => ({ apps: s.apps.filter((a) => a.id !== id) }))
}

// Re-register every persisted playground app into the live registry store.
export function ensurePlaygroundAppsRegistered() {
  const { apps } = usePlaygroundStore.getState()
  for (const app of apps) registerManifest(app.manifest)
}

/* ---------------- v1 → v2 migration ---------------- */

type V1PlaygroundApp = {
  manifest: AppManifest
  resource: string
  rows: Record<string, unknown>[]
  createdAt: string
  updatedAt: string
}

/** A v1 entry becomes one draft page from manifest.pages[0] + the old rows. */
function migrateV1App(app: V1PlaygroundApp): PlaygroundApp {
  const page = app.manifest?.pages?.[0]
  const config = page?.config ?? {}
  return {
    manifest: app.manifest,
    pages: [
      {
        id: page?.id ?? 'main',
        type: page?.type ?? 'sheet',
        title: page?.title ?? 'Main',
        resource: app.resource ?? page?.dataSource?.resource ?? 'pg_app',
        configText: JSON.stringify(config, null, 2),
        rowsText: JSON.stringify(app.rows ?? [], null, 2),
        toggles: {
          ordering: config.ordering !== false && config.allowDrag !== false,
          export: config.export !== false,
          inlineEdit: Boolean(config.editForm),
          create: Boolean(config.primaryAction),
        },
      },
    ],
    createdAt: app.createdAt ?? new Date().toISOString(),
    updatedAt: app.updatedAt ?? new Date().toISOString(),
  }
}

type PlaygroundState = {
  apps: PlaygroundApp[]
  /** Upsert by manifest.id; also syncs the live registry store. */
  saveApp: (app: PlaygroundApp) => void
  /** Delete a published app (store + live registry). */
  removeApp: (id: string) => void
  /** Copy a published app under a fresh id. Returns the copy (also registered). */
  duplicateApp: (id: string) => PlaygroundApp | null
}

export const usePlaygroundStore = create<PlaygroundState>()(
  persist(
    (set, get) => ({
      apps: [],

      saveApp: (app) => {
        set((s) => {
          const exists = s.apps.some((a) => a.manifest.id === app.manifest.id)
          return {
            apps: exists
              ? s.apps.map((a) => (a.manifest.id === app.manifest.id ? app : a))
              : [...s.apps, app],
          }
        })
        registerManifest(app.manifest)
      },

      removeApp: (id) => {
        set((s) => ({ apps: s.apps.filter((a) => a.manifest.id !== id) }))
        unregisterManifest(id)
      },

      duplicateApp: (id) => {
        const src = get().apps.find((a) => a.manifest.id === id)
        if (!src) return null
        const taken = new Set(get().apps.map((a) => a.manifest.id))
        let slug = `${src.manifest.id.replace(/^custom-/, '')}-copy`
        let n = 2
        while (taken.has(`custom-${slug}`)) slug = `${slug.replace(/-\d+$/, '')}-${n++}`
        const now = new Date().toISOString()
        // every page gets a fresh resource of its own, named after the copy — except a BINDING to a live resource…
        const pages = src.pages.map((p, i) => ({
          ...p,
          resource: isBoundResource(p.resource) ? p.resource : playgroundResource(slug, i, p.id),
        }))
        const copy: PlaygroundApp = {
          manifest: {
            ...src.manifest,
            id: `custom-${slug}`,
            name: `${src.manifest.name} copy`,
            isNew: true,
            pages: src.manifest.pages.map((p, i) => ({
              ...p,
              dataSource: { ...p.dataSource, resource: pages[i]?.resource ?? playgroundResource(slug, i, p.id) },
            })),
          },
          pages,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ apps: [...s.apps, copy] }))
        registerManifest(copy.manifest)
        return copy
      },
    }),
    {
      name: 'asa-playground',
      version: 2,
      migrate: (persisted, version) => {
        // v1 → v2: single-page entries gain a pages[] draft (see migrateV1App)
        if (version < 2 && persisted && typeof persisted === 'object') {
          const state = persisted as { apps?: unknown[] }
          state.apps = (state.apps ?? []).map((a) => {
            const app = a as V1PlaygroundApp & { pages?: PlaygroundDraftPage[] }
            return Array.isArray(app.pages) ? app : migrateV1App(app)
          })
        }
        return persisted as { apps: PlaygroundApp[] }
      },
    },
  ),
)
