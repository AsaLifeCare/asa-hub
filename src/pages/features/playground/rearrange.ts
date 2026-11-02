// REARRANGE CONTROLS → schema config mapping.
// The admin decides what end users may rearrange on the published page; the toggles compile into the page `config`…
import type { PageType } from '@/engine/types'
import type { Permission } from '@/auth/types'

// The permission stamped on the edit/create forms the studio synthesizes.
export const PLAYGROUND_EDIT_PERM: Permission = 'apps.manage'

export type RearrangeToggles = {
  ordering: boolean
  export: boolean
  inlineEdit: boolean
  create: boolean
}

export const DEFAULT_TOGGLES: RearrangeToggles = {
  ordering: true,
  export: true,
  inlineEdit: false,
  create: false,
}

type SheetColumn = { key?: string; label?: string; kind?: string }

function fieldsFromColumns(config: Record<string, unknown>) {
  const cols = Array.isArray(config.columns) ? (config.columns as SheetColumn[]) : []
  return cols
    .filter((c) => c && typeof c.key === 'string')
    .slice(0, 8)
    .map((c) => ({
      key: c.key as string,
      label: c.label ?? (c.key as string),
      type: (c.kind === 'number' ? 'number' : c.kind === 'chips' ? 'tags' : 'text') as 'number' | 'tags' | 'text',
    }))
}

function entityName(config: Record<string, unknown>): string {
  const e = config.entity
  if (Array.isArray(e) && typeof e[0] === 'string') return e[0]
  if (typeof e === 'string') return e
  return 'record'
}

// Returns a NEW config with the toggles applied.
export function applyRearrange(
  config: Record<string, unknown>,
  toggles: RearrangeToggles,
  type: PageType,
  resource: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }

  if (!toggles.ordering) {
    out.ordering = false
    out.allowDrag = false
  }
  if (!toggles.export) {
    out.export = false
  }

  if (type === 'sheet') {
    if (!toggles.inlineEdit) {
      delete out.editForm
    } else if (!out.editForm) {
      const fields = fieldsFromColumns(out)
      if (fields.length) {
        out.editForm = {
          title: `Edit ${entityName(out)}`,
          resource,
          perm: PLAYGROUND_EDIT_PERM,
          fields,
        }
      }
    }

    if (!toggles.create) {
      delete out.primaryAction
    } else if (!out.primaryAction) {
      const fields = fieldsFromColumns(out)
      out.primaryAction = {
        label: `New ${entityName(out)}`,
        icon: 'plus',
        ...(fields.length
          ? { form: { title: `New ${entityName(out)}`, resource, perm: PLAYGROUND_EDIT_PERM, fields } }
          : {}),
      }
    }
  }

  return out
}
