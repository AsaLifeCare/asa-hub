// My Profile — the signed-in person's own details, requirements and documents.
// Three bespoke pages (CUSTOM_PAGES 'my-profile/*'), one screen with a left rail.
import type { AppManifest } from '@/engine/types'
import type { PageGate } from '@/lib/pageGate'

export const MY_PROFILE_APP_ID = 'my-profile'
/** App Control's row for My Requirements (lib/featureAccess), asked under the same id by the server (app/my_profile.py
 *  REQS_FEATURE): a badge it does not name is offered My Details and My Docs alone. */
export const MY_REQUIREMENTS_FEATURE = 'my-profile.requirements'
export const MY_PROFILE_PAGES: readonly {
  id: 'details' | 'requirements' | 'docs'; title: string; icon: string; gate?: PageGate; feature?: string
}[] = [
  { id: 'details', title: 'My Details', icon: 'user' },
  { id: 'requirements', title: 'My Requirements', icon: 'shield-check', gate: 'no-client', feature: MY_REQUIREMENTS_FEATURE },
  { id: 'docs', title: 'My Docs', icon: 'file-text', gate: 'no-client' },
]
export type MyProfilePageId = (typeof MY_PROFILE_PAGES)[number]['id']

export const myProfileManifests: AppManifest[] = [
  {
    id: MY_PROFILE_APP_ID,
    name: 'My Profile',
    tagline: 'Your details, your requirements and your documents',
    icon: 'circle-user',
    accent: 'lavender',
    category: 'Workspace',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff', 'client'],
    focusAudience: ['staff'],
    isNew: true,
    enabled: true,
    pages: MY_PROFILE_PAGES.map((p) => ({
      id: p.id,
      type: 'dashboard' as const,
      title: p.title,
      icon: p.icon,
      ...(p.gate ? { gate: p.gate } : {}),
      ...(p.feature ? { feature: p.feature } : {}),
      dataSource: { resource: 'activity' },
      config: { widgets: [] },
    })),
  },
]
