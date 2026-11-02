// REMINDERS — the old platform's Operations → Reminders desk, on Hub data.
// the old platform screen (`/todo`) is a mock list.
import type { AppManifest, PageSchema } from '@/engine/types'

const inboxPage: PageSchema = {
  id: 'inbox',
  type: 'sheet',
  title: 'Reminders',
  icon: 'bell',
  dataSource: { resource: 'reminders' },
  config: { entity: ['reminder', 'reminders'], customFeature: 'reminders/RemindersPage' },
}

export const remindersManifests: AppManifest[] = [
  {
    id: 'reminders',
    name: 'Reminders',
    tagline: "What is due today, what is coming, and what is done — the company's list",
    icon: 'bell',
    accent: 'amber',
    category: 'Operations',
    version: '1.0.0',
    // Employees.
    audience: ['all', 'admin', 'manager', 'staff'],
    isNew: true,
    enabled: true,
    pages: [inboxPage],
    notifications: ['app'],
  },
]
