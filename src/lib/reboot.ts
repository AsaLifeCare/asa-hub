// THE ONE REBOOT DOOR.
// Every tenant switch used to throw the person out to the landing page, which in theory means leaving the platform…
import { forgetAllKept } from '@/lib/kept'

// WHAT A RELOAD DOES NOT CLEAR — and why a crossing must clear it by hand: in a franchise the Calendars app was…
const PLACE_DATA_PREFIXES = [
  'asa:cal:',        // the company calendar's seven wells
  'asa:profile:',    // deep staff profiles, documents, rubric reads, comms
  'asa:tp:',         // the talent board and its analysis
  'asa-checklist:',  // which rows somebody ticked, keyed by row id
  'asa-dash-layout:',// widget arrangements naming record ids
]

const PLACE_DATA_KEYS = [
  'asa-bookmarks',          // pins into records of the place you just left
  'asa-context',            // Person Focus — re-scopes the whole shell
  'asa-schedule-people',    // raw person ids on the schedule picker
  'asa-users-directory-v1', // the roster blob (sessionStorage)
]

/** Drop every cached ROW of the place being left. Preferences stay. */
export function clearPlaceCaches(): void {
  try {
    // sessionStorage is caches end to end (roster, slice writes, palette resolutions) and survives a reload — the…
    sessionStorage.clear()
  } catch { /* a locked-down browser keeps its caches; the prefixes still run */ }
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (PLACE_DATA_KEYS.includes(k) || PLACE_DATA_PREFIXES.some((p) => k.startsWith(p))) {
        doomed.push(k)
      }
    }
    doomed.forEach((k) => localStorage.removeItem(k))
  } catch { /* nothing cached is worth failing a crossing over */ }
  // and every kept copy, whatever its name — memory, shelf and database at once (lib/kept).
  try { forgetAllKept() } catch { /* it does not throw; a crossing must not depend on that */ }
}

// EVERY CROSSING WEARS THE LOADING.
function paintCrossing(label: string): void {
  try {
    const el = document.createElement('div')
    el.setAttribute('role', 'status')
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'display:flex', 'flex-direction:column', 'align-items:center',
      'justify-content:center', 'gap:14px',
      'background:var(--bg,#fff)', 'color:var(--text-1,#0f172a)',
      'font:600 15px/1.4 ui-sans-serif,system-ui,sans-serif',
    ].join(';')
    el.innerHTML =
      '<div style="width:34px;height:34px;border-radius:999px;' +
      'border:3px solid rgba(127,127,127,.25);border-top-color:currentColor;' +
      'animation:asa-cross-spin .8s linear infinite"></div>' +
      '<div>' + label.replace(/[<>&]/g, '') + '</div>' +
      '<style>@keyframes asa-cross-spin{to{transform:rotate(360deg)}}</style>'
    document.body.appendChild(el)
  } catch { /* the crossing matters more than its curtain */ }
}

export function rebootIntoWorkspace(label?: string, hash?: string): void {
  clearPlaceCaches()
  paintCrossing(label || 'Loading your workspace…')
  // The caller names where the boot lands; the App Hub is only the default for crossings that have no better ground…
  window.location.hash = hash || '#/apps'
  // long enough to be SEEN, and to cover the beat where the old screens would otherwise still be showing the place…
  window.setTimeout(() => { window.location.reload() }, 700)
}
