// Support Requests' page switch (components/shared/PageSwitchMenu) beside Refresh: the app's pages this person may
// open, as the sidebar lists them (allowedPages with the same checker), so a page App Control keeps to the master is
// never named to anyone else. One page left draws nothing. Navigates only.
import { useNavigate } from 'react-router'
import PageSwitchMenu, { type SwitchItem } from '@/components/shared/PageSwitchMenu'
import { allowedPages, type AccessChecker } from '@/lib/audience'
import { selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { SUPPORT_DESK_APP_ID } from '@/registry/apps-support-desk'
import { useRegistryStore } from '@/stores/useRegistryStore'
import type { AppManifest } from '@/engine/types'
import type { Role } from '@/auth/types'

/** The menu's pages: the app's own, less the ones the checker refuses. */
export function supportSwitchItems(app: AppManifest | undefined, role: Role | null | undefined,
  isAllowed: AccessChecker): SwitchItem[] {
  return app ? allowedPages(app, role, isAllowed).map((p) => ({ id: p.id, title: p.title })) : []
}

export default function SupportPageSwitch({ current }: { current: string }) {
  const navigate = useNavigate()
  const role = useEffectiveRole()
  const apps = useRegistryStore((s) => s.apps)
  useBadgeRulesVersion()   // an App Control edit re-decides the pages
  const app = apps.find((a) => a.id === SUPPORT_DESK_APP_ID)
  return (
    <PageSwitchMenu
      items={supportSwitchItems(app, role, selectAccessChecker(apps, role))}
      current={current}
      onPick={(id) => { if (id !== current) navigate(`/app/${SUPPORT_DESK_APP_ID}/${id}`) }}
    />
  )
}
