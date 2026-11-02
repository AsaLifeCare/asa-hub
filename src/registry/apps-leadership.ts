// Leadership Dashboard registry — the week, for whoever runs the company.
// A real leadership dashboard on real data: the IT work done on the platform itself, the apps being created, the…
import type { AppManifest, PageSchema } from '@/engine/types'
import { useRegistryStore } from '@/stores/useRegistryStore'

// Fallback schema: if the static route is ever unwired, the generic resolver still renders a real read (this week's…
const leadershipPage: PageSchema = {
  // 'overview' on purpose: a playground draft named "leadership" already lived in at least one browser, and its…
  id: 'overview',
  type: 'sheet',
  title: 'Leadership Board',
  icon: 'briefcase',
  dataSource: { resource: 'callOffs' },
  config: {
    entity: ['call-off', 'call-offs'],
    columns: [
      { key: 'date', label: 'Date', kind: 'date', sortable: true },
      { key: 'employee_name', label: 'Employee' },
      { key: 'type', label: 'Type', kind: 'chip', tintBy: {} },
    ],
    // The Command Deck's two tiles (kill list 4): the page ALSO reads the alerts-triage aggregate and the cached…
    prefetch: [{ resource: 'alertsTriage' }, { resource: 'workforceForecast' }],
  },
}

// The deep workforce read (kill list 8): the old platform's Future Analysis + Future Insights, mounted via…
const workforcePage: PageSchema = {
  id: 'workforce',
  type: 'sheet', // fallback generic type — CUSTOM_PAGES mounts WorkforcePage
  title: 'Workforce analytics',
  icon: 'trending-up',
  dataSource: { resource: 'workforceForecast' },
  config: { entity: ['analysis', 'analyses'], customFeature: 'leadership/WorkforcePage' },
}

export const leadershipManifests: AppManifest[] = [
  {
    id: 'leadership',
    name: 'Leadership Dashboard',
    tagline: 'The week across the company — people, performance, hiring, care, money',
    icon: 'briefcase',
    accent: 'lavender',
    // CORE by default: this sits beside "My asa." as one of the platform's own homes rather than filed under…
    category: 'Core',
    version: '1.0.0',
    // Leadership: the two roles that already read every feed this screen draws from.
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [leadershipPage, workforcePage],
    notifications: ['app'],
  },
]

// Deferred: module-level getState() crashes with a TDZ ReferenceError when Rollup orders this module before the…
queueMicrotask(() => {
  const registered = useRegistryStore.getState().apps
  let changed = false
  let apps = [...registered]
  for (const m of leadershipManifests) {
    const existing = apps.find((a) => a.id === m.id)
    if (existing && existing.source === 'sheet') continue
    apps = existing ? apps.map((a) => (a.id === m.id ? m : a)) : [...apps, m]
    changed = true
  }
  if (changed) useRegistryStore.setState({ apps })
})
