// ExportMenu — ghost Download button + dropdown (CSV / Excel (.xls) / Plain text (.txt)).
// Exports whatever rows the caller passes in — engine templates hand it the CURRENT filtered + sorted + ordered…
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { exportRows, type ExportColumn, type ExportFormat } from '@/lib/exportTable'
import { toast } from '@/stores/useToastStore'
import { AppIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

const FORMATS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: 'csv', label: 'CSV', icon: FileText },
  { format: 'xlsx', label: 'Excel (.xls)', icon: FileSpreadsheet },
  { format: 'txt', label: 'Plain text (.txt)', icon: FileText },
]

export default function ExportMenu({
  filename,
  columns,
  rows,
  className,
  triggerLabel,
  triggerIcon,
}: {
  /** download filename base (extension added per format) */
  filename: string
  columns: ExportColumn[]
  /** current filtered + sorted rows */
  rows: any[]
  className?: string
  /** when set, trigger renders as a labelled header button instead of an icon tile */
  triggerLabel?: string
  /** kebab-case lucide icon name for the labelled trigger (default: 'download') */
  triggerIcon?: string
}) {
  const run = (format: ExportFormat, label: string) => {
    exportRows(filename, columns, rows, format)
    toast({
      type: 'success',
      title: `Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`,
      body: `${label} download started.`,
    })
  }
  return (
    <div className={cn('flex items-center', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {triggerLabel ? (
            <button
              aria-label={triggerLabel}
              title={triggerLabel}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
            >
              <AppIcon name={triggerIcon ?? 'download'} size={15} />
              {triggerLabel}
            </button>
          ) : (
            <button
              aria-label="Export table"
              title="Export table"
              className="grid h-9 w-9 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
            >
              <Download size={15} />
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px]">
          {FORMATS.map((f) => (
            <DropdownMenuItem key={f.format} onClick={() => run(f.format, f.label)}>
              <f.icon size={14} /> {f.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
