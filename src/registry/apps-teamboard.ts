// TEAM BOARD — the whole company's work on one wall.
// Modelled on the legacy the old platform's KANBAN app, as close to it as possible and under the same rules: the board shows…
import type { AppManifest, PageSchema } from '@/engine/types'

const boardPage: PageSchema = {
  id: 'board',
  type: 'sheet',
  title: 'Kanban',
  icon: 'square-kanban',
  // The screen is bespoke (columns, drag, a detail drawer); the schema exists so the app has a route, a sidebar…
  dataSource: { resource: 'teamTasks' },
  config: { entity: ['task', 'tasks'], customFeature: 'teamboard/TeamBoardPage' },
}

export const teamBoardManifests: AppManifest[] = [
  {
    id: 'teamboard',
    // "Kanban" is the settled name — it read "Team Board Kanban" for half a day before the second pass shortened it.
    name: 'Kanban',
    tagline: "Everyone's work, one wall — who has what, and what is stuck",
    icon: 'square-kanban',
    accent: 'blue',
    category: 'Workspace',
    version: '1.0.0',
    // Employees.
    audience: ['all', 'admin', 'manager', 'staff'],
    isNew: true,
    enabled: true,
    pages: [boardPage],
    notifications: ['app'],
  },
]
