// THE "NEW" DOT LASTS ONE DAY.
// Every app wore the icon as though it had just been installed; it stays for one day after an install and no longer.
const KEY = 'asa-app-installed-at'

function readMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string> } catch { return {} }
}

/** Stamp the install moment — called from the one place installs happen. */
export function noteAppInstalled(id: string): void {
  try {
    const m = readMap()
    m[id] = new Date().toISOString()
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch { /* storage blocked — the dot just never shows */ }
}

/** New = installed on this browser within the last day. */
export function appIsNew(id: string): boolean {
  try {
    const at = readMap()[id]
    return !!at && Date.now() - new Date(at).getTime() < 86_400_000
  } catch { return false }
}
