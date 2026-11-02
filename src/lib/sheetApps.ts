// Apps defined in a spreadsheet, merged into the live registry.
// The Hub renders every screen from a schema, so nothing about an app requires it to be written in TypeScript by…
import { gasAction } from '@/features/hiring/shared'
import { applyUninstalled, useRegistryStore } from '@/stores/useRegistryStore'
import type { AppManifest } from '@/engine/types'

export type SheetAppProblem = { row: number; app: string; message: string }

let loaded = false

// Pull the sheet-defined apps in and merge them.
function absorb(res: { apps?: AppManifest[]; problems?: SheetAppProblem[] }): SheetAppProblem[] {
  loaded = true
  const incoming = res.apps ?? []
  if (incoming.length) {
    const current = useRegistryStore.getState().apps
    const bySheet = new Set(incoming.map((a) => a.id))
    useRegistryStore.setState({
      apps: [...current.filter((a) => !bySheet.has(a.id)), ...incoming],
    })
    // every writer of the apps array ends with the personal-choice pass — a sheet-built app someone put away must…
    applyUninstalled()
  }
  return res.problems ?? []
}

// The same answer, arriving from the bundle instead of an execution (2026-08-29).
export function seedSheetApps(res: { apps?: AppManifest[]; problems?: SheetAppProblem[] }): void {
  if (loaded) return
  absorb(res)
}

export async function loadSheetApps(force = false): Promise<SheetAppProblem[]> {
  if (loaded && !force) return []
  try {
    const res = await gasAction<{ apps: AppManifest[]; problems: SheetAppProblem[] }>('appsBuilt', {})
    return absorb(res)
  } catch {
    // No app_builder tab, an older backend, a network blip: the platform is exactly what the code says it is.
    return []
  }
}

