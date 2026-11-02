// `sheet` template (page-types.md §2) — long lists / data tables.
// Debounced search, sortable columns with carets, filter chips, selection + animated floating bulk bar, sticky…
import { unwiredAction } from '@/engine/templates/unwired'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { ArrowUp } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import { type ActiveFilter } from '@/components/shared/FilterChips'
import EmptyState from '@/components/shared/EmptyState'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { ohioWall } from '@/lib/ohio'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { cn } from '@/lib/utils'
import CreateRecordModal, { type CreateSpec } from '@/components/shared/CreateRecordModal'
import EditRecordModal, { type EditSpec } from '@/components/shared/EditRecordModal'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import AssignPhotoModal, { type AssignSpec } from '@/components/shared/AssignPhotoModal'
import ContextBanner from '@/components/shared/ContextBanner'
import ConversationModal, { type ConversationConfig } from '@/components/shared/ConversationModal'
import { share } from '@/stores/useShareStore'
import { askConfirm } from '@/stores/useDialogStore'
import { useCan } from '@/auth/permissions'
import type { Permission } from '@/auth/types'
import { useContextStore } from '@/stores/useContextStore'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { noteWrite } from '@/lib/snapshotClient'

// THE LIVING BUFFER — a live buffer that composes itself and fires one shot every 40 seconds.
const MARK_FLUSH_MS = 40_000
const markBuffers = new Map<string, { ids: Set<string>; timer: number | null; resource: string }>()

function flushMarks(action: string): void {
  const buf = markBuffers.get(action)
  if (!buf) return
  if (buf.timer != null) {
    window.clearTimeout(buf.timer)
    buf.timer = null
  }
  const ids = [...buf.ids]
  if (!ids.length) return
  buf.ids.clear()
  void gasAction(action, { ids })
    .then(() => noteWrite(buf.resource))
    .catch(() => {
      // the shot missed (busy burst): the ids go back in the pool and the next tick fires again — a receipt is…
      ids.forEach((i) => buf.ids.add(i))
      if (buf.timer == null) buf.timer = window.setTimeout(() => flushMarks(action), MARK_FLUSH_MS)
    })
}

function queueMark(action: string, resource: string, id: string): void {
  let buf = markBuffers.get(action)
  if (!buf) {
    buf = { ids: new Set(), timer: null, resource }
    markBuffers.set(action, buf)
  }
  buf.ids.add(id)
  if (buf.timer == null) buf.timer = window.setTimeout(() => flushMarks(action), MARK_FLUSH_MS)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') markBuffers.forEach((_, action) => flushMarks(action))
  })
}
import {
  focusFromRow,
  inferFocusDrag,
  inferScopeKeys,
  recordMatchesFocus,
  rowFocusTier,
  writePersonDrag,
  type FocusDragConfig,
} from '@/lib/focus'
// ops-flows (additive): config actions with an `action` id dispatch to feature modals (MUI escalation, policy…
import { OpsActionModals } from '@/features/ops-flows/OpsActionModals'
import { useAuthStore } from '@/auth/useAuthStore'
import { useTenantStore } from '@/stores/useTenantStore'
import type { ExportColumn } from '@/lib/exportTable'
import { colSizing, isPhoneColumn, withPrimaryColumn, type Column, type SummaryStripConfig } from './types'
import ColumnEditor, { applyColumnLayout, loadColumnLayout, type ColumnOverride } from './ColumnEditor'
import { resolveColumns } from './autoColumns'
import { mulberry32 } from './ordering'
import { useSheetOrdering } from './use-sheet-ordering'
import { SortableRow } from './SortableRow'
import { RowCheckbox } from './RowCheckbox'
import { CardGrid } from './CardGrid'
import { SheetRowCells } from './RowCells'
import { SheetHeaderActions } from './HeaderActions'
import { runConfigAction, actionVisible, type ConfigAction } from '@/engine/configActions'
import { SummaryStrip } from './SummaryStrip'
import { SheetToolbar } from './SheetToolbar'
import { SheetPagination } from './SheetPagination'
import { BulkBar } from './BulkBar'

// `config.rowTint = { key, className?
const ROW_TINT_TRUTHY = ['true', 'yes', 'y', '1', 'sim']
function rowTintClass(config: Record<string, unknown>, row: Record<string, any>): string {
  const rt = config.rowTint as { key?: string; className?: string } | undefined
  if (!rt?.key) return ''
  const v = String(row[rt.key] ?? '').trim().toLowerCase()
  return ROW_TINT_TRUTHY.includes(v) ? (rt.className ?? 'bg-tint-mint/50 hover:bg-tint-mint/70') : ''
}

