/** One calendar screen, two views: the page id is the view, and the switch replaces the address so Back leaves. */
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import type { CalendarView } from '@/stores/useUiPrefsStore'
import BuilderView from './BuilderView'
import LiveView from './LiveView'
import { viewPath, type ViewCarry } from './calendarScreen'

export default function HouseCalendarsScreen({ view }: { view: CalendarView }) {
  const navigate = useNavigate()
  const switchView = useCallback((to: CalendarView, at: ViewCarry) => {
    navigate(viewPath(to, at), { replace: true })
  }, [navigate])
  if (view === 'live') return <LiveView onView={switchView} />
  return <BuilderView onView={switchView} />
}
