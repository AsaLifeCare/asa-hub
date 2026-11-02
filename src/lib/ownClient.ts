// A CLIENT'S OWN VIEW — the client key a client-role session reads its own Locations, Clients, SSA and Staff by…
// The relay never takes this key from the page: it reads the account's own row.
import { useAuthStore } from '@/auth/useAuthStore'
import { wornTypes } from '@/lib/badgeAccess'
import { activeMemberId } from '@/stores/useMemberStore'
import { activeTenantId } from '@/stores/useTenantStore'
import { activeWorldId } from '@/stores/useWorldStore'

/** The session's own client key, or '' when this session does not read its own view. */
export function ownClientKey(): string {
  const u = useAuthStore.getState().user
  if (!u || u.isMaster === true) return ''
  if (String(u.role ?? '').trim().toLowerCase() !== 'client') return ''
  if (wornTypes({ types: u.types }).some((t) => t === 'FAMILY' || t === 'SSA')) return ''
  if (activeMemberId() || activeTenantId() || activeWorldId()) return ''
  return String(u.clientKey ?? '').trim()
}
