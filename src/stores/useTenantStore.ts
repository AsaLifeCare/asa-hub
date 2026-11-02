// Tenant store (zustand, persisted to localStorage key "asa-tenant" — `currentTenantId`/`tenantEpoch` AND the…
// Holds the tenant the current session is "viewing" plus the REAL, server-loaded tenant directory.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_TENANT_ID, setTenantRegistry, tenantById, tenantTypeLabel, type Tenant, type TenantType } from '@/lib/tenancy'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Role } from '@/auth/types'

/** Raw `tenantsList` row — coerced defensively into a Tenant. */
type ServerTenant = {
  id: string | number
  name?: string
  type?: string
  city?: string
  state?: string
  status?: string
  staffCount?: number | string
  clientCount?: number | string
  since?: number | string
}

const TENANT_TYPES: TenantType[] = ['hq', 'branch', 'franchise']

function normalizeTenant(row: ServerTenant): Tenant {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    type: TENANT_TYPES.includes(row.type as TenantType) ? (row.type as TenantType) : 'branch',
    city: String(row.city ?? ''),
    state: String(row.state ?? ''),
    staffCount: Number(row.staffCount) || 0,
    clientCount: Number(row.clientCount) || 0,
    since: row.since == null ? '' : String(row.since),
    status: row.status === 'archived' ? 'archived' : row.status === 'onboarding' ? 'onboarding' : 'active',
  }
}

type TenantState = {
  currentTenantId: string
  // The id of HOME — the account's own HQ row when one exists, the synthetic default only when none does.
  homeTenantId: string
  /** Monotonic counter, bumped on every tenant switch — views can key off it. */
  tenantEpoch: number
  /** Server-loaded directory (archived rows filtered out). Empty until loaded. */
  tenants: Tenant[]
  tenantsLoaded: boolean
  tenantsLoading: boolean
  setTenant: (id: string) => void
  // Fetch `tenantsList`, sync the tenancy registry, heal a stale current id.
  loadTenants: (seed?: ServerTenant[]) => Promise<void>
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set, get) => ({
      currentTenantId: DEFAULT_TENANT_ID,
      homeTenantId: DEFAULT_TENANT_ID,
      tenantEpoch: 0,
      tenants: [],
      tenantsLoaded: false,
      tenantsLoading: false,
      setTenant: (id) => {
        const next = tenantById(id)
        if (!next || next.id === get().currentTenantId) return
        set({ currentTenantId: next.id, tenantEpoch: get().tenantEpoch + 1 })
        toast({
          type: 'info',
          title: `Switched to ${next.name}`,
          body: `${[tenantTypeLabel(next), [next.city, next.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')} — item orders and views now follow this tenant.`,
        })
      },
      // ROWS SOMEBODY ELSE ALREADY PAID FOR (2026-08-20).
      loadTenants: async (seed?: ServerTenant[]) => {
        if (get().tenantsLoading) return
        set({ tenantsLoading: true })
        try {
          const rows = seed ?? await gasAction<ServerTenant[]>('tenantsList')
          const tenants = (Array.isArray(rows) ? rows : []).map(normalizeTenant).filter((t) => t.status !== 'archived')
          // THE HOME TENANT ALWAYS EXISTS — but it is ADOPTED before it is INVENTED.
          const mine = useAuthStore.getState().user?.homeTenant
          let home = (mine ? tenants.find((t) => t.id === mine) : undefined)
            ?? tenants.find((t) => t.id === DEFAULT_TENANT_ID)
            ?? tenants.find((t) => t.type === 'hq')
          if (!home) {
            home = {
              id: DEFAULT_TENANT_ID, name: 'ASA LifeCare — Headquarters', type: 'hq',
              city: '', state: 'OH', staffCount: 0, clientCount: 0, since: '', status: 'active',
            }
            tenants.unshift(home)
          }
          setTenantRegistry(tenants)
          const current = get().currentTenantId
          // A stale id goes HOME, never to whichever row happened first — and a browser healed onto the OLD…
          const stale = !tenants.some((t) => t.id === current)
          set({
            tenants,
            homeTenantId: home.id,
            tenantsLoaded: true,
            tenantsLoading: false,
            ...(stale ? { currentTenantId: home.id } : null),
          })
        } catch (err) {
          set({ tenantsLoading: false })
          throw err
        }
      },
    }),
    {
      name: 'asa-tenant',
      partialize: (s) => ({
        currentTenantId: s.currentTenantId,
        tenantEpoch: s.tenantEpoch,
        tenants: s.tenants,
        homeTenantId: s.homeTenantId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TenantState>
        const tenants = Array.isArray(p.tenants) ? p.tenants : []
        // feed the registry from cache so tenantById resolves at first paint
        if (tenants.length > 0) setTenantRegistry(tenants)
        return {
          ...current,
          ...p,
          tenants,
          // loaded-from-cache: the shell paints now, loadTenants revalidates
          tenantsLoaded: tenants.length > 0,
        }
      },
    },
  ),
)

// Tenants the role may switch to (from the server-loaded list): - admin — everything, including franchise partners…
export function visibleTenants(role: Role | null | undefined, currentTenantId: string): Tenant[] {
  const all = useTenantStore.getState().tenants
  if (role === 'admin') return all
  if (role === 'manager') return all.filter((t) => t.type !== 'franchise')
  const current = all.find((t) => t.id === currentTenantId)
  return current ? [current] : []
}

// AWAY FROM HOME — ONE PREDICATE (audit, 2026-08-18: "server and client compute HOME by different rules ...
export function isAwayTenant(s: Pick<TenantState, 'currentTenantId' | 'homeTenantId' | 'tenantsLoaded'>): boolean {
  return Boolean(s.tenantsLoaded && s.homeTenantId && s.currentTenantId !== s.homeTenantId)
}

// THE ACTIVE TENANT ('' = headquarters) — activeWorldId()'s twin, and the value the /gas envelope carries so the…
export function activeTenantId(): string {
  const s = useTenantStore.getState()
  return isAwayTenant(s) ? s.currentTenantId : ''
}

// Short label for compact chrome (topbar chip): the tenant's NAME — its identity, never the city — the Akron…
export const tenantShortName = (t: Tenant): string => t.name || t.city
