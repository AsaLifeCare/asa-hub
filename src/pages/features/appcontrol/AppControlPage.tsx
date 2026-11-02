// App Control (route /app/app-control/board, the master only) — v10.
// The full-screen companion to Settings → App control: every registered app, its effective category and its…
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, ChevronDown, ChevronRight, ChevronUp, GripVertical, Loader2, Lock, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import PageHeader from '@/components/shared/PageHeader'
import SearchInput from '@/components/shared/SearchInput'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import TintTile from '@/components/shared/TintTile'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/auth/useAuthStore'
import { ROLE_LABEL, type Role } from '@/auth/types'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { BADGE_FLOOR_APPS, MASTER_ONLY_APPS, TENANT_BASIC_APPS, useBadgeAccessStore } from '@/lib/badgeAccess'
import { BADGE_ORDER, badgeWord } from '@/components/shared/RoleBadge'
import { reachForApp } from '@/lib/badgeReach'
import { APP_FEATURES } from '@/lib/featureAccess'
import { useTenantStore } from '@/stores/useTenantStore'
import type { Tenant } from '@/lib/tenancy'
import { AppDetailSheet } from './AppDetailSheet'
import { useAppControlStore, type AppControlLayout } from '@/stores/useAppControlStore'
import { useAppControlGrant } from '@/lib/appControlGrant'
import { toast } from '@/stores/useToastStore'
import { gasAction } from '@/features/hiring/shared'
import {
  categoryDefById,
  effectiveCategoryId,
  groupedApps,
  mergedCategoryDefs,
  type CategoryDef,
} from '@/lib/categories'
import { HIGH_CONFIDENCE, suggestCategory, type CategorySuggestion } from '@/lib/categorySuggest'
import { AppIcon } from '@/lib/icons'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { AppManifest } from '@/engine/types'

const ROLES: Role[] = ['admin', 'manager', 'staff', 'client', 'onboarding']
// The matrix draws the five columns above; the Record covers the real Role type's sixth member so the type stays…
const ROLE_SHORT: Record<Role, string> = { admin: 'A', manager: 'M', staff: 'S', client: 'C', onboarding: 'O', interviewer: 'I' }

// The badge a role wears in the master's matrix: lib/badgeAccess folds the role into the badge vocabulary…
const roleBadge = (r: Role) => r.toUpperCase()

// THE MATRIX SPEAKS THE WHOLE VOCABULARY — every badge gets a column, and HM was missing.
const MATRIX_BADGES: string[] = BADGE_ORDER.filter((b) => b !== 'MASTER')
// The same vocabulary as a plain string set — membership tests that do not fight the tuple's literal types.
const MATRIX_BADGE_SET: ReadonlySet<string> = new Set(MATRIX_BADGES)

/** The chip the badge and tenant rows share, so one gesture is learned once. */
const BADGE_CHIP_CLS =
  'rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors'

/** Board column droppable ids (app ids never contain a colon). */
const COL_PREFIX = 'col:'

/** Set compare — the server normalises case and order. */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

// "Unknown action." IS A REFUSAL WEARING A DISGUISE — the write answers 404 with that sentence rather than admit…
function accessErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/unknown action/i.test(msg)) {
    return (
      'The server refused this write by name. Either this session is not the master — the only account that may ' +
      'edit the app matrix — or this door does not answer from the place you are standing in. Your choice stays ' +
      'on screen.'
    )
  }
  return msg || 'Try again.'
}

export type Row = {
  app: AppManifest
  currentId: string
  currentDef?: CategoryDef
  overridden: boolean
  suggestion: CategorySuggestion
  /** live suggestion: engine disagrees with the current placement and the admin hasn't dismissed it */
  pending: boolean
}

/** Confidence → chip tone: ≥70% primary, 45–69% amber, below muted. */
function confidenceChip(confidence: number): string {
  if (confidence >= HIGH_CONFIDENCE) return 'bg-primary-soft text-primary-strong'
  if (confidence >= 0.45) return 'bg-tint-amber text-tint-fg-amber'
  return 'bg-surface-2 text-text-3'
}

/** Smart-suggestion chip — identical in all three layouts. */
function SuggestionChip({ row, onApply, onDismiss }: { row: Row; onApply: () => void; onDismiss: () => void }) {
  if (!row.pending) return null
  const s = row.suggestion
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-semibold', confidenceChip(s.confidence))}
      title={`${s.reasons.join(' · ')} — engine evidence`}
    >
      <Sparkles size={11} className="shrink-0" />
      Suggested: {s.label} · {Math.round(s.confidence * 100)}%
      <button
        onClick={onApply}
        aria-label={`Apply suggestion: move ${row.app.name} to ${s.label}`}
        title={`Apply — move to ${s.label}`}
        className="grid h-4 w-4 place-items-center rounded-full transition-colors hover:bg-surface/70"
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <button
        onClick={onDismiss}
        aria-label={`Dismiss suggestion for ${row.app.name}`}
        title="Dismiss suggestion"
        className="grid h-4 w-4 place-items-center rounded-full transition-colors hover:bg-surface/70"
      >
        <X size={11} strokeWidth={3} />
      </button>
    </span>
  )
}

// Mini per-role audience chips (A/M/S/C/O), lit where the role's badge is on the app's rule — the same read…
function RoleChips({ app, rules }: { app: AppManifest; rules: Record<string, string[]> }) {
  return (
    <span className="flex items-center gap-0.5">
      {ROLES.map((r) => {
        // THE ADMIN CHIP TELLS THE TRUTH LIKE THE REST.
        const on = (rules[app.id] ?? []).includes(roleBadge(r))
        return (
          <span
            key={r}
            title={`${ROLE_LABEL[r]}: ${on ? 'can see this app' : 'hidden'}`}
            className={cn(
              'grid h-4 w-4 place-items-center rounded-[4px] text-[9px] font-bold',
              on ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3/60',
            )}
          >
            {ROLE_SHORT[r]}
          </span>
        )
      })}
    </span>
  )
}

/** Small stat chip for the header band. */
function StatChip({ n, label, tone }: { n: number; label: string; tone?: 'primary' }) {
  return (
    <span
      className={cn(
        'flex items-baseline gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium',
        tone === 'primary' ? 'bg-primary-soft text-primary-strong' : 'bg-surface-2 text-text-2',
      )}
    >
      <b className="text-[12px] font-bold tabular-nums">{n}</b> {label}
    </span>
  )
}

/** Grip-draggable wrapper (one per app row/card) — same interaction language as ManageCategoriesModal. */
function SortableAppRow({
  id,
  children,
}: {
  id: string
  children: (dragHandle: React.ReactNode, isDragging: boolean) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className="grid h-6 w-6 shrink-0 cursor-grab place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 active:cursor-grabbing"
    >
      <GripVertical size={13} />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 rounded-md bg-surface shadow-2 ring-1 ring-primary/40')}
    >
      {children(dragHandle, isDragging)}
    </div>
  )
}

/* ================= BOARD ================= */

// THE CARD IS A DOOR NOW: tile on top, the access mini-squares under it, the NAME under the squares, the…
function BoardCard({
  row,
  compact,
  rules,
  onApply,
  onDismiss,
  onOpen,
}: {
  row: Row
  compact: boolean
  rules: Record<string, string[]>
  onApply: () => void
  onDismiss: () => void
  onOpen: () => void
}) {
  return (
    <SortableAppRow id={row.app.id}>
      {(dragHandle) => (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            // the grip and the suggestion's ✓/✕ keep their own jobs
            if ((e.target as HTMLElement).closest('button')) return
            onOpen()
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
          title={`Open ${row.app.name} — everything the platform knows`}
          className={cn(
            'cursor-pointer rounded-md border border-border bg-surface shadow-1 transition-colors hover:border-primary/50',
            compact ? 'p-2' : 'p-3',
          )}
        >
          <div className="flex justify-start">{dragHandle}</div>
          <div className={cn('flex flex-col items-center gap-1.5 text-center', compact ? '-mt-1' : '-mt-1 pb-1')}>
            <TintTile icon={row.app.icon} tint={row.app.accent} size={compact ? 'md' : 'lg'} />
            <RoleChips app={row.app} rules={rules} />
            <span className="clamp-1 block w-full text-[13px] font-semibold text-text-1">{row.app.name}</span>
            {!compact && row.app.tagline && (
              <span className="clamp-2 block w-full text-[11px] leading-4 text-text-3">{row.app.tagline}</span>
            )}
          </div>
          {row.pending && (
            <div className="mt-2 flex justify-center">
              <SuggestionChip row={row} onApply={onApply} onDismiss={onDismiss} />
            </div>
          )}
        </div>
      )}
    </SortableAppRow>
  )
}

