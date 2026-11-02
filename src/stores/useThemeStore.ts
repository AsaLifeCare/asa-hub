// Theme store (design.md §9.5/§10).
// Modes: light | dark | system | auto.
import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'asa-theme'

function resolveAuto(date = new Date()): ResolvedTheme {
  const h = date.getHours()
  return h >= 19 || h < 7 ? 'dark' : 'light'
}

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return resolveAuto()
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  if (root.dataset.theme === theme) return
  root.classList.add('theme-animating')
  root.dataset.theme = theme
  window.setTimeout(() => root.classList.remove('theme-animating'), 250)
}

function loadMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' || v === 'auto' ? v : 'auto'
}

type ThemeState = {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  /** cycles light → dark → system → auto (topbar toggle) */
  cycle: () => void
  /** re-evaluate auto/system (called every minute + on media change) */
  refresh: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: loadMode(),
  resolved: 'light',
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    set({ mode, resolved: resolve(mode) })
    applyTheme(get().resolved)
  },
  cycle: () => {
    const order: ThemeMode[] = ['light', 'dark', 'system', 'auto']
    const next = order[(order.indexOf(get().mode) + 1) % order.length]
    get().setMode(next)
  },
  refresh: () => {
    const resolved = resolve(get().mode)
    set({ resolved })
    applyTheme(resolved)
  },
}))

let started = false
/** Call once at app start: applies initial theme and starts the 1-minute auto re-evaluation. */
export function initTheme() {
  if (started) return
  started = true
  const { resolved, refresh } = useThemeStore.getState()
  applyTheme(resolved)
  useThemeStore.setState({ resolved: resolve(useThemeStore.getState().mode) })
  applyTheme(useThemeStore.getState().resolved)
  window.setInterval(refresh, 60_000)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh)
}
