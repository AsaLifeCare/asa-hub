// Sticky toolbar under the topbar: debounced search, filter chips, the ordering dropdown + active-mode pill, export…
import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowUpDown, Check, ChevronDown, LayoutGrid, Rows3, Share2, Shuffle, X } from 'lucide-react'
import { share } from '@/stores/useShareStore'
import SearchInput from '@/components/shared/SearchInput'
import FilterChips, { type ActiveFilter } from '@/components/shared/FilterChips'
import ExportMenu from '@/components/shared/ExportMenu'
import type { ExportColumn } from '@/lib/exportTable'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { PageSchema } from '@/engine/types'
import type { OrderingMode } from './types'
import { ORDERING_MODES } from './ordering'

export function SheetToolbar({
  config,
  schema,
  qRaw,
  onSearch,
  filters,
  onAddFilter,
  onRemoveFilter,
  orderingEnabled,
  ordering,
  setOrdering,
  onReshuffle,
  exportEnabled,
  exportColumns,
  columnEditor,
  rows,
  view,
  setView,
  compact,
  setCompact,
}: {
  config: Record<string, any>
  schema: PageSchema
  qRaw: string
  onSearch: (v: string) => void
  filters: ActiveFilter[]
  onAddFilter: (f: ActiveFilter) => void
  onRemoveFilter: (key: string) => void
  orderingEnabled: boolean
  ordering: OrderingMode
  setOrdering: (m: OrderingMode) => void
  onReshuffle: () => void
  exportEnabled: boolean
  exportColumns: ExportColumn[]
  /** the pencil — rendered by the template, admin-gated there */
  columnEditor?: ReactNode
  rows: any[]
  view: 'table' | 'card'
  setView: (v: 'table' | 'card') => void
  compact: boolean
  setCompact: Dispatch<SetStateAction<boolean>>
}) {
  // A filter's choices come from the DATA when the config asks for it (`fromData: true`) or when it named none at…
  const resolvedFilters = useMemo(
    () =>
      (config.filters ?? []).map((f: any) => {
        if (f.options?.length && !f.fromData) return f
        const seen = new Set<string>()
        for (const r of rows) {
          const v = r?.[f.key]
          if (v !== undefined && v !== null && String(v).trim() !== '') seen.add(String(v))
        }
        return { ...f, options: [...seen].sort((a, b) => a.localeCompare(b)) }
      }),
    [config.filters, rows],
  )

  return (
    <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 bg-bg/85 px-4 pb-3 pt-4 backdrop-blur-md sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 2xl:-mx-8 2xl:px-8">
      <div className="flex flex-wrap items-center gap-3">
        {config.searchable !== false && (
          <SearchInput
            value={qRaw}
            onChange={onSearch}
            className="w-full max-w-full sm:w-[300px]"
            placeholder={config.searchPlaceholder ?? 'Search records…'}
          />
        )}
        {config.filters && (
          <FilterChips
            filters={resolvedFilters}
            active={filters}
            onAdd={onAddFilter}
            onRemove={onRemoveFilter}
          />
        )}
        {orderingEnabled && (
          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Row ordering"
                  className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[13px] font-medium text-text-2 transition-colors duration-150 hover:bg-surface-2"
                >
                  <ArrowUpDown size={14} />
                  Order
                  <ChevronDown size={12} className="text-text-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {ORDERING_MODES.map((m) => (
                  <DropdownMenuItem
                    key={m.key}
                    title={m.hint}
                    onClick={() => setOrdering(m.key)}
                    className={cn(ordering === m.key && 'bg-primary-soft font-semibold text-primary-strong')}
                  >
                    <m.icon size={14} /> {m.label}
                    {ordering === m.key && <Check size={13} className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {ordering !== 'default' && (
              <span className="flex h-7 items-center gap-1 rounded-full bg-primary-soft pl-2.5 pr-1 text-[12px] font-semibold text-primary-strong">
                {(() => {
                  const m = ORDERING_MODES.find((m) => m.key === ordering)
                  return m?.short ?? m?.label
                })()}
                {ordering === 'random' && (
                  <button
                    aria-label="Re-shuffle"
                    title="Re-shuffle"
                    onClick={onReshuffle}
                    className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-surface/60"
                  >
                    <Shuffle size={11} />
                  </button>
                )}
                <button
                  aria-label="Clear ordering (back to default)"
                  title="Back to default order"
                  onClick={() => setOrdering('default')}
                  className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-surface/60"
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
        )}
        {exportEnabled && (
          <div className={cn('flex items-center gap-1', !(config.viewToggle || config.densityToggle) && 'ml-auto')}>
            <ExportMenu
              filename={String(config.exportName ?? config.title ?? schema.title)}
              columns={exportColumns}
              rows={rows}
            />
            {/* Share the table as it stands — same box everywhere, and it
                carries the CURRENT filtered + sorted rows, not the raw sheet. */}
            <button
              type="button"
              aria-label="Share this table"
              title="Share this table"
              onClick={() =>
                share({
                  title: String(config.title ?? schema.title),
                  subtitle: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} — as filtered on screen`,
                  rows,
                  columns: exportColumns,
                  filename: String(config.exportName ?? config.title ?? schema.title),
                  icon: 'table',
                })
              }
              className="grid h-9 w-9 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
            >
              <Share2 size={15} />
            </button>
            {columnEditor}
          </div>
        )}
        {(config.viewToggle || config.densityToggle) && (
          <div className="ml-auto flex items-center gap-1">
            {config.viewToggle && (
              <div className="flex h-9 items-center rounded-sm border border-border bg-surface p-1">
                {(['table', 'card'] as const).map((v) => (
                  <button
                    key={v}
                    aria-label={`${v} view`}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'grid h-7 w-8 place-items-center rounded-[7px] text-text-3 transition-colors duration-150',
                      view === v && 'bg-surface-3 text-text-1',
                    )}
                  >
                    {v === 'table' ? <Rows3 size={15} /> : <LayoutGrid size={15} />}
                  </button>
                ))}
              </div>
            )}
            {config.densityToggle && (
              <button
                aria-label="Toggle row density"
                aria-pressed={compact}
                onClick={() => setCompact((c) => !c)}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-sm border border-border bg-surface text-text-3 transition-colors duration-150 hover:bg-surface-2',
                  compact && 'text-primary',
                )}
              >
                <Rows3 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
