// A book people typed into, kept in Postgres (app/sheet_resources.py): one sheet page a tab, behind the App Control
// control its houses name (`feature`, the master's alone until released) — its first columns shown, every column
// edited, rows added and removed through the generic verbs (routed at the front door: app/generic_rows.py ROUTES).
import type { PageSchema } from '@/engine/types'

export type BookTab = {
  id: string
  title: string
  icon: string
  resource: string
  /** the tab's columns, as its header names them (the cell keys) */
  columns: string[]
  /** how many columns the table shows (all of them are edited) */
  shown?: number
  /** columns written as paragraphs */
  long?: string[]
}

export function bookTabPage(feature: string, tab: BookTab): PageSchema {
  const fields = tab.columns.map((key) => ({
    key, label: key.split('\n')[0].trim(), ...(tab.long?.includes(key) ? { type: 'textarea' } : {}),
  }))
  const form = { resource: tab.resource, perm: 'people.edit' as const, fields }
  return {
    id: tab.id, type: 'sheet', title: tab.title, icon: tab.icon, feature,
    dataSource: { resource: tab.resource as PageSchema['dataSource']['resource'] },
    config: {
      entity: ['row', 'rows'],
      searchable: true,
      primaryAction: { label: 'Add', icon: 'plus', form: { title: `Add to ${tab.title}`, ...form } },
      editForm: { title: `Edit — ${tab.title}`, ...form },
      rowDelete: { perm: 'people.edit' },
      columns: tab.columns.slice(0, tab.shown ?? 6).map((key) => ({
        key, label: key.split('\n')[0].trim(), kind: 'text', sortable: true })),
      rowActions: [{ id: 'edit', label: 'Edit', icon: 'pencil' }, { id: 'delete', label: 'Remove', icon: 'trash-2' }],
      pagination: { pageSize: 25 },
    },
  }
}