// One category column.
function BoardColumn({
  def,
  rows,
  totalCount,
  compact,
  rules,
  onApply,
  onDismiss,
  onOpen,
}: {
  def: CategoryDef
  rows: Row[]
  totalCount: number
  compact: boolean
  rules: Record<string, string[]>
  onApply: (row: Row) => void
  onDismiss: (row: Row) => void
  onOpen: (row: Row) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COL_PREFIX}${def.id}` })
  const empty = rows.length === 0
  return (
    <div className="flex w-[260px] shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={cn('grid h-6 w-6 place-items-center rounded-[7px]', TINT_PAIR(def.tint))}>
          <AppIcon name={def.icon} size={12} />
        </span>
        <span className="truncate text-[13px] font-semibold text-text-1">{def.label}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-3">
          {totalCount}
        </span>
        {def.custom && <span className="text-[10px] uppercase tracking-wide text-text-3">custom</span>}
      </div>
      <SortableContext items={rows.map((r) => r.app.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'flex min-h-[140px] flex-1 flex-col gap-2 rounded-lg border p-2 transition-colors',
            empty ? 'border-dashed border-border-strong bg-surface-2/40' : 'border-border bg-surface-2/40',
            isOver && 'border-primary bg-primary-soft/40',
          )}
        >
          {rows.map((row) => (
            <BoardCard
              key={row.app.id}
              row={row}
              compact={compact}
              rules={rules}
              onApply={() => onApply(row)}
              onDismiss={() => onDismiss(row)}
              onOpen={() => onOpen(row)}
            />
          ))}
          {empty && (
            <p className="grid flex-1 place-items-center px-3 py-6 text-center text-[11px] leading-4 text-text-3">
              Drop apps here
            </p>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/** Ghost trailing column: inline custom-category creation. */
function NewCategoryColumn() {
  const addCategory = useCategoryStore((s) => s.addCategory)
  const [name, setName] = useState('')
  const create = () => {
    if (addCategory({ label: name, tint: 'mint', icon: 'sparkles' })) setName('')
  }
  return (
    <div className="flex w-[220px] shrink-0 flex-col">
      <div className="mb-2 px-1 text-[13px] font-semibold text-text-3">New category</div>
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong p-3">
        <Plus size={16} className="text-text-3" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="Category name…"
          className="h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />
        <button
          onClick={create}
          disabled={!name.trim()}
          className="h-8 w-full rounded-md bg-primary text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
        >
          + New category
        </button>
      </div>
    </div>
  )
}

/* ================= MATRIX ================= */

/** Every badge toggles, ADMIN and dead badges included — only the MASTER is exempt server-side; a master-only app's row is sealed instead. */
function GrantCell({ badge, app, rules, busy, locked, dead, sealed, onToggle }: {
  badge: string
  app: AppManifest
  rules: Record<string, string[]>
  busy: boolean
  locked: boolean
  /** reachForApp's verdict: the badge can never arrive — say so, still toggle. */
  dead?: string
  /** a master-only app takes no badge rule at all (the server refuses one) — nothing to toggle */
  sealed?: string
  onToggle: (badge: string, app: AppManifest) => void
}) {
  const on = (rules[app.id] ?? []).includes(badge)
  return (
    <button
      onClick={() => onToggle(badge, app)}
      disabled={locked || busy || Boolean(sealed)}
      title={
        sealed
          ? `${badge}: ${sealed}`
          : locked
          ? 'Read-only for now — the master may edit this once the current rules have been read.'
          : dead
            ? `${badge}: ${on ? 'on this rule and grants nothing' : 'grants nothing'} — ${dead}`
            : `${badge}: ${on ? 'allowed — click to deny' : 'denied — click to allow'}`
      }
      aria-pressed={on}
      aria-label={`${badge} access to ${app.name}`}
      className={cn(
        'h-6 min-w-[44px] rounded-full px-2 text-[10px] font-bold uppercase tracking-wide transition-colors',
        on
          ? dead
            ? 'bg-tint-amber text-tint-fg-amber hover:opacity-80'
            : 'bg-tint-mint text-tint-fg-mint hover:opacity-80'
          : 'bg-surface-2 text-text-3 hover:bg-surface-3',
        dead && !on && 'text-text-3/50',
        (locked || busy || sealed) && 'cursor-not-allowed opacity-60',
      )}
    >
      {busy ? <Loader2 size={10} className="mx-auto animate-spin" /> : on ? 'On' : 'Off'}
    </button>
  )
}

/* ================= collapsible group header (matrix + list) ================= */

function GroupHeader({ def, count, collapsed, onToggle }: { def: CategoryDef; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-surface-2/60"
    >
      {collapsed ? <ChevronRight size={13} className="text-text-3" /> : <ChevronDown size={13} className="text-text-3" />}
      <span className={cn('grid h-5 w-5 place-items-center rounded-[6px]', TINT_PAIR(def.tint))}>
        <AppIcon name={def.icon} size={11} />
      </span>
      <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-text-2">{def.label}</span>
      <span className="text-[11px] tabular-nums text-text-3">· {count}</span>
    </button>
  )
}

// List-view section header with the editing hands — sections can be edited, created and moved.
function ListSectionHeader({
  def, count, collapsed, onToggle, canEdit, first, last, deletable,
  onRename, onMove, onDelete,
}: {
  def: CategoryDef
  count: number
  collapsed: boolean
  onToggle: () => void
  canEdit: boolean
  first: boolean
  last: boolean
  deletable: boolean
  onRename: (label: string) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(def.label)
  const commit = () => {
    setEditing(false)
    const v = name.trim()
    if (v && v !== def.label) onRename(v)
  }
  const iconBtn = 'grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex items-center gap-0.5">
      <div className="min-w-0 flex-1">
        {editing ? (
          <span className="flex items-center gap-2 px-1 py-1">
            <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-[6px]', TINT_PAIR(def.tint))}>
              <AppIcon name={def.icon} size={11} />
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') { setName(def.label); setEditing(false) }
              }}
              onBlur={commit}
              className="h-7 w-[220px] rounded-sm border border-border bg-surface px-2 text-[12px] font-semibold text-text-1 outline-none focus:border-border-strong"
            />
          </span>
        ) : (
          <GroupHeader def={def} count={count} collapsed={collapsed} onToggle={onToggle} />
        )}
      </div>
      {canEdit && !editing && (
        <>
          <button
            onClick={() => { setName(def.label); setEditing(true) }}
            title="Rename section" aria-label={`Rename ${def.label}`} className={iconBtn}
          >
            <Pencil size={12} />
          </button>
          <button onClick={() => onMove(-1)} disabled={first} title="Move section up" aria-label={`Move ${def.label} up`} className={iconBtn}>
            <ChevronUp size={13} />
          </button>
          <button onClick={() => onMove(1)} disabled={last} title="Move section down" aria-label={`Move ${def.label} down`} className={iconBtn}>
            <ChevronDown size={13} />
          </button>
          {deletable && (
            <button onClick={onDelete} title="Delete this empty section" aria-label={`Delete ${def.label}`} className={cn(iconBtn, 'hover:text-danger')}>
              <Trash2 size={12} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** The List's own "+ New section" row — same store door as the Board's ghost column. */
function NewSectionRow({ disabled, onCreate }: { disabled: boolean; onCreate: (label: string) => boolean }) {
  const [name, setName] = useState('')
  const create = () => { if (onCreate(name)) setName('') }
  return (
    <div className="flex items-center gap-2 rounded-md border-2 border-dashed border-border-strong px-3 py-2">
      <Plus size={14} className="shrink-0 text-text-3" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && name.trim() && create()}
        placeholder="New section name…"
        disabled={disabled}
        className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2.5 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong disabled:opacity-50"
      />
      <button
        onClick={create}
        disabled={disabled || !name.trim()}
        title={disabled ? 'Waiting for the section shelf to load' : 'Create the section'}
        className="h-8 shrink-0 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
      >
        Add section
      </button>
    </div>
  )
}

/* ================= shared with a person ================= */

/** What App Control shows an account the master shares it with: the server's read, and nothing beside it. */
export type DelegateRead = { apps: string[]; mayChange: boolean; rules: Record<string, string[]> }

/** No rows yet — one object, so a memo over it holds still. */
const NO_RULES: Record<string, string[]> = {}
/** The tenant half a delegate is shown: none. */
const NO_TENANTS: Tenant[] = []

/** The app a matrix row belongs to: the row itself, or what stands before a control's dot. */
function ruleApp(ruleId: string): string {
  const dot = ruleId.indexOf('.')
  return dot > 0 ? ruleId.slice(0, dot) : ruleId
}

// The delegate read as the screen keeps it — held to its own list a second time, so a row of an app that is not on…
export function delegateReadFrom(raw: unknown): DelegateRead {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { apps?: unknown; may_change?: unknown; rules?: unknown }
  const apps: string[] = []
  for (const a of Array.isArray(o.apps) ? o.apps : []) {
    const id = String(a ?? '').trim()
    if (id && !id.includes('.') && !MASTER_ONLY_APPS.includes(id) && !apps.includes(id)) apps.push(id)
  }
  const rules: Record<string, string[]> = {}
  if (o.rules && typeof o.rules === 'object' && !Array.isArray(o.rules)) {
    for (const [id, list] of Object.entries(o.rules as Record<string, unknown>)) {
      if (!apps.includes(ruleApp(id)) || !Array.isArray(list)) continue
      rules[id] = list.map((b) => String(b).toUpperCase().trim()).filter(Boolean)
    }
  }
  return { apps, mayChange: o.may_change === true, rules }
}

/** The registry apps a delegate read names, in the registry's order. */
export function delegateApps(apps: readonly AppManifest[], read: DelegateRead | null): AppManifest[] {
  return read ? apps.filter((a) => read.apps.includes(a.id)) : []
}

/* ================= the page ================= */

export default function AppControlPage() {
  const role = useAuthStore((s) => s.user?.role)
  const me = useAuthStore((s) => s.user)
  const registryApps = useRegistryStore((s) => s.apps)
  /** App Control shared with this account (Settings → App Control access); never for the master. */
  const grant = useAppControlGrant()
  const isMasterSession = me?.isMaster === true
  const delegate = !isMasterSession && grant !== null
  /** the server's own answer for the delegate: the apps, May change and their rows */
  const [delegateRead, setDelegateRead] = useState<DelegateRead | null>(null)
  const apps = useMemo(
    () => (delegate ? delegateApps(registryApps, delegateRead) : registryApps),
    [delegate, registryApps, delegateRead],
  )
  const customCategories = useCategoryStore((s) => s.customCategories)
  const labelOverrides = useCategoryStore((s) => s.labelOverrides)
  const categoryOrder = useCategoryStore((s) => s.categoryOrder)
  const shelfStatus = useCategoryStore((s) => s.status)
  const appCategory = useCategoryStore((s) => s.appCategory)
  const appOrder = useCategoryStore((s) => s.appOrder)
  const assignApp = useCategoryStore((s) => s.assignApp)
  const setAppOrder = useCategoryStore((s) => s.setAppOrder)
  const addCategory = useCategoryStore((s) => s.addCategory)
  const renameCategory = useCategoryStore((s) => s.renameCategory)
  const removeCategory = useCategoryStore((s) => s.removeCategory)
  const setCategoryOrder = useCategoryStore((s) => s.setCategoryOrder)
  // The shelf's own law: a write from a copy that never read is a shelf replaced blind — section editing stays…
  const shelfReady = shelfStatus === 'ready'
  const storeRules = useBadgeAccessStore((s) => s.rules)
  const setStoreRule = useBadgeAccessStore((s) => s.setRule)
  const setRules = useBadgeAccessStore((s) => s.setRules)
  /** The rows this screen draws: the session's matrix for the master, the delegate read's own rows for a delegate. */
  const rules = delegate ? (delegateRead?.rules ?? NO_RULES) : storeRules
  /** Adopt one row the server confirmed — into the session's matrix for the master, into the screen alone for a delegate. */
  const setRule = (appId: string, badges: string[]) => {
    if (!delegate) {
      setStoreRule(appId, badges)
      return
    }
    setDelegateRead((d) => {
      if (!d) return d
      const next = { ...d.rules }
      if (badges.length) next[appId] = badges
      else delete next[appId]
      return { ...d, rules: next }
    })
  }
  const { layout: chosenLayout, density, collapsedGroups, dismissedSuggestions, setLayout, setDensity, toggleGroup, dismissSuggestion, resetDismissed } =
    useAppControlStore()
  // a delegate is shown the Matrix alone: the Board and the List arrange the workspace's sections, which stay the master's
  const layout: AppControlLayout = delegate ? 'matrix' : chosenLayout

  // the app and tenant matrices are the master's pen — and a delegate's on its own apps' rows when May change is…
  const mayEditMatrix = isMasterSession || (delegate && delegateRead?.mayChange === true)

  // WHAT THE PLACE LAW ACTUALLY REFUSES HERE (apps-script/Tenant.gs — away from home an action runs only if it is…
  const tenants = useTenantStore((s) => s.tenants)
  const loadTenants = useTenantStore((s) => s.loadTenants)
  const currentTenantId = useTenantStore((s) => s.currentTenantId)
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  // a personal world never reaches this route — the access checker refuses a master-only app inside any world — so…
  const awayFromHome = Boolean(homeTenantId) && currentTenantId !== homeTenantId
  /** Read at SEND time by the unmount flush, which cannot see a re-render. */
  const awayRef = useRef(awayFromHome)
  useEffect(() => { awayRef.current = awayFromHome }, [awayFromHome])
  const loadShelf = useCategoryStore((s) => s.load)
  // The tenant half of each row — which companies an app belongs to.
  const tenantRules = useBadgeAccessStore((s) => s.tenantRules)
  const setTenantRule = useBadgeAccessStore((s) => s.setTenantRule)
  useEffect(() => { void loadTenants() }, [loadTenants])

  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [onlySuggestions, setOnlySuggestions] = useState(false)
  const compact = density === 'compact'

  // THE TWIN SCROLLBAR — long sections make the bottom bar a journey: dragging from the empty part across to the…
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const topScrollRef = useRef<HTMLDivElement>(null)
  const [boardContentW, setBoardContentW] = useState(0)
  const [boardClientW, setBoardClientW] = useState(0)
  const syncScroll = (from: 'top' | 'board') => () => {
    const top = topScrollRef.current
    const board = boardScrollRef.current
    if (!top || !board) return
    if (from === 'top') { if (board.scrollLeft !== top.scrollLeft) board.scrollLeft = top.scrollLeft }
    else if (top.scrollLeft !== board.scrollLeft) top.scrollLeft = board.scrollLeft
  }

  /* ---------- badge matrix: the read, and the only write path ---------- */

  // EDITING WAITS FOR A REAL READ: the persisted store copy can be stale, and a toggle pressed over it would write…
  const [matrixLoaded, setMatrixLoaded] = useState(false)
  const [matrixError, setMatrixError] = useState('')
  const [matrixAttempt, setMatrixAttempt] = useState(0)
  useEffect(() => {
    // a delegate's rows are its own read: only the apps the master listed, and their controls
    if (!delegate) return
    let alive = true
    setMatrixError('')
    gasAction<unknown>('appControlDelegateGet', {})
      .then((r) => {
        if (!alive) return
        setDelegateRead(delegateReadFrom(r))
        setMatrixLoaded(true)
      })
      .catch((err) => {
        if (!alive) return
        setDelegateRead(null)
        const msg = err instanceof Error ? err.message : ''
        setMatrixError(/unknown action/i.test(msg)
          ? 'App Control is not shared with this account any more.'
          : msg || 'Could not read the apps shared with you.')
      })
    return () => {
      alive = false
    }
  }, [matrixAttempt, delegate])

  useEffect(() => {
    // the read answers from every place — appBadgeAccessGet is declared safe away from headquarters, so refusing to…
    if (!isMasterSession) return
    let alive = true
    setMatrixError('')
    gasAction<{ rules?: Record<string, string[]>; tenantRules?: Record<string, string[]>;
                configRules?: Record<string, string[]> }>('appBadgeAccessGet', {})
      .then((r) => {
        if (!alive) return
        // all three from the same live read: a tenant chip must never edit a copy another path wrote
        setRules(r.rules ?? {})
        useBadgeAccessStore.getState().setTenantRules(r.tenantRules ?? {})
        if (r.configRules) useBadgeAccessStore.getState().setConfigRules(r.configRules)
        setMatrixLoaded(true)
      })
      .catch((err) => {
        if (alive) setMatrixError(err instanceof Error ? err.message : 'Could not read the badge matrix.')
      })
    return () => {
      alive = false
    }
  }, [matrixAttempt, isMasterSession, setRules])

  // Per-app staged badge list; the ref is read at SEND time so a debounce never pushes a list the person has…
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const draftRef = useRef<Record<string, string[]>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const pushRule = (appId: string) => {
    const badges = draftRef.current[appId]
    if (!badges) return
    delete timersRef.current[appId]
    setBusy((b) => ({ ...b, [appId]: true }))
    // name + tagline ride along so the automatic release letter speaks the app's own words (same payload…
    const m = apps.find((a) => a.id === appId)
    void gasAction<{ badges?: string[] }>('appBadgeAccessSet', {
      app_id: appId,
      badges,
      app_meta: m ? { name: m.name, tagline: m.tagline } : undefined,
    })
      .then((r) => {
        // THE ACTION ECHOES WHAT IT WROTE.
        const echoed = r && Array.isArray(r.badges) ? r.badges.map(String) : null
        if (echoed && !sameSet(echoed, badges)) {
          setRule(appId, echoed) // what the sheet truly holds, under the overlay
          toast({
            type: 'danger',
            title: 'Rule saved incompletely',
            body: `The server kept ${echoed.length ? echoed.join(', ') : 'no badges'} of your choice — kept on screen; toggle again to retry.`,
          })
          return
        }
        setRule(appId, echoed ?? badges)
        // retire the overlay only if it is still the list we sent — and keep the REF in step with the state
        const mine = draftRef.current[appId]
        if (mine && sameSet(mine, badges)) {
          const rest = { ...draftRef.current }
          delete rest[appId]
          draftRef.current = rest
          setDraft(rest)
        }
      })
      .catch((err) => {
        const rest = { ...draftRef.current }
        delete rest[appId]
        draftRef.current = rest
        setDraft(rest)
        toast({ type: 'danger', title: 'Rule not saved', body: accessErrorText(err) })
      })
      .finally(() => setBusy((b) => ({ ...b, [appId]: false })))
  }

  // WHAT THE EDITOR CANNOT SHOW, THE SAVE MUST NOT TAKE.
  const carryHidden = (appId: string, chosen: string[]): string[] => {
    const stored = rules[appId] ?? []
    if (!stored.length) return chosen
    const hidden = stored.filter((b) => !MATRIX_BADGE_SET.has(b) && !chosen.includes(b))
    return hidden.length ? [...chosen, ...hidden] : chosen
  }

  const stage = (appId: string, badgesIn: string[]) => {
    // the only edit a master-only row takes is clearing a stale rule, legacy words included
    const badges = MASTER_ONLY_APPS.includes(appId) ? [] : carryHidden(appId, badgesIn)
    draftRef.current = { ...draftRef.current, [appId]: badges }
    setDraft((d) => ({ ...d, [appId]: badges }))
    clearTimeout(timersRef.current[appId])
    // away from home the one-app door is not on the place law's safe list, so the debounce would only buy a 404 per…
    if (awayFromHome) return
    timersRef.current[appId] = setTimeout(() => pushRule(appId), 500)
  }

  /* ---------- the tenant half of every row (appTenantAccessSet) ---------- */

  const [tenantDraft, setTenantDraft] = useState<Record<string, string[]>>({})
  const tenantDraftRef = useRef<Record<string, string[]>>({})
  const tenantTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const pushTenant = (appId: string) => {
    const list = tenantDraftRef.current[appId] ?? []
    delete tenantTimers.current[appId]
    void gasAction('appTenantAccessSet', { app_id: appId, tenants: list })
      .then(() => {
        setTenantRule(appId, list)
        // retire the overlay only if it is still the list we sent — and keep the REF in step with the state…
        const mine = tenantDraftRef.current[appId]
        if (mine && sameSet(mine, list)) {
          const rest = { ...tenantDraftRef.current }
          delete rest[appId]
          tenantDraftRef.current = rest
          setTenantDraft(rest)
        }
      })
      .catch((err) => {
        const rest = { ...tenantDraftRef.current }
        delete rest[appId]
        tenantDraftRef.current = rest
        setTenantDraft(rest)
        toast({ type: 'danger', title: 'Tenant rule not saved', body: accessErrorText(err) })
      })
  }

  const stageTenant = (appId: string, list: string[]) => {
    tenantDraftRef.current = { ...tenantDraftRef.current, [appId]: list }
    setTenantDraft((d) => ({ ...d, [appId]: list }))
    clearTimeout(tenantTimers.current[appId])
    // same law as the badge lane: appTenantAccessSet is not declared safe away from headquarters, and the bulk door…
    if (awayFromHome) return
    tenantTimers.current[appId] = setTimeout(() => pushTenant(appId), 500)
  }

  useEffect(() => {
    const timers = timersRef.current
    const tTimers = tenantTimers.current
    return () => {
      // a decision already made must not die with the screen — only UNFIRED debounces flush here (pushRule deletes…
      for (const id of Object.keys(timers)) {
        clearTimeout(timers[id])
        if (draftRef.current[id]) pushRule(id)
      }
      for (const id of Object.keys(tTimers)) {
        clearTimeout(tTimers[id])
        if (tenantDraftRef.current[id]) pushTenant(id)
      }
      // AND AWAY FROM HOME THERE ARE NO TIMERS TO FLUSH, because the one-app doors are refused there — so the…
      if (!awayRef.current) return
      const leavingRules = { ...draftRef.current }
      const leavingTenants = { ...tenantDraftRef.current }
      if (!Object.keys(leavingRules).length && !Object.keys(leavingTenants).length) return
      const known = useRegistryStore.getState().apps
      const app_meta: Record<string, { name: string; tagline: string }> = {}
      Object.keys(leavingRules).forEach((id) => {
        const m = known.find((a) => a.id === id)
        if (m) app_meta[id] = { name: m.name, tagline: m.tagline }
      })
      void gasAction('appAccessSetBulk', {
        rules: leavingRules,
        tenants: leavingTenants,
        app_meta,
      }).catch((err) => {
        console.error('[app-control] leaving with staged rules: bulk write refused:', err)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The twin bar's width is the board's content width; re-measured whenever the columns can change shape.
  useEffect(() => {
    const el = boardScrollRef.current
    if (!el) return
    setBoardContentW(el.scrollWidth)
    setBoardClientW(el.clientWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, customCategories.length, compact])

  // What every screen below reads: the stored rules with the staged drafts overlaid, so a toggle paints immediately…
  const effectiveRules = useMemo(() => ({ ...rules, ...draft }), [rules, draft])
  /** The tenant lane's twin of the above. */
  const effectiveTenantRules = useMemo(
    () => ({ ...tenantRules, ...tenantDraft }),
    [tenantRules, tenantDraft],
  )

  // Matrix toggle: flip a badge on the app's rule.
  const toggleBadge = (badge: string, app: AppManifest) => {
    const current = effectiveRules[app.id] ?? []
    stage(app.id, current.includes(badge) ? current.filter((x) => x !== badge) : [...current, badge])
  }

  // APPLY CARRIES WHAT THE MATRIX DREW, NOT WHAT IS INSTALLED.
  const matrixAppIds = useMemo(() => apps.map((a) => a.id), [apps])

  // APPLY: the whole matrix to the sheet in ONE press, then judged against what that same write echoed back.
  const [applying, setApplying] = useState(false)
  const applyMatrix = async () => {
    if (applying) return
    setApplying(true)
    for (const id of Object.keys(timersRef.current)) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
    for (const id of Object.keys(tenantTimers.current)) {
      clearTimeout(tenantTimers.current[id])
      delete tenantTimers.current[id]
    }
    const staged = { ...draftRef.current }
    const stagedTenants = { ...tenantDraftRef.current }
    // the controls INSIDE an app are rows in the SAME sheet, so they ride the same press — a feature chip clicked…
    const featureIds = matrixAppIds.flatMap((id) => (APP_FEATURES[id] ?? []).map((f) => f.id))
    // every id this screen drew a control for, plus anything staged: an answer given about an app the registry has…
    const jobIds = Array.from(new Set([...matrixAppIds, ...featureIds, ...Object.keys(staged)]))
    const jobs = jobIds
      .map((id) => {
        // a master-only app takes no rule (the server refuses one): a stale row leaves as an empty list, no row sends nothing
        if (MASTER_ONLY_APPS.includes(id)) {
          return { appId: id, badges: rules[id]?.length || staged[id] !== undefined ? [] : undefined }
        }
        return { appId: id, badges: staged[id] ?? rules[id] }
      })
      .filter((j): j is { appId: string; badges: string[] } => Array.isArray(j.badges))
    const tenantJobs = Object.keys(stagedTenants).map((appId) => ({ appId, tenants: stagedTenants[appId] }))
    // a delegate's Apply carries its own apps' rows and nothing else; with none written yet there is nothing to send
    if (delegate && !jobs.length) {
      setApplying(false)
      toast({ type: 'info', title: 'Nothing to apply', body: 'None of these apps has a badge row yet — tick a badge first.' })
      return
    }
    const rulesPayload: Record<string, string[]> = {}
    jobs.forEach((j) => { rulesPayload[j.appId] = j.badges })
    const tenantsPayload: Record<string, string[]> = {}
    tenantJobs.forEach((j) => { tenantsPayload[j.appId] = j.tenants })
    const asList = (v: unknown) =>
      typeof v === 'string' ? v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) : []
    let fresh: { rules: Record<string, string[]>; tenantRules: Record<string, string[]> } | null = null
    let refused = ''
    let queued = false
    try {
      // names + taglines ride along so the automatic release letter speaks the app's own words, not its id
      const app_meta: Record<string, { name: string; tagline: string }> = {}
      Object.keys(rulesPayload).forEach((id) => {
        const m = apps.find((a) => a.id === id)
        if (m) app_meta[id] = { name: m.name, tagline: m.tagline }
      })
      const echo = await gasAction<{ badges?: Record<string, string>; tenants?: Record<string, string>; accepted?: boolean }>(
        'appAccessSetBulk',
        { rules: rulesPayload, tenants: tenantsPayload, app_meta },
      )
      if (echo?.badges) {
        const back: Record<string, string[]> = {}
        Object.keys(echo.badges).forEach((k) => { back[k] = asList(echo.badges?.[k]) })
        const backTenants: Record<string, string[]> = {}
        Object.keys(echo.tenants ?? {}).forEach((k) => {
          backTenants[k] = String(echo.tenants?.[k] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
        })
        fresh = { rules: back, tenantRules: backTenants }
      } else if (echo?.accepted) {
        // THE QUEUE IS NOT A MISS: the relay's write-ledger answers a slow write with {accepted:true}.
        queued = true
      }
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e)
      console.error('[app-control] appAccessSetBulk refused:', e)
    }
    setApplying(false)
    if (!fresh) {
      if (queued) {
        toast({
          type: 'info',
          title: 'Accepted — landing shortly',
          body: 'The server queued the matrix behind in-flight work and is finishing it — it lands within a minute. Your selections stay on screen; press Apply in a moment to confirm.',
        })
        return
      }
      toast({
        type: 'danger',
        title: refused ? 'Not applied — the server refused' : 'Applied, but not confirmed',
        body: refused
          ? `${accessErrorText(new Error(refused))} — your selections stay on screen; nothing was written.`
          : 'The confirming answer never arrived — your selections stay on screen; press Apply again.',
      })
      return
    }
    let confirmedN = 0
    let keptN = 0
    const clearIds: string[] = []
    for (const j of jobs) {
      const got = fresh.rules[j.appId] ?? [] // no row = the master's alone
      if (sameSet(got, j.badges)) {
        confirmedN += 1
        setRule(j.appId, j.badges) // adopt ONLY what the sheet echoed back
        if (staged[j.appId]) clearIds.push(j.appId)
      } else {
        keptN += 1 // the overlay (or the old rule) keeps painting the choice
      }
    }
    const clearTenantIds: string[] = []
    for (const j of tenantJobs) {
      const got = fresh.tenantRules[j.appId] ?? [] // no row = every tenant
      if (sameSet(got, j.tenants)) {
        confirmedN += 1
        setTenantRule(j.appId, j.tenants)
        clearTenantIds.push(j.appId)
      } else {
        keptN += 1
      }
    }
    if (clearIds.length) {
      const rest = { ...draftRef.current }
      for (const id of clearIds) if (rest[id] === staged[id]) delete rest[id]
      draftRef.current = rest
      setDraft(rest)
    }
    if (clearTenantIds.length) {
      const rest = { ...tenantDraftRef.current }
      for (const id of clearTenantIds) if (rest[id] === stagedTenants[id]) delete rest[id]
      tenantDraftRef.current = rest
      setTenantDraft(rest)
    }
    toast(
      keptN
        ? {
            type: 'danger',
            title: 'Apply finished with misses',
            body: `${confirmedN} rules confirmed on the sheet · ${keptN} did not land — kept on screen; press Apply again.`,
          }
        : {
            type: 'success',
            title: 'Matrix applied',
            body: `${confirmedN} rules confirmed on the sheet.`,
          },
    )
  }

  /** The Board's click-through detail — 100% of what the platform knows. */
  const [detailRow, setDetailRow] = useState<Row | null>(null)

  // labelOverrides + categoryOrder were dropped here for weeks: renames and section order showed everywhere EXCEPT…
  const defs = useMemo(
    () => mergedCategoryDefs(customCategories, labelOverrides, categoryOrder),
    [customCategories, labelOverrides, categoryOrder],
  )

  /* every app → current category + live suggestion */
  const rows = useMemo<Row[]>(
    () =>
      apps.map((app) => {
        const currentId = effectiveCategoryId(app, appCategory, defs)
        const suggestion = suggestCategory(app, defs, currentId)
        return {
          app,
          currentId,
          currentDef: categoryDefById(defs, currentId),
          overridden: !!appCategory[app.id],
          suggestion,
          // a suggestion moves an app between the workspace's sections, which a delegate does not arrange
          pending:
            !delegate &&
            suggestion.hasSignal &&
            suggestion.categoryId !== currentId &&
            !dismissedSuggestions.includes(app.id),
        }
      }),
    [apps, appCategory, defs, dismissedSuggestions, delegate],
  )

  const pending = rows.filter((r) => r.pending)
  const applicable = pending.filter((r) => r.suggestion.confidence >= HIGH_CONFIDENCE)

  const visibleRows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return rows
      .filter((r) => (onlySuggestions ? r.pending : true))
      .filter((r) => (catFilter === 'all' ? true : r.currentId === catFilter))
      .filter((r) =>
        query ? `${r.app.name} ${r.app.tagline} ${r.app.id}`.toLowerCase().includes(query) : true,
      )
  }, [rows, onlySuggestions, catFilter, q])

  const rowsByCat = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of visibleRows) {
      const list = map.get(r.currentId)
      if (list) list.push(r)
      else map.set(r.currentId, [r])
    }
    return map
  }, [visibleRows])

  // NO ENABLED APP MAY VANISH FROM THE SCREEN THAT GRANTS ACCESS.
  const matrixDefs = useMemo(() => {
    const orphans: CategoryDef[] = []
    for (const cid of rowsByCat.keys()) {
      if (!defs.some((d) => d.id === cid)) {
        orphans.push({ id: cid, label: cid, tint: 'blue', icon: 'layout-grid', custom: false })
      }
    }
    return orphans.length ? [...defs, ...orphans] : defs
  }, [defs, rowsByCat])

  /* unfiltered groups back the drag index math so a filtered drop still lands right */
  const fullGroups = useMemo(() => groupedApps(apps, appCategory, defs, appOrder), [apps, appCategory, defs, appOrder])

  /** Apply a suggestion (or any move): assignment override + land at the END of the target's stored order. */
  const applyMove = (app: AppManifest, targetId: string) => {
    assignApp(app.id, targetId === app.category ? null : targetId)
    const state = useCategoryStore.getState()
    const ids = (groupedApps(apps, state.appCategory, defs, state.appOrder).find((g) => g.def.id === targetId)?.apps ?? [])
      .map((a) => a.id)
      .filter((id) => id !== app.id)
    setAppOrder(targetId, [...ids, app.id])
  }

  const applySuggestion = (row: Row) => {
    applyMove(row.app, row.suggestion.categoryId)
    toast({
      type: 'success',
      title: `“${row.app.name}” moved to ${row.suggestion.label}`,
      body: `Confidence ${Math.round(row.suggestion.confidence * 100)}% — sidebar and App Hub updated.`,
    })
  }

  const applyAll = () => {
    for (const r of applicable) applyMove(r.app, r.suggestion.categoryId)
    toast({
      type: 'success',
      title: `Applied ${applicable.length} high-confidence ${applicable.length === 1 ? 'suggestion' : 'suggestions'}`,
      body: `Everything at ≥ ${Math.round(HIGH_CONFIDENCE * 100)}% confidence was reassigned.`,
    })
  }

  /* ---------- dnd ---------- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  // Board: ONE DndContext across all columns.
  const onBoardDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    const activeApp = apps.find((a) => a.id === activeId)
    if (!activeApp) return
    const sourceCat = effectiveCategoryId(activeApp, appCategory, defs)

    let targetCat: string | undefined
    let insertIndex: number | null = null
    if (overId.startsWith(COL_PREFIX)) {
      targetCat = overId.slice(COL_PREFIX.length)
    } else {
      const overApp = apps.find((a) => a.id === overId)
      if (!overApp) return
      targetCat = effectiveCategoryId(overApp, appCategory, defs)
      const ids = fullGroups.find((g) => g.def.id === targetCat)?.apps.map((a) => a.id) ?? []
      insertIndex = ids.indexOf(overId)
    }
    if (!targetCat) return

    if (targetCat === sourceCat) {
      if (insertIndex === null) return // dropped on own column's padding
      const ids = fullGroups.find((g) => g.def.id === sourceCat)?.apps.map((a) => a.id) ?? []
      const from = ids.indexOf(activeId)
      if (from === -1 || insertIndex === -1 || from === insertIndex) return
      setAppOrder(sourceCat, arrayMove(ids, from, insertIndex))
      return
    }

    const targetIds = (fullGroups.find((g) => g.def.id === targetCat)?.apps.map((a) => a.id) ?? []).filter(
      (id) => id !== activeId,
    )
    const at = insertIndex === null || insertIndex === -1 ? targetIds.length : Math.min(insertIndex, targetIds.length)
    assignApp(activeId, targetCat === activeApp.category ? null : targetCat)
    const next = [...targetIds]
    next.splice(at, 0, activeId)
    setAppOrder(targetCat, next)
    const label = categoryDefById(defs, targetCat)?.label ?? targetCat
    toast({ type: 'success', title: `“${activeApp.name}” moved to ${label}`, body: 'Sidebar and App Hub updated.' })
  }

  /** List: within-group reorder only (moving between categories is the Select's job). */
  const onListDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const group = fullGroups.find((g) => g.apps.some((a) => a.id === active.id))
    if (!group || !group.apps.some((a) => a.id === over.id)) return
    const ids = group.apps.map((a) => a.id)
    setAppOrder(group.def.id, arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  if (role !== 'admin' && !delegate) {
    return (
      <div className="mx-auto max-w-[720px]">
        <Card padded={false}>
          <EmptyState
            title="App Control is an admin screen"
            body="It manages every app's category, and which badges and tenants reach it. Sign in as an admin to use it."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full">
      <PageHeader
        title="App Control"
        subtitle={delegate
          ? 'The apps the master shares with you, and which badges reach each one and the controls inside it.'
          : 'Every app, its category and who reaches it — drag between columns, grant by badge and tenant in the Matrix, or take the smart suggestion.'}
        actions={delegate ? undefined : (
          <SegmentedTabs
            tabs={[
              { id: 'board', label: 'Board' },
              { id: 'matrix', label: 'Matrix' },
              { id: 'list', label: 'List' },
            ]}
            value={layout}
            onChange={(id) => setLayout(id as AppControlLayout)}
          />
        )}
      />

      {/* stat chips + filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatChip n={apps.length} label="apps" />
        {!delegate && <StatChip n={defs.length} label="categories" />}
        {!delegate && <StatChip n={pending.length} label="suggestions pending" tone={pending.length ? 'primary' : undefined} />}
        {!delegate && dismissedSuggestions.length > 0 && (
          <button
            onClick={resetDismissed}
            className="text-[11px] font-medium text-text-3 underline-offset-2 transition-colors hover:text-text-1 hover:underline"
          >
            Reset dismissed ({dismissedSuggestions.length})
          </button>
        )}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <SearchInput value={q} onChange={setQ} placeholder="Search apps…" className="w-[200px]" />
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-9 w-[160px] rounded-md border-border bg-surface text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {defs.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!delegate && (
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-text-2">
            <Switch checked={onlySuggestions} onCheckedChange={setOnlySuggestions} aria-label="Only suggestions" />
            Only suggestions
          </label>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-[12px] font-medium text-text-2">
          <Switch checked={compact} onCheckedChange={(c) => setDensity(c ? 'compact' : 'comfortable')} aria-label="Compact density" />
          Compact
        </label>
      </div>

      {/* smart banner */}
      {pending.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary-soft px-4 py-3">
          <Sparkles size={16} className="shrink-0 text-primary-strong" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-primary-strong">
              {pending.length} {pending.length === 1 ? 'app looks' : 'apps look'} misplaced
            </p>
            <p className="text-[12px] text-text-2">
              {applicable.length} at ≥ {Math.round(HIGH_CONFIDENCE * 100)}% confidence — review them or apply in bulk.
            </p>
          </div>
          <button
            onClick={() => setOnlySuggestions((v) => !v)}
            className="h-8 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            {onlySuggestions ? 'Show all' : 'Review'}
          </button>
          <button
            onClick={applyAll}
            disabled={applicable.length === 0}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
          >
            <Check size={13} /> Apply all ≥ {Math.round(HIGH_CONFIDENCE * 100)}%
          </button>
        </div>
      )}

      {/* ================= BOARD ================= */}
      {layout === 'board' && (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onBoardDragEnd}>
          {boardContentW > boardClientW && (
            <div
              ref={topScrollRef}
              onScroll={syncScroll('top')}
              className="mb-1 overflow-x-auto pb-1"
              aria-hidden
            >
              <div style={{ width: boardContentW, height: 1 }} />
            </div>
          )}
          <div
            ref={boardScrollRef}
            onScroll={syncScroll('board')}
            className="flex items-start gap-3 overflow-x-auto pb-4"
          >
            {defs.map((def) => (
              <BoardColumn
                key={def.id}
                def={def}
                rows={rowsByCat.get(def.id) ?? []}
                totalCount={rows.filter((r) => r.currentId === def.id).length}
                compact={compact}
                rules={effectiveRules}
                onApply={applySuggestion}
                onDismiss={(row) => dismissSuggestion(row.app.id)}
                onOpen={setDetailRow}
              />
            ))}
            <NewCategoryColumn />
          </div>
        </DndContext>
      )}

      {/* ================= MATRIX ================= */}
      {layout === 'matrix' && (
        <Card padded={false} className="overflow-hidden">
          {/* WHAT THE PLACE LAW REFUSES, AND NOTHING MORE. Reading the matrix
              and pressing Apply are declared safe away from headquarters
              (Tenant.gs); saving one app per click is not. So the cells stay
              live and the banner says which gesture changed, instead of
              claiming a refusal the platform never makes. */}
          {awayFromHome && mayEditMatrix && (
            <p className="flex items-start gap-2 border-b border-border bg-tint-amber px-4 py-2.5 text-[12.5px] leading-5 text-text-2">
              <Lock size={13} className="mt-0.5 shrink-0" />
              <span>
                You are away from home, so cells do not save as you click — that one-app save is refused
                outside headquarters. Everything else works from here: the matrix is read live, and Apply
                writes the whole thing in one go. Choose freely, then press Apply.
              </span>
            </p>
          )}
          {matrixError && (mayEditMatrix || delegate) && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-3"
              data-ac-matrix-error>
              <p className="text-[12.5px] text-text-2">
                {delegate
                  ? `${matrixError} Nothing is drawn until the apps shared with you are read again.`
                  : `${matrixError} Editing stays closed until the current rules are read — a toggle pressed over a stale copy would write a rule nobody saw.`}
              </p>
              <button
                type="button"
                onClick={() => setMatrixAttempt((n) => n + 1)}
                className="h-8 shrink-0 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-3"
              >
                Retry
              </button>
            </div>
          )}
          {!mayEditMatrix && !delegate && (
            <p className="border-b border-border bg-surface-2 px-4 py-2.5 text-[12px] text-text-3">
              Read-only — the badge matrix is the master's word alone. The server re-decides every write
              regardless of what this screen draws.
            </p>
          )}
          {/* SHARED WITH YOU: what the share lets this account do, said before a cell is drawn */}
          {delegate && delegateRead && (
            <p className={cn('flex items-start gap-2 border-b border-border px-4 py-2.5 text-[12.5px] leading-5 text-text-2',
              delegateRead.mayChange ? 'bg-primary-soft' : 'bg-surface-2')} data-ac-delegate-banner>
              {!delegateRead.mayChange && <Lock size={13} className="mt-0.5 shrink-0" />}
              <span>
                {delegateRead.mayChange
                  ? 'Shared with you by the master: you may change these apps’ rows and the controls inside them, and nothing else. Every change carries your name.'
                  : 'View only — the master shares these apps with you to look at. Changing them is the master’s to allow.'}
              </span>
            </p>
          )}
          {(isMasterSession || delegate) && !matrixLoaded && !matrixError && (
            <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-[12px] text-text-3">
              <Loader2 size={13} className="animate-spin" />
              {delegate ? 'Reading the apps shared with you…' : 'Reading the badge matrix…'}
            </p>
          )}
          {!delegate && shelfStatus === 'error' && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-3">
              <p className="text-[12.5px] text-text-2">
                The workspace sections could not be read, so arranging them stays closed — a save replaces the
                whole shelf, and one made over a stale copy would replace the company's arrangement with this
                browser's.
              </p>
              <button
                type="button"
                onClick={() => void loadShelf()}
                className="h-8 shrink-0 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-3"
              >
                Retry
              </button>
            </div>
          )}
          {delegate ? (
            <p className="border-b border-border px-4 py-2.5 text-[12px] leading-5 text-text-3">
              The apps the master shares with you, and which badges reach them. A row with badges is a closed door for
              everyone else, and an app with NO badges is the master's alone. The controls under an app follow their
              own row.
            </p>
          ) : (
            <p className="border-b border-border px-4 py-2.5 text-[12px] leading-5 text-text-3">
              Every app in the workspace, and which badges reach it. A row with badges is a closed door for everyone
              else, and an app with NO badges is yours alone — a new app is born private and becomes somebody's the
              moment you tick a badge for it. The workspace's own chrome is the one exception, so an omission cannot
              delete everybody's home screen. You always see everything.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">App</th>
                  {MATRIX_BADGES.map((b) => (
                    <th key={b} className="w-[64px] px-1.5 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.05em] text-text-3">
                      {badgeWord(b)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixDefs.map((def) => {
                  const group = rowsByCat.get(def.id) ?? []
                  if (group.length === 0) return null
                  const collapsed = collapsedGroups.includes(def.id)
                  return (
                    <MatrixGroup
                      key={def.id}
                      def={def}
                      rows={group}
                      collapsed={collapsed}
                      onToggle={() => toggleGroup(def.id)}
                      compact={compact}
                      rules={effectiveRules}
                      busy={busy}
                      locked={!mayEditMatrix || !matrixLoaded}
                      tenants={delegate ? NO_TENANTS : tenants}
                      tenantRules={effectiveTenantRules}
                      viewer={delegate ? 'delegate' : 'master'}
                      onToggleBadge={toggleBadge}
                      onStage={stage}
                      onStageTenant={stageTenant}
                      onApply={applySuggestion}
                      onDismiss={(row) => dismissSuggestion(row.app.id)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
          {visibleRows.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-text-3">No apps match the current filters.</p>
          )}
          {/* APPLY at the table's end — the whole matrix to the sheet in one
              press, then judged against what that write echoed back. */}
          {mayEditMatrix && (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
              <span className="text-[11.5px] text-text-3">
                {delegate
                  ? 'Cells save as you click — Apply re-sends these apps’ rows and confirms them against the sheet.'
                  : awayFromHome
                    ? 'Away from home, Apply is the save — it writes the whole matrix in one go and confirms it against the sheet.'
                    : 'Cells save as you click — Apply re-sends the whole matrix and confirms it against the sheet.'}
              </span>
              <button
                onClick={() => { void applyMatrix() }}
                disabled={applying || !matrixLoaded}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* ================= LIST ================= */}
      {layout === 'list' && (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onListDragEnd}>
          <div className="space-y-3">
            {defs.map((def, defIdx) => {
              const group = rowsByCat.get(def.id) ?? []
              // empty sections STAY VISIBLE here (a just-created one used to vanish until an app moved in); the…
              const totalInCat = rows.filter((r) => r.currentId === def.id).length
              if (group.length === 0 && totalInCat > 0) return null
              const collapsed = collapsedGroups.includes(def.id)
              return (
                <div key={def.id}>
                  <ListSectionHeader
                    def={def}
                    count={group.length}
                    collapsed={collapsed}
                    onToggle={() => toggleGroup(def.id)}
                    canEdit={shelfReady}
                    first={defIdx === 0}
                    last={defIdx === defs.length - 1}
                    deletable={!!def.custom && totalInCat === 0}
                    onRename={(label) => renameCategory(def.id, label)}
                    onMove={(dir) => {
                      const ids = defs.map((d) => d.id)
                      const j = defIdx + dir
                      if (j < 0 || j >= ids.length) return
                      setCategoryOrder(arrayMove(ids, defIdx, j))
                    }}
                    onDelete={() => removeCategory(def.id)}
                  />
                  {!collapsed && group.length === 0 && (
                    <p className="rounded-md border border-dashed border-border-strong px-3 py-3 text-[12px] text-text-3">
                      No apps here yet — use the category select on any app to move it in.
                    </p>
                  )}
                  {!collapsed && group.length > 0 && (
                    <SortableContext items={group.map((r) => r.app.id)} strategy={verticalListSortingStrategy}>
                      <div className="divide-y divide-border rounded-md border border-border">
                        {group.map((row) => (
                          <SortableAppRow key={row.app.id} id={row.app.id}>
                            {(dragHandle) => (
                              <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2', compact ? 'py-1.5' : 'py-2.5')}>
                                {dragHandle}
                                <AppIcon name={row.app.icon} size={15} className="shrink-0 text-text-3" />
                                <span className="min-w-0 w-[220px]">
                                  <span className="clamp-1 block text-[13px] font-medium text-text-1">{row.app.name}</span>
                                  {!compact && <span className="clamp-1 block text-[11px] text-text-3">{row.app.tagline}</span>}
                                </span>
                                <Select
                                  value={row.currentId}
                                  onValueChange={(v) => assignApp(row.app.id, v === row.app.category ? null : v)}
                                >
                                  <SelectTrigger className="h-8 w-[150px] shrink-0 rounded-sm border-border bg-surface text-[12px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {defs.map((d) => (
                                      <SelectItem key={d.id} value={d.id}>
                                        {d.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <RoleChips app={row.app} rules={effectiveRules} />
                                <span className="ml-auto">
                                  <SuggestionChip row={row} onApply={() => applySuggestion(row)} onDismiss={() => dismissSuggestion(row.app.id)} />
                                </span>
                              </div>
                            )}
                          </SortableAppRow>
                        ))}
                      </div>
                    </SortableContext>
                  )}
                </div>
              )
            })}
            {visibleRows.length === 0 && (
              <Card padded={false}>
                <p className="px-3 py-8 text-center text-[13px] text-text-3">No apps match the current filters.</p>
              </Card>
            )}
            <NewSectionRow
              disabled={!shelfReady}
              onCreate={(label) => addCategory({ label, tint: 'mint', icon: 'sparkles' }) !== null}
            />
          </div>
        </DndContext>
      )}

      <AppDetailSheet
        detail={detailRow}
        rule={detailRow ? (effectiveRules[detailRow.app.id] ?? []) : []}
        onClose={() => setDetailRow(null)}
      />
    </div>
  )
}

/* matrix group extracted so hooks/rules stay flat above; exported for the tests of what each viewer is drawn */
export function MatrixGroup({
  def,
  rows,
  collapsed,
  onToggle,
  compact,
  rules,
  busy,
  locked,
  tenants,
  tenantRules,
  onToggleBadge,
  onStage,
  onStageTenant,
  onApply,
  onDismiss,
  viewer = 'master',
}: {
  def: CategoryDef
  rows: Row[]
  collapsed: boolean
  onToggle: () => void
  compact: boolean
  rules: Record<string, string[]>
  busy: Record<string, boolean>
  locked: boolean
  tenants: Tenant[]
  tenantRules: Record<string, string[]>
  onToggleBadge: (badge: string, app: AppManifest) => void
  // stage a whole list for a row — the clear, the take-it-off and the controls inside an app all write through it.
  onStage: (id: string, badges: string[]) => void
  onStageTenant: (appId: string, tenants: string[]) => void
  onApply: (row: Row) => void
  onDismiss: (row: Row) => void
  /** who reads the row: the same row says "you" to the master and "the master" to an account it is shared with */
  viewer?: 'master' | 'delegate'
}) {
  const shared = viewer === 'delegate'
  return (
    <>
      <tr className="border-b border-border bg-surface-2/50">
        <td colSpan={MATRIX_BADGES.length + 1} className="px-2 py-1">
          <GroupHeader def={def} count={rows.length} collapsed={collapsed} onToggle={onToggle} />
        </td>
      </tr>
      {!collapsed &&
        rows.map((row) => {
          // badges the code proves can never reach this app keep their cell — they are tinted and explained under…
          const reach = reachForApp(MATRIX_BADGES, row.app)
          const badges = rules[row.app.id] ?? []
          // NO BADGES MEANS YOURS ALONE, and this row used to say nothing at all for that state.
          const undecided = badges.length === 0
          const isFloor = BADGE_FLOOR_APPS.includes(row.app.id)
          const masterOnly = MASTER_ONLY_APPS.includes(row.app.id)
          const dead = badges.filter((b) => reach.dropped.includes(b))
          const features = APP_FEATURES[row.app.id] ?? []
          const tenantList = tenantRules[row.app.id] ?? []
          const showTenants = tenants.length > 1
          const hasExtras = dead.length > 0 || features.length > 0 || showTenants
          return (
          <Fragment key={row.app.id}>
          <tr className={cn('border-b border-border', hasExtras && 'border-b-0')}>
            <td className={cn('px-3', compact ? 'py-1.5' : 'py-2.5')}>
              <div className="flex flex-wrap items-center gap-2">
                <AppIcon name={row.app.icon} size={15} className="shrink-0 text-text-3" />
                <span className="min-w-0">
                  <span className="clamp-1 block text-[13px] font-medium text-text-1">{row.app.name}</span>
                  {!compact && <span className="clamp-1 block text-[11px] text-text-3">{row.app.tagline}</span>}
                </span>
                {busy[row.app.id] && <Loader2 size={13} className="shrink-0 animate-spin text-text-3" />}
                {undecided ? (
                  <span
                    className="shrink-0 text-[11.5px] font-medium text-text-3"
                    title={isFloor
                      ? 'A workspace basic — every employee keeps it, whatever the matrix says.'
                      : masterOnly
                        ? 'Yours alone in every place — no badge and no tenant rule opens it to anybody else.'
                        : shared
                          ? 'Nobody has been given this app yet, so it opens for the master and nobody else.'
                          : 'Nobody has been given this app yet, so it opens for you and nobody else.'}
                  >
                    {isFloor ? 'Everyone — a basic' : masterOnly ? 'Only you — always' : shared ? 'Only the master' : 'Only you'}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onStage(row.app.id, [])}
                    title={isFloor
                      ? 'Clear the badges — a basic goes back to every employee.'
                      : shared
                        ? 'Clear the badges — the app becomes the master’s alone again.'
                        : 'Clear the badges — the app becomes yours alone again.'}
                    className="shrink-0 text-[11.5px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                  >
                    {isFloor ? 'Back to everyone' : shared ? 'Back to the master alone' : 'Make it mine alone'}
                  </button>
                )}
                <SuggestionChip row={row} onApply={() => onApply(row)} onDismiss={() => onDismiss(row)} />
              </div>
            </td>
            {MATRIX_BADGES.map((b) => (
              <td key={b} className="px-1.5 py-1.5 text-center">
                <GrantCell
                  badge={b}
                  app={row.app}
                  rules={rules}
                  busy={!!busy[row.app.id]}
                  locked={locked}
                  dead={reach.dropped.includes(b) ? reach.why : undefined}
                  sealed={masterOnly ? reach.why : undefined}
                  onToggle={onToggleBadge}
                />
              </td>
            ))}
          </tr>
          {hasExtras && (
            <tr className="border-b border-border last:border-0">
              <td colSpan={MATRIX_BADGES.length + 1} className="px-3 pb-2.5">
                {/**
                  * A RULE THAT NAMES A BADGE THE APP CAN NEVER SERVE. The
                  * cell stays tickable — hiding it answers "what may I
                  * choose", and the question actually asked is "why did what
                  * I chose not happen". The audience is written in the app's
                  * own code by whoever built it, and this matrix is the only
                  * screen that sees both.
                  */}
                {dead.length > 0 && (
                  <p className="text-[11.5px] leading-[16px] text-tint-fg-amber">
                    <span className="font-semibold">{dead.join(', ')}</span> {dead.length > 1 ? 'are' : 'is'} on
                    this rule and {dead.length > 1 ? 'grant' : 'grants'} nothing — {reach.why || 'this app is not built for that role'}.
                    An audience is written in the app's own code; the matrix can only narrow it.{' '}
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onStage(row.app.id, badges.filter((b) => !dead.includes(b)))}
                      className="font-semibold underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Take {dead.length > 1 ? 'them' : 'it'} off
                    </button>
                  </p>
                )}
                {/**
                  * AND THE CONTROLS INSIDE IT. A feature id is a row in the
                  * SAME sheet (`appid.feature -> badges`), so it needs no
                  * store field and no handler, and it disappears with the app
                  * for free. The polarity is the opposite of the app's, on
                  * purpose: no badges on an APP means yours alone, because an
                  * app is a door; no badges on a FEATURE means everyone who
                  * already reached the page.
                  */}
                {features.map((f) => {
                  const fb = rules[f.id] ?? []
                  return (
                    <div key={f.id} className="mt-1.5 border-t border-border/60 pt-1.5">
                      <div className="flex items-center gap-2">
                        <span className="clamp-1 min-w-0 flex-1 text-[12px] font-semibold text-text-2">{f.label}</span>
                        {busy[f.id] && <Loader2 size={12} className="shrink-0 animate-spin text-text-3" />}
                        {fb.length === 0 ? (
                          <span className="shrink-0 text-[11px] text-text-3" title={f.hint}>
                            {f.whenEmpty ?? (f.masterUntilReleased ? (shared ? 'only the master' : 'only you') : 'everyone who opens the app')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => onStage(f.id, [])}
                            title={f.whenEmpty ? `Clear the badges — the control goes back to ${f.whenEmpty}.`
                              : f.masterUntilReleased
                                ? (shared ? 'Clear the badges — it becomes the master’s alone again.' : 'Clear the badges — it becomes yours alone again.')
                                : 'Clear the badges — the control goes back to everyone who opens the app.'}
                            className="shrink-0 text-[11px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {f.whenEmpty ? `Back to ${f.whenEmpty}`
                              : f.masterUntilReleased ? (shared ? 'Back to the master alone' : 'Make it mine alone') : 'Back to everyone'}
                          </button>
                        )}
                      </div>
                      <p className="mb-1 text-[11px] leading-4 text-text-3">{f.hint}</p>
                      <div className="flex flex-wrap gap-1">
                        {reach.badges.map((b) => {
                          const on = fb.includes(b)
                          return (
                            <button
                              key={b}
                              type="button"
                              disabled={locked}
                              aria-pressed={on}
                              onClick={() => onStage(f.id, on ? fb.filter((x) => x !== b) : [...fb, b])}
                              className={cn(
                                BADGE_CHIP_CLS,
                                on
                                  ? 'border-primary bg-primary-soft text-primary-strong'
                                  : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                                locked && 'cursor-not-allowed opacity-60',
                              )}
                            >
                              {b}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {/* WHICH TENANT THIS APP BELONGS TO — same row, because it is
                    the same app being described. No tenants means every
                    tenant, so a workspace with one company never sees this. */}
                {showTenants && masterOnly ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">Tenants</span>
                    <span className="text-[11px] text-text-3">every place — yours alone, never narrowed by a tenant rule</span>
                  </div>
                ) : showTenants && (TENANT_BASIC_APPS.includes(row.app.id) ? (
                  // THE FLOOR SAYS SO OUT LOUD: these are every place's own chrome — the matrix cannot take them…
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">Tenants</span>
                    <span className="text-[11px] text-text-3">every tenant — a workspace basic, never removed</span>
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">Tenants</span>
                    {tenants.map((t) => {
                      const on = tenantList.includes(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={locked}
                          aria-pressed={on}
                          onClick={() => onStageTenant(row.app.id, on ? tenantList.filter((x) => x !== t.id) : [...tenantList, t.id])}
                          className={cn(
                            BADGE_CHIP_CLS,
                            'normal-case tracking-normal',
                            on
                              ? 'border-primary bg-primary-soft text-primary-strong'
                              : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                            locked && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          {t.name}
                        </button>
                      )
                    })}
                    {tenantList.length === 0 && (
                      <span className="text-[11px] text-text-3">every tenant</span>
                    )}
                  </div>
                ))}
              </td>
            </tr>
          )}
          </Fragment>
          )
        })}
    </>
  )
}
