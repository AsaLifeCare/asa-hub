// CONFIG BUILDER — the Visual half of the PAGE SCHEMA editor.
// Parses the same JSON text Advanced mode owns, hands the object to the builder family for the page type, and…
import type { PageType } from '@/engine/types'
import { checkConfig } from '../validation'
import ColumnsBuilder from './ColumnsBuilder'
import StagesBuilder from './StagesBuilder'
import WidgetsBuilder from './WidgetsBuilder'
import HeaderStatsBuilder from './HeaderStatsBuilder'
import KeyMapBuilder from './KeyMapBuilder'
import CollectionsBuilder from './CollectionsBuilder'
import ScheduleBuilder from './ScheduleBuilder'
import RowsBuilder from './RowsBuilder'
import ActionsBuilder from './ActionsBuilder'
import { InvalidJsonNotice } from './shared'

export { RowsBuilder }

export default function ConfigBuilder({
  type,
  configText,
  rowIds = [],
  onChange,
}: {
  type: PageType
  configText: string
  /** Current sample-row ids — lets the videos builder offer featuredId as a select. */
  rowIds?: string[]
  onChange: (next: Record<string, unknown>) => void
}) {
  const check = checkConfig(configText)
  if (!check.ok) return <InvalidJsonNotice message={check.message} line={check.line} />
  const config = check.config

  switch (type) {
    case 'sheet':
      return (
        <div className="space-y-4">
          <ColumnsBuilder config={config} onChange={onChange} />
          <ActionsBuilder config={config} onChange={onChange} variant="sheet" />
        </div>
      )
    case 'pipeline':
      return (
        <div className="space-y-4">
          <StagesBuilder config={config} onChange={onChange} variant="pipeline" />
          {/* rowActions only — the pipeline renders config.rowActions on its
              cards, headerActions nowhere. */}
          <ActionsBuilder config={config} onChange={onChange} variant="pipeline" />
        </div>
      )
    case 'board':
      return (
        <div className="space-y-4">
          <StagesBuilder config={config} onChange={onChange} variant="board" />
          {/* rowActions only — the board renders config.rowActions on its
              cards, headerActions nowhere. */}
          <ActionsBuilder config={config} onChange={onChange} variant="board" />
        </div>
      )
    case 'dashboard':
      return <WidgetsBuilder config={config} onChange={onChange} />
    case 'detail':
      return (
        <div className="space-y-4">
          <HeaderStatsBuilder config={config} onChange={onChange} />
          <ActionsBuilder config={config} onChange={onChange} variant="detail" />
        </div>
      )
    case 'gallery':
    case 'checklist':
    case 'timeline':
      return <KeyMapBuilder config={config} onChange={onChange} type={type} />
    case 'documents':
      return <CollectionsBuilder config={config} onChange={onChange} variant="documents" rowIds={rowIds} />
    case 'videos':
      return <CollectionsBuilder config={config} onChange={onChange} variant="videos" rowIds={rowIds} />
    case 'schedule':
      return <ScheduleBuilder config={config} onChange={onChange} />
  }
}
