// Toast store: routine and urgent stacks, drawn by <Toasts/>.
// `toast(...)` is a plain function for non-React code.
import { create } from 'zustand'
import type { TintName } from '@/engine/types'

export type ToastType = 'success' | 'info' | 'warning' | 'danger'

export type ToastItem = {
  id: string
  type: ToastType
  title: string
  body?: string
  action?: { label: string; href: string }
  /** pinned right until closed */
  urgent?: boolean
  /** its bell row id (`srv-41`): one toast per subject, gone with the subject */
  key?: string
  /** epoch ms when the subject stops being true */
  expiresAt?: number
}

type ToastState = {
  toasts: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => string
  dismiss: (id: string) => void
  /** Take away every toast whose subject no longer holds. */
  retire: (gone: (t: ToastItem) => boolean) => void
}

export const ROUTINE_TOASTS_MAX = 4
export const URGENT_TOASTS_MAX = 5

let seq = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const had = t.key ? get().toasts.find((x) => x.key === t.key) : undefined
    if (had) return had.id
    const id = `toast-${++seq}-${Date.now().toString(36)}`
    set((s) => {
      const next = [...s.toasts, { ...t, id }]
      // each stack is capped on its own
      const keep = new Set([
        ...next.filter((x) => x.urgent).slice(-URGENT_TOASTS_MAX),
        ...next.filter((x) => !x.urgent).slice(-ROUTINE_TOASTS_MAX),
      ].map((x) => x.id))
      return { toasts: next.filter((x) => keep.has(x.id)) }
    })
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  retire: (gone) => {
    const left = get().toasts.filter((t) => !gone(t))
    if (left.length !== get().toasts.length) set({ toasts: left })
  },
}))

export const toast = (t: Omit<ToastItem, 'id'>) => useToastStore.getState().push(t)

export const TOAST_TINT: Record<ToastType, TintName> = {
  success: 'mint',
  info: 'blue',
  warning: 'amber',
  danger: 'pink',
}
