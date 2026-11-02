// THE WORKSPACE SHELF — the sidebar's sections and which app stands in which.
// SERVER-HELD.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_CATEGORY_DEFS,
  FALLBACK_CATEGORY_ID,
  categorySlug,
  mergedCategoryDefs,
  shelfPayload,
  shelfToState,
  type CategoryDef,
  type ShelfSection,
} from '@/lib/categories'
import { toast } from '@/stores/useToastStore'
import { gasAction } from '@/features/hiring/shared'
import type { TintName } from '@/engine/types'

export type NewCategoryInput = { label: string; tint: TintName; icon: string }

// idle → loading → ready | error.
export type ShelfStatus = 'idle' | 'loading' | 'ready' | 'error'

type CategoryState = {
  /** User-created categories (custom: true), in creation order. */
  customCategories: CategoryDef[]
  /** appId → categoryId assignment overrides. */
  appCategory: Record<string, string>
  /** categoryId → ordered app ids (admin drag-reorder; sidebar/App Hub/matrix follow). */
  appOrder: Record<string, string[]>
  /** Built-in category id → display label (rename without moving the id). */
  labelOverrides: Record<string, string>
  // The order the SECTIONS appear in, by category id.
  categoryOrder: string[]
  /** Whether the server's shelf has actually been read this session. */
  status: ShelfStatus
  /** Read the shelf. Called on sign-in and by the card's Retry. */
  load: () => Promise<void>
  /** Adopt server rows (used by the load and after a failed write). */
  adopt: (data: { sections?: ShelfSection[]; placement?: Record<string, string>; order?: Record<string, string[]> }) => void
  /** Create a custom category. Returns the def, or null when the label is taken/empty. */
  addCategory: (input: NewCategoryInput) => CategoryDef | null
  /** Rename a category — customs in place, built-ins via a label override. */
  renameCategory: (id: string, label: string) => void
  /** Delete a custom category; its apps fall back to Manage. */
  removeCategory: (id: string) => void
  /** Assign an app to a category; `null` clears the override (back to manifest category). */
  assignApp: (appId: string, categoryId: string | null) => void
  /** Store the display order of a category's apps (drag-reorder). */
  setAppOrder: (categoryId: string, ids: string[]) => void
  /** Store the order of the sections themselves (drag a heading). */
  setCategoryOrder: (ids: string[]) => void
}

const labelTaken = (defs: CategoryDef[], label: string, exceptId?: string) =>
  defs.some((d) => d.id !== exceptId && d.label.trim().toLowerCase() === label.trim().toLowerCase())

// Debounced whole-shelf push.
let pushTimer: ReturnType<typeof setTimeout> | undefined
function scheduleShelfPush(): void {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    const s = useCategoryStore.getState()
    // The read must have landed.
    if (s.status !== 'ready') return
    const defs = mergedCategoryDefs(s.customCategories, s.labelOverrides, s.categoryOrder)
    void gasAction('appShelfSet', shelfPayload(s, defs)).catch((err) => {
      toast({
        type: 'danger',
        title: 'Sections not saved',
        body: err instanceof Error ? err.message : 'The server did not take the change.',
      })
      void useCategoryStore.getState().load()
    })
  }, 800)
}

