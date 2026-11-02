// INCIDENTS — one page, four views: richer views beside the plain row list, in the unified-page shape this platform…
// Log the engine sheet exactly as it always was — its schema comes OFF THE REGISTRY (the runtime truth), so MUI…
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import PageRenderer from '@/engine/PageRenderer'
import RenderSheetPage from '@/pages/features/rendersheet/RenderSheetPage'
import { useRegistryStore } from '@/stores/useRegistryStore'
import type { PageSchema } from '@/engine/types'
import IncidentsBoard from './IncidentsBoard'

const VIEWS = ['log', 'board', 'trail', 'sheet'] as const
type IncView = (typeof VIEWS)[number]
const isView = (v: unknown): v is IncView => VIEWS.includes(v as IncView)

/** Every named field exists on the live mirror — nothing invented. */
const TRAIL_SCHEMA: PageSchema = {
  id: 'trail',
  type: 'timeline',
  title: 'Incident trail',
  icon: 'siren',
  dataSource: { resource: 'uiIncidents' },
  config: {
    entity: 'incidents',
    timeKey: 'incident_date',
    titleKey: 'incident_category',
    bodyKey: 'summary_of_incident',
    actorKey: 'your_name',
    kindKey: 'incident_category',
    kindTints: { 'Medication related error': 'pink', Fall: 'amber', Behavior: 'lavender', Injury: 'peach', MUI: 'blue' },
    subjectKey: 'client_name',
  },
}

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<IncView>(() => {
    const asked = params.get('view')
    return isView(asked) ? asked : 'log'
  })
  const pickView = useCallback((next: string) => {
    if (!isView(next)) return
    setView(next)
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('view', next)
      return p
    }, { replace: true })
  }, [setParams])

  const apps = useRegistryStore((s) => s.apps)
  const logSchema = apps.find((a) => a.id === 'incidents')?.pages.find((p) => p.id === 'log')

  return (
    <div className="w-full">
      <div className="mb-3 flex justify-end">
        <SegmentedTabs
          tabs={[
            { id: 'log', label: 'Log' },
            { id: 'board', label: 'Board' },
            { id: 'trail', label: 'Trail' },
            { id: 'sheet', label: 'Sheet' },
          ]}
          value={view}
          onChange={pickView}
        />
      </div>
      {view === 'log' && logSchema && <PageRenderer schema={logSchema} />}
      {view === 'board' && <IncidentsBoard logSchema={logSchema} />}
      {view === 'trail' && <PageRenderer schema={TRAIL_SCHEMA} />}
      {view === 'sheet' && <RenderSheetPage pin="uis and muis" pinTitle="UIs and MUIs" />}
    </div>
  )
}
