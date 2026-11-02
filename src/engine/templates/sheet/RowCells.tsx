// One row's cells — natural-number chip (manual mode), selection checkbox, data cells, hover actions + ⋯ menu…
import { ArrowUpToLine, ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import BookmarkButton from '@/components/shared/BookmarkButton'
import FeedbackThumbs from '@/components/shared/FeedbackThumbs'
import type { EditSpec } from '@/components/shared/EditRecordModal'
import type { AssignSpec } from '@/components/shared/AssignPhotoModal'
import type { Permission } from '@/auth/types'
import type { TintName } from '@/engine/types'
import type { FocusDragConfig } from '@/lib/focus'
import { dispatchOpsAction } from '@/features/ops-flows/OpsActionModals'
import { actionVisible } from '@/engine/configActions'
import { RowCheckbox } from './RowCheckbox'
import { Cell } from './Cell'
import { colSizing, type Column } from './types'

export function SheetRowCells({
  row,
  manual,
  naturalIndex,
  config,
  selected,
  toggleOne,
  columns,
  quickActions,
  canDo,
  rowActionBlocked,
  runRowAction,
  openRow,
  moveRow,
  focusDrag,
  focusRow,
  editSpec,
  assignSpec,
}: {
  row: any
  manual: boolean
  naturalIndex: Map<string, number>
  config: Record<string, any>
  selected: Set<string>
  toggleOne: (id: string) => void
  columns: Column[]
  quickActions: any[]
  canDo: (perm?: Permission) => boolean
  rowActionBlocked: (a: any) => boolean | undefined
  runRowAction: (a: any, row: any) => void
  openRow: (row: any) => void
  moveRow: (id: string, action: 'top' | 'up' | 'down') => void
  focusDrag?: FocusDragConfig
  focusRow: (row: any) => void
  editSpec?: EditSpec
  assignSpec?: AssignSpec
}) {
  return (
    <>
      {manual && (
        <td className="w-10 pl-3 pr-0" title="Natural row number — restored next session">
          <span className="font-mono text-[11px] tabular-nums text-text-3">#{naturalIndex.get(String(row.id)) ?? '—'}</span>
        </td>
      )}
      {config.selectable && (
        <td
          className={cn('px-4', selected.has(row.id) && 'shadow-[inset_2px_0_0_var(--primary)]')}
          onClick={(e) => e.stopPropagation()}
        >
          <RowCheckbox
            label={`Select row ${row.id}`}
            checked={selected.has(row.id)}
            onChange={() => toggleOne(row.id)}
          />
        </td>
      )}
      {columns.map((c, ci) => {
        // sweep: tinted status cell — styleBy value styles win (exact tokens), else tintCell paints from the…
        const sv = String(row[c.key])
        const styled = c.styleBy?.[sv]
        const cellTint = c.tintCell ? (c.tintBy?.[sv] as TintName | undefined) : undefined
        const cellStyle =
          styled && c.tintCell !== false
            ? { background: styled.bg, boxShadow: `inset 3px 0 0 ${styled.fg}` }
            : cellTint
              ? { background: TINT_BG_VAR[cellTint], boxShadow: `inset 3px 0 0 ${TINT_VAR[cellTint]}` }
              : undefined
        // col.cellAction — the cell is its own door: the click stays here (stopPropagation, same as the checkbox…
        const cellDoor = c.cellAction
        return (
          <td
            key={c.key}
            style={{ ...colSizing(c), ...cellStyle }}
            className={cn('px-4', !config.selectable && ci === 0 && selected.has(row.id) && 'shadow-[inset_2px_0_0_var(--primary)]')}
          >
            {cellDoor ? (
              <button
                type="button"
                aria-label={`Open ${String(row[c.key] ?? c.label)}`}
                title={`Open ${String(row[c.key] ?? c.label)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  dispatchOpsAction(cellDoor, row)
                }}
                className="cursor-pointer rounded-full transition-opacity duration-150 hover:opacity-70"
              >
                <Cell col={c} row={row} focusDrag={focusDrag} />
              </button>
            ) : (
              // focusDrag is handed DOWN as well as used on the row: the avatar+text cell is its own drag handle…
              <Cell col={c} row={row} focusDrag={focusDrag} />
            )}
          </td>
        )
      })}
      {(config.rowActions || config.rowBookmark || config.rowFeedback || manual) && (
        <td className="px-4" onClick={(e) => e.stopPropagation()}>
          <div
            className="flex items-center justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 max-md:opacity-100"
            style={{ transitionDuration: '120ms' }}
          >
            {/* config.rowFeedback — thumbs on any table row, same store as
                documents and videos (who / when / on what). */}
            {config.rowFeedback && (
              <FeedbackThumbs
                itemKind={config.rowFeedback.itemKind}
                itemId={String(row.id)}
                itemTitle={String(row[config.rowFeedback.titleKey ?? 'name'] ?? row.id)}
                collection={config.rowFeedback.collectionKey ? String(row[config.rowFeedback.collectionKey] ?? '') : undefined}
              />
            )}
            {config.rowBookmark && (
              <BookmarkButton
                size="sm"
                bookmark={{
                  type: config.rowBookmark.type ?? 'person',
                  refId: String(row[config.rowBookmark.refIdKey ?? 'id'] ?? row.id),
                  title: String(row[config.rowBookmark.titleKey ?? 'name'] ?? row.id),
                  subtitle: config.rowBookmark.subtitleKey ? String(row[config.rowBookmark.subtitleKey] ?? '') : undefined,
                  avatar: config.rowBookmark.avatarKey ? row[config.rowBookmark.avatarKey] : undefined,
                  tint: config.rowBookmark.tint ?? 'blue',
                  href: String(config.rowBookmark.href ?? '/').replace(':id', String(row.id)),
                }}
              />
            )}
            {quickActions
              // config actions carry `when` — row-level visibility, decided per row right where the button would…
              .filter((a: any) => !a.kind || actionVisible(a, row))
              .map((a: any) => {
              const blocked = rowActionBlocked(a) || !canDo(a.perm as Permission | undefined)
              const perm = a.id === 'edit' ? editSpec?.perm : a.id === 'assign' ? assignSpec?.perm : a.perm
              return (
                <button
                  key={a.id}
                  aria-label={a.label}
                  title={blocked ? `Requires ${perm} — ask an admin` : a.label}
                  disabled={blocked}
                  onClick={() => (a.action ? dispatchOpsAction(a.action, row) : runRowAction(a, row))}
                  className={cn(
                    'grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40',
                    a.danger && 'text-danger hover:bg-tint-pink hover:text-danger',
                  )}
                >
                  <AppIcon name={a.icon} size={14} />
                </button>
              )
            })}
            {((config.rowActions ?? []).length > 0 || manual) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="Row actions" className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1">
                    <MoreHorizontal size={15} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {focusDrag && (
                    <DropdownMenuItem onClick={() => focusRow(row)}>
                      <AppIcon name="crosshair" size={14} /> Focus workspace on {String(row[focusDrag.nameKey] ?? 'record')}
                    </DropdownMenuItem>
                  )}
                  {(config.rowActions ?? [])
                    .filter((a: any) => !a.kind || actionVisible(a, row))
                    .map((a: any) => {
                    const rowAllowed = canDo(a.perm as Permission | undefined)
                    const itemBlocked = rowActionBlocked(a) || !rowAllowed
                    return (
                      <DropdownMenuItem
                        key={a.id}
                        disabled={itemBlocked}
                        title={itemBlocked ? `Requires ${a.perm ?? editSpec?.perm ?? assignSpec?.perm} — ask an admin` : undefined}
                        className={cn(a.danger && 'text-danger focus:text-danger')}
                        onClick={() =>
                          a.id === 'view'
                            ? openRow(row)
                            : a.action
                              ? dispatchOpsAction(a.action, row)
                              : runRowAction(a, row)
                        }
                      >
                        <AppIcon name={a.icon} size={14} /> {a.label}
                      </DropdownMenuItem>
                    )
                  })}
                  {manual && (
                    <>
                      <DropdownMenuItem onClick={() => moveRow(String(row.id), 'top')}>
                        <ArrowUpToLine size={14} /> Move to top
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => moveRow(String(row.id), 'up')}>
                        <ChevronUp size={14} /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => moveRow(String(row.id), 'down')}>
                        <ChevronDown size={14} /> Move down
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </td>
      )}
    </>
  )
}
