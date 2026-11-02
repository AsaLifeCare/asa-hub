// Permission registry — the single source of truth for RBAC in asa..
// - `PERMISSIONS` — every capability string in the platform.
import type { ReactNode } from 'react'
import type { Permission, Role } from '@/auth/types'
import { useAuthStore } from '@/auth/useAuthStore'

/** Every permission in the platform (stable order, grouped by area). */
export const PERMISSIONS: readonly Permission[] = [
  'people.view',
  'people.edit',
  'clients.view',
  'clients.edit',
  'schedule.view',
  'schedule.edit',
  'hiring.view',
  'hiring.edit',
  'hiring.interview',
  'hiring.dateManual',
  'hiring.onboardingPortal',
  'knowledge.view',
  'knowledge.edit',
  'academy.view',
  'academy.edit',
  'inventory.view',
  'inventory.edit',
  'expenses.edit',
  'tags.edit',
  'tasks.edit',
  'apps.manage',
  'settings.api',
  'settings.access',
] as const

/** Grouped, labelled permissions for permission-matrix UIs. */
export const PERMISSION_GROUPS: {
  /** Area key = permission prefix before the dot. */
  area: string
  label: string
  perms: { perm: Permission; label: string }[]
}[] = [
  { area: 'people', label: 'People', perms: [
    { perm: 'people.view', label: 'View directory' },
    { perm: 'people.edit', label: 'Edit people' },
  ] },
  { area: 'clients', label: 'Client Care', perms: [
    { perm: 'clients.view', label: 'View clients' },
    { perm: 'clients.edit', label: 'Edit clients' },
  ] },
  { area: 'schedule', label: 'Schedule', perms: [
    { perm: 'schedule.view', label: 'View schedule' },
    { perm: 'schedule.edit', label: 'Edit visits & shifts' },
  ] },
  { area: 'hiring', label: 'Hiring', perms: [
    { perm: 'hiring.view', label: 'View pipeline' },
    { perm: 'hiring.edit', label: 'Move candidates' },
    { perm: 'hiring.interview', label: 'Record interview scorecard' },
    { perm: 'hiring.dateManual', label: 'Enter Date accepted manually' },
    { perm: 'hiring.onboardingPortal', label: 'Open the new hire onboarding portal' },
  ] },
  { area: 'knowledge', label: 'Knowledge', perms: [
    { perm: 'knowledge.view', label: 'Read documents' },
    { perm: 'knowledge.edit', label: 'Write documents' },
  ] },
  { area: 'academy', label: 'Academy', perms: [
    { perm: 'academy.view', label: 'Watch training' },
    { perm: 'academy.edit', label: 'Publish training' },
  ] },
  { area: 'inventory', label: 'Inventory', perms: [
    { perm: 'inventory.view', label: 'View stock' },
    { perm: 'inventory.edit', label: 'Adjust stock' },
  ] },
  { area: 'expenses', label: 'Expenses', perms: [
    { perm: 'expenses.edit', label: 'Approve expenses' },
  ] },
  { area: 'apps', label: 'Apps & tags', perms: [
    { perm: 'apps.manage', label: 'Enable/disable apps' },
    { perm: 'tags.edit', label: 'Edit tags' },
  ] },
  { area: 'tasks', label: 'Task Board', perms: [
    // Your own cards only — the server refuses everybody else's with a 404, so this is a button, not a boundary.
    { perm: 'tasks.edit', label: 'Edit your own task cards' },
  ] },
  { area: 'settings', label: 'Settings', perms: [
    { perm: 'settings.api', label: 'API connection' },
    { perm: 'settings.access', label: 'Access control' },
  ] },
]

const ALL = [...PERMISSIONS]

// Default grants per role.
export const ROLE_PRESETS: Record<Role, readonly Permission[]> = {
  admin: ALL,
  manager: [
    'people.view',
    'clients.view',
    'schedule.view',
    'schedule.edit',
    'hiring.view',
    'hiring.edit',
    'knowledge.view',
    'knowledge.edit',
    'academy.view',
    'academy.edit',
    'inventory.view',
    'tags.edit',
    // A personal board belongs to whoever is signed in; the server decides whose row it is.
    'tasks.edit',
  ],
  staff: [
    'people.view',
    'clients.view',
    'schedule.view',
    'hiring.view',
    'knowledge.view',
    'academy.view',
    'inventory.view',
    // A personal board belongs to whoever is signed in; the server decides whose row it is.
    'tasks.edit',
  ],
  client: [
    'knowledge.view',
    'academy.view',
    // A personal board belongs to whoever is signed in; the server decides whose row it is.
    'tasks.edit',
  ],
  onboarding: [
    'knowledge.view',
    'academy.view',
    // A personal board belongs to whoever is signed in; the server decides whose row it is.
    'tasks.edit',
  ],
  // interview day only: see the pipeline, record the scorecard, nothing else
  interviewer: [
    'hiring.view',
    'hiring.interview',
    // A personal board belongs to whoever is signed in; the server decides whose row it is.
    'tasks.edit',
  ],
}

// Reactive permission check for the signed-in user.
export function useCan(perm: Permission): boolean {
  return useAuthStore((s) => s.can(s.user, perm))
}

// Renders `children` only when the signed-in user holds `perm`, otherwise renders `fallback` (default: nothing).
export function Gate({
  perm,
  fallback = null,
  children,
}: {
  perm: Permission
  fallback?: ReactNode
  children: ReactNode
}): ReactNode {
  return useCan(perm) ? children : fallback
}
