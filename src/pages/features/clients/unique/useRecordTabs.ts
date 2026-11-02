// The record's tabs and sections, decided for the EFFECTIVE person (a visit narrows them): which are offered, which…
// Re-decided on every matrix edit.
import { isAllowedWith, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { useRegistryStore } from '@/stores/useRegistryStore'
import {
  FINANCE_APP, currentTab, mayReadFinance, visibleSections, visibleTabs,
  type UniqueTab, type UniqueTabId,
} from './uniqueTabs'

/** The one access checker, asked of the effective person, plus the Client Finances answer. */
function useDoors(): { allowed: (appId: string) => boolean; financeAllowed: boolean } {
  const apps = useRegistryStore((s) => s.apps)
  const role = useEffectiveRole()
  useBadgeRulesVersion()
  return {
    allowed: (appId: string) => isAllowedWith(apps, role, appId),
    financeAllowed: mayReadFinance(role) && isAllowedWith(apps, role, FINANCE_APP),
  }
}

export function useRecordTabs(chosen: string): { tabs: UniqueTab[]; current: UniqueTabId; financeAllowed: boolean } {
  const { allowed, financeAllowed } = useDoors()
  const tabs = visibleTabs(allowed)
  return { tabs, current: currentTab(tabs, chosen), financeAllowed }
}

/** The shared sections this viewer's doors admit, for a screen that carries tabs of its own. */
export function useClientSections(): { sections: UniqueTab[]; financeAllowed: boolean } {
  const { allowed, financeAllowed } = useDoors()
  return { sections: visibleSections(allowed), financeAllowed }
}
