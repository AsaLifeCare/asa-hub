// PSI LOG — a person's own PsiAnywhere sign-in and time clock, inside the Hub (app/psi_log.py, /hub-lanes/psi-log):
// sign in with your PsiAnywhere account, clock in and out the way its Single Entry screen does, and see every step
// kept. App Control decides who opens it; with no row it is the master's alone, as every new app ships.
import type { AppManifest, PageSchema } from '@/engine/types'

// bespoke — AppRoutePage CUSTOM_PAGES resolves 'psi-log/clock' to PsiLogPage
const clockPage: PageSchema = {
  id: 'clock',
  type: 'dashboard',
  title: 'PSI Log',
  icon: 'clock',
  dataSource: { resource: 'activity' },
  config: { widgets: [] },
}

// The collection's pages — everything PsiAnywhere answers about staff, clients and their places, and every punch
// (app/psi_harvest.py): their own App Control row, `psi-log.collection` (lib/featureAccess), the master's alone until
// he names a badge there, whoever the clock is opened to; its lanes ask the same row. Bespoke: CUSTOM_PAGES
// 'psi-log/<id>'.
const dataPage = (id: string, title: string, icon: string): PageSchema => ({
  id, type: 'dashboard', title, icon, feature: 'psi-log.collection', dataSource: { resource: 'activity' },
  config: { widgets: [] },
})

export const psiLogManifests: AppManifest[] = [
  {
    id: 'psi-log',
    name: 'PSI Log',
    tagline: 'Sign in to PsiAnywhere and clock in and out, right here',
    icon: 'clock',
    accent: 'mint',
    category: 'Operations',
    version: '1.0.0',
    audience: ['all'],
    isNew: true,
    enabled: true,
    pages: [
      clockPage,
      dataPage('staff', 'Staff', 'users'),
      dataPage('clients', 'Clients', 'user-round'),
      dataPage('entries', 'Time entries', 'list-checks'),
      dataPage('other', 'Places & codes', 'map-pin'),
      dataPage('collect', 'Collection', 'database'),
      // give an employee a new PsiAnywhere password (PsiResetPage); its own App Control row, psi-log.passwordReset
      { id: 'reset', type: 'dashboard', title: 'Reset Password', icon: 'rotate-ccw', feature: 'psi-log.passwordReset',
        dataSource: { resource: 'activity' }, config: { widgets: [] } },
      // add a client to PsiAnywhere (PsiNewClientPage); its own App Control row, psi-log.newClient
      { id: 'new-client', type: 'dashboard', title: 'New client', icon: 'user-plus', feature: 'psi-log.newClient',
        dataSource: { resource: 'activity' }, config: { widgets: [] } },
    ],
  },
]
