// asa.
// — multi-tenancy seam.

export type TenantType = 'hq' | 'branch' | 'franchise'

export interface Tenant {
  id: string
  name: string
  type: TenantType
  city: string
  state: string
  staffCount: number
  clientCount: number
  since: string
  status: 'active' | 'onboarding' | 'archived'
}

/** Fallback directory — intentionally empty: real tenants come from the server. */
export const TENANTS: Tenant[] = []

export const DEFAULT_TENANT_ID = 'asa-hq'

/** Live tenant directory — replaced by useTenantStore after `tenantsList`. */
let registry: Tenant[] = TENANTS

/** Feed the server-loaded directory (useTenantStore.loadTenants calls this). */
export function setTenantRegistry(list: Tenant[]): void {
  registry = list.length > 0 ? list : TENANTS
}

export const tenantById = (id: string): Tenant | undefined => registry.find((t) => t.id === id)

export const tenantTypeLabel = (t: Tenant | TenantType): string => {
  const type = typeof t === 'string' ? t : t.type
  return type === 'hq' ? 'Headquarters' : type === 'branch' ? 'Branch' : 'Franchise'
}

// Deterministic tenant assignment for seed data — ~80% HQ, the rest spread across the two owned branches.
export const TENANT_ROTATION: string[] = [
  'asa-hq', 'asa-hq', 'asa-hq', 'asa-dayton', 'asa-hq',
  'asa-hq', 'asa-hq', 'asa-cleveland', 'asa-hq', 'asa-hq',
]

// Tags a seed array with `tenantId` (deterministic rotation, see above).
export const withTenant = <T extends { id: string }>(rows: T[]): (T & { tenantId: string })[] =>
  rows.map((r, i) => ({ ...r, tenantId: TENANT_ROTATION[i % TENANT_ROTATION.length] }))