export default function SheetTemplate({ config, data, schema, onRows }: TemplateProps) {
  // Two engine rules, so no page has to remember either: - columns that no longer describe the data give way to the…
  const declaredColumns = useMemo(
    () => withPrimaryColumn(resolveColumns((config.columns ?? []) as Column[], data)),
    [config.columns, data],
  )
  // The pencil: an admin can reorder, hide, widen, wrap and rename columns on any table.
  const layoutScope = `${(schema.dataSource?.resource as string) ?? schema.id}:${schema.id}`
  const layoutUser = useAuthStore((s) => s.user?.id) ?? 'anon'
  const [columnLayout, setColumnLayout] = useState<ColumnOverride[]>(() => loadColumnLayout(layoutScope, layoutUser))
  useEffect(() => setColumnLayout(loadColumnLayout(layoutScope, layoutUser)), [layoutScope, layoutUser])
  const columns = useMemo(
    () => applyColumnLayout(declaredColumns, columnLayout),
    [declaredColumns, columnLayout],
  )
  // a column layout decides what a screen is FOR — an admin call
  const canAdjustColumns = useCan('apps.manage')

  // IS THIS ACCOUNT LINKED TO ANYBODY?
  const meHere = useEffectiveUser()
  const myClientKey = useAuthStore((s) => s.user?.clientKey) ?? ''
  const CLIENT_KEYED = ['clients', 'isps', 'mealIdeals', 'workoutPlans', 'sleepProfiles', 'hydrationProfiles']
  const unlinkedClient =
    !meHere?.visiting &&
    meHere?.role === 'client' &&
    !String(myClientKey).trim() &&
    CLIENT_KEYED.includes((schema.dataSource?.resource as string) ?? schema.id)
  const pageSize = typeof config.pagination === 'object' ? (config.pagination.pageSize as number) : 10
  const entity = (config.entity as [string, string] | undefined) ?? ['record', 'records']
  const [qRaw, setQRaw] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<ActiveFilter[]>([])
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  // mobile-first default: when a viewToggle exists, phones (<md) start on cards
  const [view, setView] = useState<'table' | 'card'>(() =>
    config.viewToggle && typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
      ? 'card'
      : 'table',
  )
  // The person's own Density preference (Settings → Appearance) is where a table STARTS; the toolbar toggle still…
  const [compact, setCompact] = useState(() => localStorage.getItem('asa-density') === 'compact')
  const [createdRows, setCreatedRows] = useState<any[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  // inline edit (config.editForm) + photo assignment (config.photoAssign): local patches overlay `data` so saved…
  const [patches, setPatches] = useState<Record<string, Record<string, unknown>>>({})
  const [editRow, setEditRow] = useState<any | null>(null)
  const [assignRow, setAssignRow] = useState<any | null>(null)
  // universal ordering (config.ordering) — DEFAULT-ON (sweep): the control renders on every sheet unless the page…
  const orderingEnabled = config.ordering !== false
  // sweep: pages may override the persistence key (config.orderKey) so sheets that share a resource (e.g. payroll +…
  const tenantId = useTenantStore((s) => s.currentTenantId) || 'asa-hq'
  const orderStorageKey = `asa-sheet-order-v2:${tenantId}:${(config.orderKey as string | undefined) ?? (schema.dataSource?.resource as string | undefined) ?? schema.id}`
  // all live row ids in natural order (created rows first) — feeds the ordering hook
  const allIds = useMemo(() => [...createdRows, ...data].map((r) => String(r.id)), [createdRows, data])
  const { ordering, setOrdering, shuffleSeed, setShuffleSeed, orderSensors, effectiveOrder, naturalIndex, onOrderDragEnd, moveRow } =
    useSheetOrdering(orderStorageKey, allIds)
  const openDetail = useDetailPanelStore((s) => s.openDetail)
  const navigate = useNavigate()
  // working-create primary action (config.primaryAction.form) — permission re-checked here and again inside…
  const createSpec = config.primaryAction?.form as CreateSpec | undefined
  // ops-flows (additive): primaryAction may carry `action` (dispatch) + `perm`
  const primaryPerm = createSpec?.perm ?? (config.primaryAction?.perm as Permission | undefined)
  const hasPrimaryPerm = useCan(primaryPerm ?? ('people.view' as Permission))
  const primaryAllowed = primaryPerm ? hasPrimaryPerm : true
  // inline edit spec (rowActions id 'edit' + detailPanel footer { edit: true })
  const editSpec = config.editForm as EditSpec | undefined
  const canEditRows = useCan(editSpec?.perm ?? ('people.edit' as Permission))
  // photo assignment spec (rowActions id 'assign' — Image Bank)
  const assignSpec = config.photoAssign as AssignSpec | undefined
  const canAssign = useCan(assignSpec?.perm ?? ('people.edit' as Permission))
  // real row deletion (rowActions id 'delete' + config.rowDelete { perm }): confirm dialog → api.remove; deleted…
  const deleteSpec = config.rowDelete as { perm: Permission } | undefined
  const canDelete = useCan(deleteSpec?.perm ?? ('people.edit' as Permission))
  const [deleteRow, setDeleteRow] = useState<any | null>(null)
  const [conversationRow, setConversationRow] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  // ops-flows (additive): permission check for row/secondary actions (non-hook check; mutations re-verify inside…
  const authCan = useAuthStore((s) => s.can)
  const authUser = useAuthStore((s) => s.user)
  const canDo = (perm?: Permission) => !perm || authCan(authUser, perm)
  // ops-flows (additive): config.summaryStrip — computed stat row under the header
  const summaryStrip = config.summaryStrip as SummaryStripConfig | undefined

  // `?new=1` OPENS THE CREATE DOOR (for the ⌘K palette).
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
    if (createSpec && primaryAllowed) setCreateOpen(true)
    else if (createSpec) toast({ type: 'warning', title: 'You do not have permission to add here.' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the arrival, not on every param change
  }, [])

  // Person Focus Mode.
  const focusDrag = useMemo(
    () =>
      (config.focusDrag as FocusDragConfig | undefined) ??
      (config.focusDrag === false
        ? undefined
        : inferFocusDrag(
            (schema.dataSource?.resource as string) ?? schema.id,
            data,
            columns.find((c) => c.primary)?.key,
          )),
    [config.focusDrag, schema.dataSource, schema.id, data, columns],
  )
  // sweep: scopeBy accepts one field key or an array (first match wins).
  const scopeBy = config.scopeBy as string | string[] | undefined
  // Declared keys win; otherwise every field that could point at a person is tried.
  const scopeByKeys = useMemo(
    () => (Array.isArray(scopeBy) ? scopeBy : scopeBy ? [scopeBy] : inferScopeKeys(data)),
    [scopeBy, data],
  )
  // sweep: scopeVia — indirect scoping through a LINK resource (e.g. a client focus scopes the People directory to…
  const scopeVia = config.scopeVia as
    | { resource: string; focusField: string; linkField: string; matchField: string }
    | undefined
  const [viaAllowed, setViaAllowed] = useState<string[] | null>(null)
  const focus = useContextStore((s) => s.focus)
  const setFocus = useContextStore((s) => s.setFocus)
  // sweep: role-based data-layer row filter (e.g. directors-only projects): rowFilter: { field, hideWhenEquals…
  const rowFilter = config.rowFilter as
    | { field: string; hideWhenEquals: string; allowRoles: string[] }
    | undefined
  const authRole = useAuthStore((s) => s.user?.role)

  // The row IS the handle — native HTML5 drag wired by ref, because framer-motion consumes React's onDragStart.
  const focusRowRef = (row: any) => (el: HTMLTableRowElement | null) => {
    if (!el || !focusDrag) return
    el.draggable = true
    el.ondragstart = (e) => {
      if (!e.dataTransfer) return
      e.dataTransfer.setData('text/plain', String(row[focusDrag.nameKey] ?? ''))
      writePersonDrag(e.dataTransfer, focusFromRow(row, focusDrag))
    }
  }

  const focusRow = (row: any) => {
    if (!focusDrag) return
    const f = focusFromRow(row, focusDrag)
    setFocus(f)
    toast({
      type: 'success',
      title: `Workspace focused on ${f.name}`,
      body: 'The sidebar now shows only their apps — click the person chip at the top to exit.',
    })
  }

  // 200ms search debounce
  useEffect(() => {
    const id = setTimeout(() => setQ(qRaw), 200)
    return () => clearTimeout(id)
  }, [qRaw])

  // sweep: load the scopeVia link resource and compute the allowed link values for the current focus (null = not…
  useEffect(() => {
    let alive = true
    if (!focus || !scopeVia) {
      setViaAllowed(null)
      return
    }
    api
      .list(scopeVia.resource as never)
      .then((rows: unknown) => {
        if (!alive) return
        const allowed = (Array.isArray(rows) ? rows : [])
          .filter((r) => recordMatchesFocus(r[scopeVia.focusField], focus))
          .map((r) => String(r[scopeVia.linkField] ?? ''))
          .filter(Boolean)
        setViaAllowed([...new Set(allowed)])
      })
      .catch(() => alive && setViaAllowed([]))
    return () => {
      alive = false
    }
  }, [focus, scopeVia])

  /** sweep: does one row match an allowed scopeVia link value? */
  const rowMatchesVia = (r: any) =>
    Boolean(
      scopeVia &&
        viaAllowed &&
        viaAllowed.some((a) => recordMatchesFocus(r[scopeVia.matchField], { type: 'staff', id: a, name: a })),
    )

  // The best focus tier a row reaches: scopeBy keys first, scopeVia links count as "close" (they are one hop away…
  const rowTier = (r: any, f: NonNullable<typeof focus>): 0 | 1 | 2 | 3 => {
    const direct = scopeByKeys.length > 0 ? rowFocusTier(r, scopeByKeys, f) : 0
    if (direct !== 0) return direct
    return scopeVia && rowMatchesVia(r) ? 2 : 0
  }

  // THE ROWS THIS PAGE HOLDS — its own optimistic edits, the role filter and the focus applied, before any search…
  const scopedRows = useMemo(() => {
    let out = [...createdRows, ...data]
      .filter((r) => !removedIds.has(String(r.id)))
      .map((r) => (patches[String(r.id)] ? { ...r, ...patches[String(r.id)] } : r))
    // sweep: role-based data-layer filter (directors-only rows never reach non-director roles — not a visual hide).
    if (rowFilter && !(authRole && rowFilter.allowRoles.includes(authRole))) {
      out = out.filter((r) => String(r[rowFilter.field]) !== rowFilter.hideWhenEquals)
    }
    // Person Focus Mode scoping, TIERED — a refined highlight: a page keeps only its BEST tier — exact name/id…
    if (focus && (scopeByKeys.length > 0 || scopeVia)) {
      const tiers = out.map((r) => rowTier(r, focus))
      let best: 0 | 1 | 2 | 3 = 0
      for (const t of tiers) if (t !== 0 && (best === 0 || t < best)) best = t
      if (best !== 0) out = out.filter((_, i) => tiers[i] === best)
    }
    return out
    // rowTier reads focus, scopeByKeys, scopeVia and viaAllowed, all listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, createdRows, patches, removedIds, focus, scopeByKeys, scopeVia, viaAllowed, rowFilter, authRole])

  const rows = useMemo(() => {
    // a copy: the ordering below sorts in place, and scopedRows is reported
    let out = [...scopedRows]
    if (config.searchable !== false && q) {
      const needle = q.toLowerCase()
      out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(needle))
    }
    for (const f of filters)
      out = out.filter((r) => {
        const rv = r[f.key]
        return Array.isArray(rv) ? rv.map(String).includes(f.value) : String(rv) === f.value
      })
    if (orderingEnabled && ordering === 'az') {
      const key = sort?.key ?? columns.find((c) => c.sortable)?.key ?? columns[0]?.key
      if (key) out.sort((a, b) => String(a[key]).localeCompare(String(b[key])))
    } else if (orderingEnabled && ordering === 'za') {
      const key = sort?.key ?? columns.find((c) => c.sortable)?.key ?? columns[0]?.key
      if (key) out.sort((a, b) => String(b[key]).localeCompare(String(a[key])))
    } else if (orderingEnabled && ordering === 'random') {
      const rand = mulberry32(shuffleSeed)
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
      }
    } else if (orderingEnabled && ordering === 'manual') {
      const idx = new Map(effectiveOrder.map((id, i) => [id, i]))
      out.sort(
        (a, b) =>
          (idx.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (idx.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER),
      )
    } else if (sort) {
      out.sort((a, b) => {
        const av = a[sort.key]
        const bv = b[sort.key]
        return (typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))) * sort.dir
      })
    }
    return out
  }, [scopedRows, q, filters, sort, config.searchable, orderingEnabled, ordering, shuffleSeed, effectiveOrder, columns])

  /** true when scopeBy/scopeVia actually narrowed the list (drives the banner note). */
  const scopeFiltered = Boolean(
    focus &&
      (scopeByKeys.length > 0 || scopeVia) &&
      [...createdRows, ...data].some((r) => rowTier(r, focus) !== 0),
  )
  // hand the page's rows back to a header drawn over this page
  const focusName = scopeFiltered && focus ? focus.name : ''
  useEffect(() => {
    onRows?.({ rows: scopedRows, scope: focusName || undefined })
  }, [onRows, scopedRows, focusName])
  /** sweep: banner renders for scopeBy OR scopeVia pages. */
  const scopeActive = scopeByKeys.length > 0 || Boolean(scopeVia)

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))
  const someOnPage = pageRows.some((r) => selected.has(r.id))

  const toggleAll = () =>
    setSelected((s) => {
      if (allOnPage) {
        const n = new Set(s)
        pageRows.forEach((r) => n.delete(r.id))
        return n
      }
      return new Set([...s, ...pageRows.map((r) => r.id)])
    })
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) {
        n.delete(id)
      } else {
        n.add(id)
      }
      return n
    })

  // `config.markReadOnOpen = { field, from, to, when?, action?
  const markReadOnOpen = config.markReadOnOpen as
    | { field: string; from: string; to: string; when?: string; action?: string }
    | undefined
  const stampOpened = (row: any): any => {
    const spec = markReadOnOpen
    const resource = schema.dataSource?.resource as string | undefined
    if (!spec || !resource || !row?.id) return row
    if (String(row[spec.field] ?? '').trim().toLowerCase() !== spec.from.toLowerCase()) return row
    if (spec.when && !ROW_TINT_TRUTHY.includes(String(row[spec.when] ?? '').trim().toLowerCase())) return row
    const id = String(row.id)
    const stamped = { ...row, [spec.field]: spec.to }
    const patch = (value: unknown) =>
      setPatches((p) => ({ ...p, [id]: { ...(p[id] ?? {}), [spec.field]: value } }))
    patch(spec.to) // reflect immediately — the buffer's shot carries it later
    if (spec.action) {
      // the LIVING BUFFER: the receipt pools and rides the next 40s shot — twenty opened leads cost one execution…
      queueMark(spec.action, resource, id)
    } else {
      void api.update(resource as never, id, { [spec.field]: spec.to } as never).catch(() => patch(row[spec.field]))
    }
    return stamped
  }

  const openRow = (rawRow: any) => {
    // the detail panel must show what the table now shows — the stamped value
    const row = stampOpened(rawRow)
    // A page that declares `conversation` opens the conversation instead of the side panel: for a call, the thing…
    if (config.conversation) {
      setConversationRow(row)
      return
    }
    // A page may send the row click to a PAGE instead of the drawer — the Potential Clients "Unique profile" view.
    if (config.rowNavigate) {
      navigate(String(config.rowNavigate).replace(':id', encodeURIComponent(String(row.id ?? ''))))
      return
    }
    if (config.detailPanel) {
      // Person Focus Mode: hand the detail-panel shell a real focus action for this record (rendered by DetailPanel…
      const panelConfig = {
        ...(config.detailPanel as Record<string, unknown>),
        ...(focusDrag ? { focusAction: focusFromRow(row, focusDrag) } : {}),
        // inline editing: hand the detail-panel footer the sheet's edit spec
        ...(editSpec ? { editForm: editSpec } : {}),
        // config actions in the panel footer patch the SHEET's resource — the panel mounts with a stub schema…
        resource: (schema.dataSource?.resource as string | undefined) ?? schema.id,
      }
      openDetail({ config: panelConfig, record: row })
    }
  }

  // Every row can be shared.
  const rowActions = useMemo(() => {
    const declared = (config.rowActions ?? []) as any[]
    if (config.rowShare === false || declared.some((a) => a.id === 'share')) return declared
    return [...declared, { id: 'share', label: 'Share', icon: 'share-2' }]
  }, [config.rowActions, config.rowShare])
  const rowConfig = useMemo(() => ({ ...config, rowActions }), [config, rowActions])
  const quickActions = rowActions.filter((a) => a.quick)

  // Row-action dispatcher — 'edit'/'assign' become real mutations when the sheet declares editForm/photoAssign…
  const runRowAction = (a: any, row: any) => {
    if (a.id === 'edit' && editSpec) {
      if (!canEditRows) {
        toast({ type: 'warning', title: 'Not allowed', body: `Requires ${editSpec.perm} — ask an admin.` })
        return
      }
      setEditRow(row)
      return
    }
    if (a.id === 'assign' && assignSpec) {
      if (!canAssign) {
        toast({ type: 'warning', title: 'Not allowed', body: `Requires ${assignSpec.perm} — ask an admin.` })
        return
      }
      setAssignRow(row)
      return
    }
    if (a.id === 'delete' && deleteSpec) {
      if (!canDelete) {
        toast({ type: 'warning', title: 'Not allowed', body: `Requires ${deleteSpec.perm} — ask an admin.` })
        return
      }
      setDeleteRow(row)
      return
    }
    // 'share' works on every sheet without configuration: the row is rendered from the columns the table already…
    if (a.id === 'share') {
      const titleKey = columns.find((c) => c.primary)?.key ?? columns[0]?.key ?? 'id'
      share({
        title: String(row[titleKey] ?? row.name ?? row.title ?? row.id),
        subtitle: config.title ?? schema.title,
        text: columns
          .filter((c) => c.key !== titleKey)
          .map((c) => {
            const v = row[c.key]
            if (v == null || String(v).trim() === '') return null
            return `${c.label}: ${isPhoneColumn(c) ? formatPhoneDisplay(v) : String(v)}`
          })
          .filter(Boolean)
          .join('\n'),
        rows: [row],
        columns: exportColumns,
        filename: String(row[titleKey] ?? row.id),
        url: typeof row.url === 'string' ? row.url : undefined,
      })
      return
    }
    if (a.id === 'view') openRow(row)
    // config actions (a.kind) go to the generic runner — confirm/perm/emits rules and the catalogue lookup live…
    else if (a.kind) {
      void runConfigAction(a as ConfigAction, row, { resource: (schema.dataSource?.resource as string) ?? schema.id })
    } else unwiredAction(a.toast ?? a.label)
  }

  /** Real deletion behind the confirm dialog — api.remove on the resource. */
  const confirmDelete = async () => {
    if (!deleteRow) return
    const id = String(deleteRow.id)
    setDeleting(true)
    try {
      await api.remove((schema.dataSource?.resource as string) ?? schema.id, id)
      setRemovedIds((s) => new Set(s).add(id))
      setCreatedRows((rs) => rs.filter((r) => String(r.id) !== id))
      setSelected((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
      toast({ type: 'success', title: `${entity[0].charAt(0).toUpperCase() + entity[0].slice(1)} removed`, body: `${deleteRow.name ?? deleteRow.title ?? id} was deleted.` })
      setDeleteRow(null)
    } catch (err) {
      toast({ type: 'danger', title: 'Could not delete', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setDeleting(false)
    }
  }

  // Bulk deletion — delete in one go, never archive: every selected row goes through the SAME real delete door as…
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const runBulkDelete = async () => {
    const ids = [...selected]
    if (!ids.length) return
    setBulkDeleting(true)
    const resource = (schema.dataSource?.resource as string) ?? schema.id
    // Chunks of 8, not one volley: 87 concurrent deletes tripped the /gas per-client rate limit and half the batch…
    const results: PromiseSettledResult<unknown>[] = []
    for (let i = 0; i < ids.length; i += 8) {
      results.push(...(await Promise.allSettled(ids.slice(i, i + 8).map((id) => api.remove(resource as never, id)))))
    }
    const gone = ids.filter((_, i) => results[i].status === 'fulfilled')
    const failed = ids.filter((_, i) => results[i].status === 'rejected')
    setRemovedIds((s) => new Set([...s, ...gone]))
    setCreatedRows((rs) => rs.filter((r) => !gone.includes(String(r.id))))
    setSelected(new Set(failed))
    setBulkDeleting(false)
    setConfirmBulkDelete(false)
    if (gone.length) toast({ type: 'success', title: `${gone.length} ${gone.length === 1 ? entity[0] : entity[1]} deleted` })
    if (failed.length) toast({ type: 'danger', title: `${failed.length} could not be deleted`, body: 'They stay selected — try again.' })
  }

  // Bulk config actions — rowActions entries with `kind: 'patch'` + `bulk` appear on the selection bar and apply…
  const bulkConfigActions = rowActions.filter(
    (a: any) => a.kind === 'patch' && a.bulk && canDo(a.perm as Permission | undefined),
  ) as ConfigAction[]
  const runBulkConfig = async (a: ConfigAction) => {
    const selectedRows = rows.filter((r) => selected.has(r.id))
    if (!selectedRows.length) return
    // `when` still decides per row — a bulk click cannot override the rule
    const eligible = selectedRows.filter((r) => actionVisible(a, r))
    const skipped = selectedRows.length - eligible.length
    if (!eligible.length) {
      toast({ type: 'warning', title: `${a.label} — nothing to apply`, body: `The show-when rule matches none of the ${selectedRows.length} selected rows.` })
      return
    }
    // the action's own `confirm` text is what the page author wrote — it stays the sentence the person reads
    if (a.confirm || a.danger) {
      const proceed = await askConfirm({
        title: `${a.label} — apply to ${eligible.length} selected ${eligible.length === 1 ? entity[0] : entity[1]}?`,
        body: a.confirm ?? 'The same change is applied to each of them.',
        confirmLabel: a.label,
        tone: a.danger ? 'danger' : undefined,
      })
      if (!proceed) return
    }
    const resource = (schema.dataSource?.resource as string) ?? schema.id
    const results: boolean[] = []
    for (let i = 0; i < eligible.length; i += 8) {
      results.push(
        ...(await Promise.all(
          eligible.slice(i, i + 8).map((r) => runConfigAction(a, r, { resource }, { skipConfirm: true, quietSuccess: true })),
        )),
      )
    }
    const failed = eligible.filter((_, i) => !results[i])
    setSelected(new Set(failed.map((r) => r.id)))
    const ok = eligible.length - failed.length
    if (ok)
      toast({
        type: 'success',
        title: `${a.label} — ${ok} ${ok === 1 ? entity[0] : entity[1]} updated`,
        body: skipped ? `Skipped ${skipped} where the rule doesn't match.` : undefined,
      })
    if (failed.length) toast({ type: 'warning', title: `${failed.length} could not be updated`, body: 'They stay selected — try again.' })
  }

  /** Whether a row action is currently permission-blocked (for tooltips). */
  const rowActionBlocked = (a: any) =>
    (a.id === 'edit' && editSpec && !canEditRows) ||
    (a.id === 'assign' && assignSpec && !canAssign) ||
    (a.id === 'delete' && deleteSpec && !canDelete)
  const manual = orderingEnabled && ordering === 'manual'
  // universal table export (DEFAULT-ON): CSV / Excel (.xls) / TXT of the CURRENT filtered + sorted + ordered rows.
  const exportEnabled = config.export !== false && config.exportable !== false
  const exportColumns = useMemo<ExportColumn[]>(
    () =>
      columns.map((c) => ({
        key: c.key,
        label: c.label,
        accessor: (row: any) => {
          const v = row?.[c.key]
          if (c.kind === 'chip') return c.labelBy?.[String(v)] ?? v
          if (c.kind === 'date') {
            // The export reads the same clock the table does — a CSV that disagrees with the screen it came from is…
            const d = ohioWall(v)
            return d ? format(d, c.format ?? 'MMM d, yyyy') : (v ?? '')
          }
          if (c.kind === 'progress') return `${Math.round((Number(v) || 0) * 100)}%`
          if (v != null && isPhoneColumn(c)) return formatPhoneDisplay(v)
          return v
        },
      })),
    [columns],
  )
  const rowHeight = compact ? 48 : (config.rowHeight ?? 56)
  const rangeFrom = rows.length === 0 ? 0 : safePage * pageSize + 1
  const rangeTo = Math.min(rows.length, (safePage + 1) * pageSize)

  /** Row cells shared by the animated (default) and draggable (manual) row renderers. */
  const renderRowCells = (row: any) => (
    <SheetRowCells
      row={row}
      manual={manual}
      naturalIndex={naturalIndex}
      config={rowConfig}
      selected={selected}
      toggleOne={toggleOne}
      columns={columns}
      quickActions={quickActions}
      canDo={canDo}
      rowActionBlocked={rowActionBlocked}
      runRowAction={runRowAction}
      openRow={openRow}
      moveRow={moveRow}
      focusDrag={focusDrag}
      focusRow={focusRow}
      editSpec={editSpec}
      assignSpec={assignSpec}
    />
  )

  return (
    <div className="w-full">
      <PageHeader
        title={config.title ?? schema.title}
        subtitle={`${rows.length} ${rows.length === 1 ? entity[0] : entity[1]}`}
        actions={
          <SheetHeaderActions
            config={config}
            schema={schema}
            canDo={canDo}
            exportEnabled={exportEnabled}
            exportColumns={exportColumns}
            rows={rows}
            primaryAllowed={primaryAllowed}
            primaryPerm={primaryPerm}
            createSpec={createSpec}
            onOpenCreate={() => setCreateOpen(true)}
          />
        }
      />

      {/* Person Focus Mode context banner (appears when scopeBy/scopeVia + focus set) */}
      {focus && scopeActive && <ContextBanner filtered={scopeFiltered} />}

      {/* ops-flows (additive): computed summary strip (e.g. "MUI Watch") */}
      {summaryStrip && <SummaryStrip summaryStrip={summaryStrip} data={data} />}

      {/* toolbar (sticky under topbar) */}
      <SheetToolbar
        config={config}
        schema={schema}
        qRaw={qRaw}
        onSearch={(v) => {
          setQRaw(v)
          setPage(0)
        }}
        filters={filters}
        onAddFilter={(f) => {
          setFilters((fs) => [...fs.filter((x) => x.key !== f.key), f])
          setPage(0)
        }}
        onRemoveFilter={(key) => setFilters((fs) => fs.filter((x) => x.key !== key))}
        orderingEnabled={orderingEnabled}
        ordering={ordering}
        setOrdering={setOrdering}
        onReshuffle={() => setShuffleSeed((s) => s + 1)}
        exportEnabled={exportEnabled}
        exportColumns={exportColumns}
        columnEditor={
          canAdjustColumns ? (
            <ColumnEditor
              scope={layoutScope}
              userId={layoutUser}
              columns={declaredColumns}
              overrides={columnLayout}
              onChange={setColumnLayout}
            />
          ) : undefined
        }
        rows={rows}
        view={view}
        setView={setView}
        compact={compact}
        setCompact={setCompact}
      />

      {/* table card */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}>
        <Card padded={false} className="overflow-hidden">
          {pageRows.length === 0 ? (
            q || filters.length ? (
              <EmptyState
                title={q ? `No ${entity[1]} match “${q}”` : `No matching ${entity[1]}`}
                body="Try clearing the search or removing a filter."
                action={{ label: 'Clear filters', onClick: () => { setQRaw(''); setFilters([]) } }}
              />
            ) : (
              // A GENUINELY EMPTY APP — an empty application leaves a reader with nothing to do.
              unlinkedClient ? (
                <EmptyState
                  title="This account is not linked to anyone yet"
                  body={`The ${entity[0]} app is switched on for you — what is missing is WHICH person this login belongs to. An admin sets that on your account (Users → the person → client link); until then there is nothing here to show, and that is the platform being careful rather than empty.`}
                />
              ) : (
              <EmptyState
                title={`No ${entity[1]} yet`}
                body={`Add your first ${entity[0]} — it lands here and in your workbook at the same time.`}
                action={createSpec && primaryAllowed
                  ? { label: `New ${entity[0]}`, onClick: () => setCreateOpen(true) }
                  : undefined}
              />
              )
            )
          ) : view === 'card' ? (            <CardGrid rows={pageRows} columns={columns} onOpen={openRow} focusDrag={focusDrag} />
          ) : (
            <div className="scroll-thin max-h-[calc(100dvh-300px)] overflow-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--border)]">
                  <tr>
                    {manual && <th className="w-9 py-3 pl-3 pr-0" aria-label="Drag handles" />}
                    {manual && (
                      <th className="w-10 py-3 pl-3 pr-0 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3" title="Natural row number">
                        #
                      </th>
                    )}
                    {config.selectable && (
                      <th className="w-10 px-4 py-3 text-left">
                        <RowCheckbox
                          label="Select all rows on this page"
                          checked={allOnPage}
                          indeterminate={someOnPage && !allOnPage}
                          onChange={toggleAll}
                        />
                      </th>
                    )}
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        style={colSizing(c)}
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3"
                      >
                        {c.sortable ? (
                          <button
                            onClick={() =>
                              setSort((s) =>
                                s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 },
                              )
                            }
                            className="group flex items-center gap-1 transition-colors duration-150 hover:text-text-1"
                          >
                            {c.label}
                            <ArrowUp
                              size={12}
                              className={cn(
                                'transition-all duration-200',
                                sort?.key === c.key ? 'text-primary opacity-100' : 'opacity-0 group-hover:opacity-50',
                                sort?.key === c.key && sort.dir === -1 && 'rotate-180',
                              )}
                            />
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    ))}
                    {(config.rowActions || config.rowBookmark || manual) && <th className="w-20 px-4 py-3" />}
                  </tr>
                </thead>
                {manual ? (
                  <DndContext sensors={orderSensors} collisionDetection={closestCenter} onDragEnd={onOrderDragEnd}>
                    <SortableContext items={pageRows.map((r) => String(r.id))} strategy={verticalListSortingStrategy}>
                      <tbody>
                        {pageRows.map((row) => (
                          <SortableRow
                            key={row.id}
                            id={String(row.id)}
                            onClick={() => openRow(row)}
                            rowRef={focusDrag ? focusRowRef(row) : undefined}
                            title={focusDrag ? `Drag ${String(row[focusDrag.nameKey] ?? 'them')} to the top-left to focus the workspace on them` : undefined}
                            className={cn(
                              'group/row border-b border-border transition-colors duration-150 last:border-0',
                              config.detailPanel && 'cursor-pointer',
                              focusDrag && 'active:cursor-grabbing',
                              selected.has(row.id) ? 'bg-primary-soft' : cn(rowTintClass(config, row) || 'hover:bg-surface-2'),
                            )}
                            style={{ height: rowHeight }}
                          >
                            {renderRowCells(row)}
                          </SortableRow>
                        ))}
                      </tbody>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <motion.tbody
                    key={`${safePage}-${sort?.key}-${sort?.dir}-${ordering}-${shuffleSeed}-${q}-${filters.map((f) => f.value).join()}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                  >
                    {pageRows.map((row, i) => (
                      <motion.tr
                        key={row.id}
                        initial={i < 12 ? { opacity: 0, y: 8 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.2 }}
                        onClick={() => openRow(row)}
                        // native drag wiring via ref — framer-motion consumes onDragStart
                        ref={focusDrag ? focusRowRef(row) : undefined}
                        title={focusDrag ? `Drag ${String(row[focusDrag.nameKey] ?? 'them')} to the top-left to focus the workspace on them` : undefined}
                        className={cn(
                          'group/row border-b border-border transition-colors duration-150 last:border-0',
                          config.detailPanel && 'cursor-pointer',
                          // a row you can pick up should say so under the hand
                          focusDrag && 'active:cursor-grabbing',
                          selected.has(row.id) ? 'bg-primary-soft' : cn(rowTintClass(config, row) || 'hover:bg-surface-2'),
                        )}
                        style={{ height: rowHeight }}
                      >
                        {renderRowCells(row)}
                      </motion.tr>
                    ))}
                  </motion.tbody>
                )}
              </table>
            </div>
          )}

          {/* pagination footer */}
          {rows.length > 0 && (
            <SheetPagination
              total={rows.length}
              rangeFrom={rangeFrom}
              rangeTo={rangeTo}
              pageCount={pageCount}
              safePage={safePage}
              setPage={setPage}
            />
          )}
        </Card>
      </motion.div>

      {/* floating bulk bar */}
      <BulkBar
        config={config}
        entity={entity}
        selected={selected}
        setSelected={setSelected}
        onDelete={deleteSpec && canDelete ? () => setConfirmBulkDelete(true) : undefined}
        configActions={bulkConfigActions}
        onRunConfig={runBulkConfig}
      />

      {createSpec && (
        <CreateRecordModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          spec={createSpec}
          onCreated={(row) => setCreatedRows((rs) => [row, ...rs])}
        />
      )}

      {editSpec && editRow && (
        <EditRecordModal
          open={!!editRow}
          onOpenChange={(o) => !o && setEditRow(null)}
          record={editRow}
          spec={editSpec}
          onSaved={(row) => {
            setPatches((p) => ({ ...p, [String(row.id)]: { ...(p[String(row.id)] ?? {}), ...row } }))
            setEditRow(null)
          }}
        />
      )}

      {deleteSpec && (
        <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && !deleting && setDeleteRow(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {entity[0]}?</AlertDialogTitle>
              <AlertDialogDescription>
                {`"${deleteRow?.name ?? deleteRow?.title ?? deleteRow?.id ?? ''}" will be removed permanently. This cannot be undone from the app.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault()
                  void confirmDelete()
                }}
                className="bg-danger text-white hover:bg-danger/90"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {deleteSpec && (
        <AlertDialog open={confirmBulkDelete} onOpenChange={(o) => !o && !bulkDeleting && setConfirmBulkDelete(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {selected.size} {selected.size === 1 ? entity[0] : entity[1]}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Every selected row is removed permanently from the platform's own sheet. This cannot
                be undone from the app.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={bulkDeleting}
                onClick={(e) => {
                  e.preventDefault()
                  void runBulkDelete()
                }}
                className="bg-danger text-white hover:bg-danger/90"
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selected.size}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {assignSpec && assignRow && (
        <AssignPhotoModal
          open={!!assignRow}
          onOpenChange={(o) => !o && setAssignRow(null)}
          photo={assignRow}
          spec={assignSpec}
          onAssigned={(patch) => {
            setPatches((p) => ({ ...p, [String(assignRow.id)]: { ...(p[String(assignRow.id)] ?? {}), ...patch } }))
            setAssignRow(null)
          }}
        />
      )}

      {/* ops-flows (additive): action modals host (null when nothing open) */}
      {conversationRow && (
        <ConversationModal
          row={conversationRow}
          config={config.conversation as ConversationConfig}
          onClose={() => setConversationRow(null)}
        />
      )}
      <OpsActionModals />
    </div>
  )
}
