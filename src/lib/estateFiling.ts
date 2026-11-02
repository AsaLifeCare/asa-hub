// Who may FILE an incident or a repair request, and who may change one after.
// Estate.gs holds the same lists (ESTATE_FILE_ROLES, ESTATE_FILE_COLUMNS) and is the gate; this only decides what a…
import type { Role } from '@/auth/types'

export const FILE_ROLES: readonly Role[] = ['admin', 'manager', 'staff', 'client']

/** The Repairs form's own scale, 1 low … 5 high. */
export const URGENCY_OPTIONS = ['1', '2', '3', '4', '5'] as const

/** The repair columns that are the coordinator's, never a filer's. */
export const COORDINATOR_ONLY = ['status', 'resolution_notes'] as const

export function mayFile(role: string | null | undefined): boolean {
  return FILE_ROLES.includes(role as Role)
}

/** Editing and removing stay with admins and managers. */
export function mayEditEstate(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}