export const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      customCategories: [],
      appCategory: {},
      appOrder: {},
      labelOverrides: {},
      categoryOrder: [],
      status: 'idle',

      adopt: (data) => set({ ...shelfToState(data), status: 'ready' }),

      load: async () => {
        set({ status: get().status === 'ready' ? 'ready' : 'loading' })
        try {
          const data = await gasAction<{
            sections?: ShelfSection[]
            placement?: Record<string, string>
            order?: Record<string, string[]>
          }>('appShelfGet', {})
          get().adopt(data ?? {})
        } catch {
          // The kept copy still draws the sidebar; only EDITING is closed.
          set({ status: 'error' })
        }
      },

      addCategory: ({ label, tint, icon }) => {
        const name = label.trim()
        if (!name) {
          toast({ type: 'warning', title: 'Name the category first.' })
          return null
        }
        const defs = mergedCategoryDefs(get().customCategories, get().labelOverrides)
        if (labelTaken(defs, name)) {
          toast({ type: 'warning', title: `A category named “${name}” already exists.` })
          return null
        }
        const def: CategoryDef = {
          id: `custom-${categorySlug(name)}-${Date.now().toString(36)}`,
          label: name,
          tint,
          icon,
          custom: true,
        }
        set((s) => ({ customCategories: [...s.customCategories, def] }))
        scheduleShelfPush()
        toast({ type: 'success', title: `Category “${name}” created`, body: 'It now appears in the sidebar and App Hub once apps are assigned.' })
        return def
      },

      renameCategory: (id, label) => {
        const name = label.trim()
        if (!name) return
        const defs = mergedCategoryDefs(get().customCategories, get().labelOverrides)
        if (labelTaken(defs, name, id)) {
          toast({ type: 'warning', title: `A category named “${name}” already exists.` })
          return
        }
        if (DEFAULT_CATEGORY_DEFS.some((d) => d.id === id)) {
          // Built-in: the label is a display override; the id (what manifests and app assignments key on) never…
          set((s) => ({ labelOverrides: { ...s.labelOverrides, [id]: name } }))
          scheduleShelfPush()
          return
        }
        const cur = get().customCategories.find((c) => c.id === id)
        if (!cur) return
        set((s) => ({
          customCategories: s.customCategories.map((c) => (c.id === id ? { ...c, label: name } : c)),
        }))
        scheduleShelfPush()
      },

      removeCategory: (id) => {
        const cur = get().customCategories.find((c) => c.id === id)
        if (!cur) return
        set((s) => {
          // apps assigned to the deleted category fall back to Manage
          const appCategory: Record<string, string> = {}
          for (const [appId, catId] of Object.entries(s.appCategory)) {
            appCategory[appId] = catId === id ? FALLBACK_CATEGORY_ID : catId
          }
          // drop the deleted category's stored order; its apps become unlisted in Manage and naturally append at…
          const appOrder = { ...s.appOrder }
          delete appOrder[id]
          return { customCategories: s.customCategories.filter((c) => c.id !== id), appCategory, appOrder }
        })
        scheduleShelfPush()
        toast({ type: 'info', title: `Category “${cur.label}” deleted`, body: 'Its apps moved back to Manage.' })
      },

      assignApp: (appId, categoryId) => {
        set((s) => {
          const appCategory = { ...s.appCategory }
          if (categoryId === null) delete appCategory[appId]
          else {
            const defs = [...DEFAULT_CATEGORY_DEFS, ...s.customCategories]
            if (!defs.some((d) => d.id === categoryId)) return {}
            appCategory[appId] = categoryId
          }
          // keep stored per-category orders in sync: drop the app from every list, then append it to the target…
          const appOrder: Record<string, string[]> = {}
          for (const [cid, ids] of Object.entries(s.appOrder)) {
            const next = ids.filter((id) => id !== appId)
            if (next.length > 0) appOrder[cid] = next
          }
          if (categoryId !== null && s.appOrder[categoryId]) {
            appOrder[categoryId] = [...(appOrder[categoryId] ?? []), appId]
          }
          return { appCategory, appOrder }
        })
        scheduleShelfPush()
      },

      setAppOrder: (categoryId, ids) => {
        set((s) => ({ appOrder: { ...s.appOrder, [categoryId]: ids } }))
        scheduleShelfPush()
      },

      setCategoryOrder: (ids) => {
        set({ categoryOrder: ids })
        scheduleShelfPush()
      },
    }),
    {
      name: 'asa-categories',
      // v1 added `appOrder`; v2 added `labelOverrides` and `categoryOrder`.
      version: 3,
      migrate: (persisted) => persisted as CategoryState,
      // `status` never survives the tab: a browser reopening as "ready" would let the first drag push a week-old…
      partialize: (s) => ({
        customCategories: s.customCategories,
        appCategory: s.appCategory,
        appOrder: s.appOrder,
        labelOverrides: s.labelOverrides,
        categoryOrder: s.categoryOrder,
      }) as CategoryState,
    },
  ),
)
