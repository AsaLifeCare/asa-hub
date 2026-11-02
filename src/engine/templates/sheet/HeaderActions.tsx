// PageHeader actions: secondary-action buttons (with the real ExportMenu swapped in for `export` ids) + the primary…
import { unwiredAction } from '@/engine/templates/unwired'
import { AppIcon } from '@/lib/icons'
import { useAuthStore } from '@/auth/useAuthStore'
import { roleCanUseAction } from '@/lib/roleAccess'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import ExportMenu from '@/components/shared/ExportMenu'
import type { ExportColumn } from '@/lib/exportTable'
import type { CreateSpec } from '@/components/shared/CreateRecordModal'
import type { Permission } from '@/auth/types'
import type { PageSchema } from '@/engine/types'
import { dispatchOpsAction } from '@/features/ops-flows/OpsActionModals'
import { runConfigAction, type ConfigAction } from '@/engine/configActions'

export function SheetHeaderActions({
  config,
  schema,
  canDo,
  exportEnabled,
  exportColumns,
  rows,
  primaryAllowed,
  primaryPerm,
  createSpec,
  onOpenCreate,
}: {
  config: Record<string, any>
  schema: PageSchema
  canDo: (perm?: Permission) => boolean
  exportEnabled: boolean
  exportColumns: ExportColumn[]
  rows: any[]
  primaryAllowed: boolean
  primaryPerm?: Permission
  createSpec?: CreateSpec
  onOpenCreate: () => void
}) {
  // page-header controls a role may see at all (lib/roleAccess.ts)
  const role = useAuthStore((st) => st.user?.role)
  const showPrimary = roleCanUseAction(role, 'primary')
  const showSecondary = roleCanUseAction(role, 'secondary')
  const showExport = roleCanUseAction(role, 'export')
  return (
    <>
      {showSecondary && (config.secondaryActions ?? []).map((a: any) => {
        const secAllowed = canDo(a.perm as Permission | undefined)
        // Real export: a plain toast-button here is a dead end — render the working ExportMenu (CSV / Excel / TXT)…
        if (a.id === 'export') {
          if (!showExport || !exportEnabled) return null
          return (
            <ExportMenu
              key={a.id ?? a.label}
              filename={String(config.exportName ?? config.title ?? schema.title)}
              columns={exportColumns}
              rows={rows}
              triggerLabel={a.label}
              triggerIcon={a.icon}
            />
          )
        }
        return (
          <button
            key={a.id ?? a.label}
            disabled={!secAllowed}
            title={secAllowed ? undefined : `Requires ${a.perm} — ask an admin`}
            onClick={() =>
              a.action
                ? dispatchOpsAction(a.action)
                : unwiredAction(a.toast ?? a.label)
            }
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {a.icon && <AppIcon name={a.icon} size={15} />}
            {a.label}
          </button>
        )
      })}
      {/* config.headerActions — real config actions in the page-header
          toolbar, styled like the secondary buttons. They run row-less:
          `{row.*}` interpolates to '' and `when` is ignored (no row to be
          truthful about); perm is still re-checked here and in the runner. */}
      {showSecondary &&
        ((config.headerActions ?? []) as ConfigAction[]).map((a) => {
          const allowed = canDo(a.perm as Permission | undefined)
          return (
            <button
              key={a.id}
              disabled={!allowed}
              title={allowed ? undefined : `Requires ${a.perm} — ask an admin`}
              onClick={() =>
                void runConfigAction(a, undefined, {
                  resource: (schema.dataSource?.resource as string | undefined) ?? schema.id,
                })
              }
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
                a.danger ? 'text-danger hover:bg-tint-pink' : 'text-text-1 hover:bg-surface-2',
              )}
            >
              {a.icon && <AppIcon name={a.icon} size={15} />}
              {a.label}
            </button>
          )
        })}
      {showPrimary && config.primaryAction && (
        <button
          disabled={!primaryAllowed}
          title={primaryAllowed ? undefined : `Requires ${primaryPerm} — ask an admin`}
          onClick={() =>
            config.primaryAction.action
              ? dispatchOpsAction(config.primaryAction.action)
              : createSpec
                ? onOpenCreate()
                : toast({ type: 'info', title: config.primaryAction.toast ?? config.primaryAction.label, body: 'This creates a record in the live backend.' })
          }
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {config.primaryAction.icon && <AppIcon name={config.primaryAction.icon} size={15} />}
          {config.primaryAction.label}
        </button>
      )}
    </>
  )
}
