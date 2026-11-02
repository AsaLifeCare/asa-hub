// Barrel for the auth module — wave-2 agents can import everything from '@/auth' (deep imports into the individual…
// Contract doc: src/auth/README.md.
export type { Role, AuthUser, Permission } from '@/auth/types'
export { ROLE_LABEL } from '@/auth/types'
export { PERMISSIONS, PERMISSION_GROUPS, ROLE_PRESETS, useCan, Gate } from '@/auth/permissions'
export { useAuthStore, DEMO_USERS } from '@/auth/useAuthStore'
export type { AuthState, PermissionOverrides } from '@/auth/useAuthStore'
