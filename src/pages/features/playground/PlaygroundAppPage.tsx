// Runtime renderer for playground-published apps (`custom-*`).
// Two kinds of `custom-*` app reach this route: - SERVER-BACKED: the manifest came from the spreadsheet…
import { Navigate, useParams } from 'react-router'
import type { ComponentType } from 'react'
import PageRenderer, { TEMPLATES, type TemplateProps } from '@/engine/PageRenderer'
import EmptyState from '@/components/shared/EmptyState'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { usePlaygroundStore } from '@/stores/usePlaygroundStore'
import { checkRows } from './validation'

export default function PlaygroundAppPage() {
  const { appId, pageId } = useParams()
  const app = useRegistryStore((s) => s.apps.find((a) => a.id === appId))
  const pgApp = usePlaygroundStore((s) => s.apps.find((a) => a.manifest.id === appId))

  const page = app?.pages.find((p) => p.id === pageId)
  if (!app || !page) return <Navigate to="/apps" replace />

  // server-built manifest (or no local draft at all) → the generic live path
  if (app.source === 'sheet' || !pgApp) {
    return <PageRenderer key={`${appId}/${pageId}`} schema={page} />
  }

  // local draft: inject the rows the studio persisted for THIS page
  const draft = pgApp.pages.find((p) => p.id === page.id) ?? pgApp.pages[0]
  const rowsCheck = checkRows(draft?.rowsText ?? '')
  const rows = rowsCheck.ok ? rowsCheck.rows : []

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-[480px] pt-16">
        <EmptyState
          title={`${app.name} has no data yet`}
          body="Publish it from the playground so the server builds its tab — or add sample rows to the draft."
          action={{ label: 'Open Playground', href: '/app/playground/studio' }}
        />
      </div>
    )
  }

  const Template = TEMPLATES[page.type] as ComponentType<TemplateProps & { record?: any }>
  return (
    <Template
      key={`${appId}/${pageId}`}
      config={page.config}
      data={rows}
      schema={page}
      {...(page.type === 'detail' ? { record: rows[0] } : {})}
    />
  )
}
