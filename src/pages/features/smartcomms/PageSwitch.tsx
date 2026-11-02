// Smart Comms' page switch (components/shared/PageSwitchMenu), listing pages from the registry.
// Renders nothing unless the current route is inside the app; navigates only.
import { useLocation, useNavigate } from 'react-router'
import PageSwitchMenu from '@/components/shared/PageSwitchMenu'
import { notificationManifests } from '@/registry/apps-notifications'

/** The app this switch belongs to. Its pages are the menu. */
const APP_ID = 'smartcomms'

export default function PageSwitch() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const app = notificationManifests.find((m) => m.id === APP_ID)
  const pages = app?.pages ?? []

  // Outside this app the menu would be naming somewhere the reader is not.
  if (!pathname.startsWith(`/app/${APP_ID}/`) || pages.length < 2) return null

  return (
    <PageSwitchMenu
      items={pages.map((p) => ({ id: p.id, title: p.title }))}
      current={pathname.split('/')[3] || ''}
      onPick={(id) => navigate(`/app/${APP_ID}/${id}`)}
    />
  )
}
