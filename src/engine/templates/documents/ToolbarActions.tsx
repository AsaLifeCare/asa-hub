// PageHeader actions for the library view — search, sort menu, export, import, Create → Document/Course menu (moved…
import { useRef } from 'react'
import { ArrowDownWideNarrow, ArrowUpDown, Check, FileText, FileType, GraduationCap, Import, Link2, Pencil, Plus, Shuffle } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import SearchInput from '@/components/shared/SearchInput'
import ExportMenu from '@/components/shared/ExportMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Gate } from '@/auth/permissions'
import type { Doc } from '@/engine/types'
import type { ExportColumn } from '@/lib/exportTable'
import type { SortKey } from './types'
import type { OrderingMode } from '@/engine/templates/sheet/types'
import { ORDERING_MODES } from '@/engine/templates/sheet/ordering'
import { IMPORT_ACCEPT } from './importDoc'

export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'updated', label: 'Recently updated' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'read', label: 'Shortest read' },
]

export function ToolbarActions({
  config,
  schema,
  query,
  setQuery,
  sort,
  setSort,
  exportColumns,
  filtered,
  canEdit,
  setCreateKind,
  onImportFile,
  onImportLink,
  ordering,
  setOrdering,
  reshuffle,
}: {
  config: TemplateProps['config']
  schema: TemplateProps['schema']
  query: string
  setQuery: (q: string) => void
  sort: SortKey
  setSort: (s: SortKey) => void
  exportColumns: ExportColumn[]
  filtered: Doc[]
  canEdit: boolean
  setCreateKind: (kind: 'doc' | 'course') => void
  /** Reads a Markdown/text/PDF file and files it as a document. */
  onImportFile: (file: File) => void
  /** Opens the "import a link" dialog (Google Doc / Drive). */
  onImportLink: () => void
  /** Library ordering — the same control the tables have. */
  ordering: OrderingMode
  setOrdering: (m: OrderingMode) => void
  reshuffle: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pdfRef = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <SearchInput value={query} onChange={setQuery} placeholder="Search docs…" className="w-[260px]" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2">
            <ArrowDownWideNarrow size={14} className="text-text-3" />
            <span className="hidden lg:inline">{SORTS.find((s) => s.id === sort)?.label}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {SORTS.map((s) => (
            <DropdownMenuItem key={s.id} onClick={() => setSort(s.id)}>
              <span className="flex-1">{s.label}</span>
              {sort === s.id && <Check size={14} className="text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* A→Z, Z→A, a seeded shuffle, or drag them where you want them. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            title="Order"
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2"
          >
            <ArrowUpDown size={14} className="text-text-3" />
            <span className="hidden lg:inline">{ORDERING_MODES.find((m) => m.key === ordering)?.short ?? ORDERING_MODES.find((m) => m.key === ordering)?.label}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[210px]">
          {ORDERING_MODES.map((m) => (
            <DropdownMenuItem
              key={m.key}
              onClick={() => (m.key === 'random' && ordering === 'random' ? reshuffle() : setOrdering(m.key))}
            >
              <m.icon size={14} className="mr-2 text-text-3" />
              <span className="flex-1">{m.label}</span>
              {m.key === ordering && <Check size={14} className="text-primary" />}
            </DropdownMenuItem>
          ))}
          {ordering === 'random' && (
            <DropdownMenuItem onClick={reshuffle}>
              <Shuffle size={14} className="mr-2 text-text-3" /> Shuffle again
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {config.export !== false && (
        <ExportMenu filename={schema.title} columns={exportColumns} rows={filtered} />
      )}
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onImportFile(f)
        }}
      />
      <input
        ref={pdfRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onImportFile(f)
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={!canEdit}
            title={canEdit ? 'Import a document' : 'Requires knowledge.edit — ask an admin'}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Import size={14} className="text-text-3" /> Import
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[230px]">
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <FileText size={14} className="mr-2 text-text-3" />
            <span className="flex-1">Markdown or text</span>
            <span className="text-[11px] text-text-3">.md .txt</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => pdfRef.current?.click()}>
            <FileType size={14} className="mr-2 text-text-3" />
            <span className="flex-1">PDF file</span>
            <span className="text-[11px] text-text-3">kept as a file</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportLink}>
            <Link2 size={14} className="mr-2 text-text-3" />
            <span className="flex-1">Google Doc or Drive link</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Gate perm="knowledge.edit">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]">
              <Plus size={15} /> Create
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem onClick={() => setCreateKind('doc')}>
              <Pencil size={14} className="mr-2 text-text-3" />
              <span className="flex-1">Document</span>
              <span className="text-[11px] text-text-3">Policy, guide…</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCreateKind('course')}>
              <GraduationCap size={14} className="mr-2 text-text-3" />
              <span className="flex-1">Course</span>
              <span className="text-[11px] text-text-3">Modules + progress</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Gate>
    </>
  )
}
