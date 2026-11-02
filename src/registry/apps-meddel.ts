// Med Delegation — the five-phase renewal MedDel.gs has been running unattended since 2026-08-10 with no screen to…
// WIRING: spread into appManifests in src/registry/apps.ts; mounted via CUSTOM_PAGES in src/pages/AppRoutePage.tsx…
import type { AppManifest, PageSchema } from '@/engine/types'

const flowsPage: PageSchema = {
  id: 'flows',
  type: 'sheet',
  title: 'Delegation flows',
  icon: 'pill',
  // No generic resource: the screen calls the declared actions directly.
  dataSource: { resource: 'medDelFlows' },
  config: {
    entity: ['flow', 'flows'],
    customFeature: 'meddel/MedDelPage',
  },
}

export const medDelManifests: AppManifest[] = [
  {
    id: 'med-delegation',
    name: 'Med Delegation',
    tagline: 'Application to renewed certification, five phases, chased by the engine',
    icon: 'pill',
    accent: 'lavender',
    category: 'Care',
    version: '1.0.0',
    // A menu, never a lock: MedDel.gs refuses by role before the handler.
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [flowsPage],
  },
]
