// NOBODY INHERITS WHERE THE LAST PERSON WAS STANDING (audit, 2026-08-18: "logout does not clear asa-tenant ...
// shared machine: an admin leaves in headquarters, a franchise user signs in, still headquarters").
import { useTenantStore } from '@/stores/useTenantStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { DEFAULT_TENANT_ID } from '@/lib/tenancy'
import { clearPlaceCaches } from '@/lib/reboot'

export function resetPlace(): void {
  try {
    useMemberStore.setState({
      currentMemberId: '', memberName: '', memberRole: '', memberTypes: [],
      memberAvatar: '', memberEmail: '', memberTitle: '', memberScope: '',
    })
    useWorldStore.setState({ currentWorldId: '', worldName: '' })
    // the directory goes too: it is this account's reach, not the machine's
    useTenantStore.setState({
      currentTenantId: DEFAULT_TENANT_ID,
      homeTenantId: DEFAULT_TENANT_ID,
      tenants: [],
      tenantsLoaded: false,
      tenantsLoading: false,
    })
  } catch { /* a store that will not reset must still not stop the sign-out */ }
  try {
    localStorage.removeItem('asa-tenant')
    localStorage.removeItem('asa-world')
    localStorage.removeItem('asa-member')
    // the roster shelf is this account's reach, not the machine's — keyed by user id since 2026-08-20, so a…
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('asa-members-roster')) localStorage.removeItem(k)
    }
  } catch { /* a locked-down browser keeps them; the in-memory reset stands */ }
  // and every ROW the last place left cached — the same purge a crossing does
  clearPlaceCaches()
}
