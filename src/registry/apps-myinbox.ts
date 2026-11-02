// My Inbox — the alerts that concern the signed-in person, and their chat.
// Two bespoke pages (CUSTOM_PAGES 'my-inbox/*'), one screen with a Refresh and a page switch in its header.
import type { AppManifest } from '@/engine/types'

export const MY_INBOX_APP_ID = 'my-inbox'
export const MY_INBOX_PAGES = [
  { id: 'alerts', title: 'Alerts', icon: 'bell' },
  { id: 'chat', title: 'Chat', icon: 'message-square' },
] as const
export type MyInboxPageId = (typeof MY_INBOX_PAGES)[number]['id']

export const myInboxManifests: AppManifest[] = [
  {
    id: MY_INBOX_APP_ID,
    name: 'My Inbox',
    tagline: 'The alerts that concern you, and your chat',
    icon: 'inbox',
    accent: 'blue',
    category: 'Workspace',
    version: '1.0.0',
    audience: ['admin', 'manager', 'staff', 'client'],
    focusAudience: ['staff'],
    isNew: true,
    enabled: true,
    pages: MY_INBOX_PAGES.map((p) => ({
      id: p.id,
      type: 'dashboard' as const,
      title: p.title,
      icon: p.icon,
      dataSource: { resource: 'activity' },
      config: { widgets: [] },
    })),
  },
]
