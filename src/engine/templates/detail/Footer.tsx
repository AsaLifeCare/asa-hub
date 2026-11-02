// Footer action row.
// Buttons with `edit: true` open the shared EditRecordModal (driven by config.editForm) — permission-gated, saved…
import { unwiredAction } from '@/engine/templates/unwired'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router'
import { AppIcon } from '@/lib/icons'
import { staggerItem } from '@/engine/motion'
import { useCan } from '@/auth/permissions'
import type { Permission } from '@/auth/types'
import EditRecordModal, { type EditSpec } from '@/components/shared/EditRecordModal'
import { useAuthStore } from '@/auth/useAuthStore'
import { cn } from '@/lib/utils'
// ops-flows (additive): footer buttons with an `action` id dispatch to feature modals (e.g. "Escalate to MUI"…
import { dispatchOpsAction } from '@/features/ops-flows/OpsActionModals'
import { share, type SharePayload } from '@/stores/useShareStore'
import { actionVisible, runConfigAction, type ConfigAction } from '@/engine/configActions'

export function Footer({
  buttons,
  editSpec,
  record,
  resource,
  onSaved,
  shareInfo,
}: {
  buttons: any[]
  editSpec?: EditSpec
  record?: any
  // resource footer config actions (`kind`) write to — resolved by DetailTemplate (config.resource, then the page…
  resource?: string
  onSaved?: (row: any) => void
  /** built by DetailTemplate from the panel's own header + sections */
  shareInfo?: SharePayload
}) {
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const canEdit = useCan(editSpec?.perm ?? ('people.edit' as Permission))
  // ops-flows (additive): footer buttons support `action` (feature dispatch), `href` (SPA navigation) and `perm`…
  const authCan = useAuthStore((s) => s.can)
  const authUser = useAuthStore((s) => s.user)
  return (
    <motion.div variants={staggerItem} className="flex gap-2">
      {buttons
        // config actions (`kind`) honour `when` against the record on screen
        .filter((b: any) => !b.kind || actionVisible(b as ConfigAction, record))
        .map((b: any, i: number) => {
        const isEdit = b.edit === true && editSpec
        // `share: true` opens the platform-wide share sheet with this record already rendered as text — same box in…
        const isShare = b.share === true
        const allowed = !b.perm || authCan(authUser, b.perm as Permission)
        const disabled = (isEdit && !canEdit) || !allowed
        return (
          <button
            key={i}
            disabled={disabled}
            title={disabled ? `Requires ${isEdit ? editSpec?.perm : b.perm} — ask an admin` : undefined}
            onClick={() =>
              // A panel built IN CODE can hand over a real callback.
              typeof b.onClick === 'function'
                ? b.onClick(record)
                : isEdit
                ? setEditOpen(true)
                : isShare && shareInfo
                  ? share(shareInfo)
                  : b.kind
                    ? void runConfigAction(b as ConfigAction, record, { resource })
                    : b.action
                      ? dispatchOpsAction(b.action, record)
                      : b.href
                        ? navigate(b.href)
                        : unwiredAction(b.toast ?? b.label)
            }
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
              b.variant === 'primary' && 'bg-primary text-on-primary hover:bg-primary-hover',
              (b.variant === 'danger' || b.danger) && 'border border-border bg-surface text-danger hover:bg-tint-pink',
              (!b.variant || b.variant === 'secondary') && !b.danger && 'border border-border bg-surface text-text-1 hover:bg-surface-2',
            )}
          >
            {b.icon && <AppIcon name={b.icon} size={15} />}
            {b.label}
          </button>
        )
      })}
      {editSpec && record && (
        <EditRecordModal
          open={editOpen}
          onOpenChange={setEditOpen}
          record={record}
          spec={editSpec}
          onSaved={(row) => onSaved?.(row)}
        />
      )}
    </motion.div>
  )
}
