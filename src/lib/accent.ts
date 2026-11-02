// Accent color — per-user preference, localStorage "asa-accent".
// Six curated accents (mint is the default).

export type AccentId = 'mint' | 'blue' | 'lavender' | 'amber' | 'peach' | 'pink'

export interface Accent {
  id: AccentId
  label: string
  /** Base accent — becomes --primary. */
  primary: string
  /** Precomputed ~8% darker shade — becomes --primary-hover. */
  hover: string
}

export const ACCENTS: Accent[] = [
  { id: 'mint', label: 'Mint', primary: '#0E9F6E', hover: '#0d9265' },
  { id: 'blue', label: 'Blue', primary: '#3B82C4', hover: '#3678b4' },
  { id: 'lavender', label: 'Lavender', primary: '#7C6FC4', hover: '#7266b4' },
  { id: 'amber', label: 'Amber', primary: '#C98A2B', hover: '#b97f28' },
  { id: 'peach', label: 'Peach', primary: '#D07B4D', hover: '#bf7147' },
  { id: 'pink', label: 'Pink', primary: '#C25E8A', hover: '#b2567f' },
]

export const DEFAULT_ACCENT: AccentId = 'mint'

const STORAGE_KEY = 'asa-accent'

/** The persisted accent id, falling back to the default. */
export function storedAccent(): AccentId {
  const v = localStorage.getItem(STORAGE_KEY)
  return ACCENTS.some((a) => a.id === v) ? (v as AccentId) : DEFAULT_ACCENT
}

/** Write the accent's CSS variables inline on <html> (overrides both themes). */
export function applyAccent(id: AccentId): void {
  const accent = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]
  const root = document.documentElement
  root.style.setProperty('--primary', accent.primary)
  root.style.setProperty('--primary-hover', accent.hover)
}

/** Persist + apply — the Settings → Appearance picker calls this. */
export function setAccent(id: AccentId): void {
  localStorage.setItem(STORAGE_KEY, id)
  applyAccent(id)
  // durable per-user prefs: sync the bundle to the Hub sheet (debounced)
  void import('./prefsSync').then((m) => m.schedulePrefsPush())
}

let booted = false
/** Apply the stored accent once at boot (idempotent). */
export function initAccent(): void {
  if (booted || typeof document === 'undefined') return
  booted = true
  applyAccent(storedAccent())
}

initAccent()
