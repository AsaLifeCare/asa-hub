// Finances registry entry (2026-08-25).
// the old platform Finances doc-hub (`/#/financeiro`, source pages/Financeiro.tsx) re-homed as a hub…
import type { AppManifest } from '@/engine/types'

export const financesManifests: AppManifest[] = [
  {
    id: 'finances',
    name: 'Finances',
    tagline: 'Company finances — every Drive folder tabbed, every document OCR-valued, one click from the source.',
    icon: 'landmark',
    accent: 'mint',
    category: 'Finance',
    version: '0.1.0',
    audience: ['admin', 'manager'],
    isNew: true,
    enabled: true,
    pages: [
      {
        id: 'overview',
        // bespoke screen — AppRoutePage CUSTOM_PAGES resolves 'finances/overview' to FinancesPage; the schema stays…
        type: 'dashboard',
        title: 'Company Finances',
        icon: 'landmark',
        dataSource: { resource: 'finances' },
        config: {
          widgets: [],
          // the Overview tab ALSO reads the old platform's cached Company Finances summary (KPIs · expense breakdown…
          prefetch: [{ resource: 'financeSummary' }],
        },
      },
    ],
  },
]
