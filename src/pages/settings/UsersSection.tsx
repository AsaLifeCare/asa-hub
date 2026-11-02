// Workspace account management against the Hub backend — one component, two homes (the split is official, not a…
// - variant="system" → Settings → System users: the master admin, the two shared seats (interviewer / onboarding)…
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import { watchUsersFreshness } from '@/lib/usersDirectory'
import Pager from '@/components/shared/Pager'
import { PAGE_SIZE, usePager } from '@/lib/pager'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpDown, Check, ChevronDown, Eye, GitMerge, Loader2, MoreHorizontal, Printer, Send, Share2, ShieldCheck, Shuffle, Trash2, UserPlus, X } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SearchInput from '@/components/shared/SearchInput'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import DragPerson from '@/components/shared/DragPerson'
import ExportMenu from '@/components/shared/ExportMenu'
import { share } from '@/stores/useShareStore'
import { SortableRow } from '@/engine/templates/sheet/SortableRow'
import { useSheetOrdering } from '@/engine/templates/sheet/use-sheet-ordering'
import { ORDERING_MODES, mulberry32 } from '@/engine/templates/sheet/ordering'
import PeopleMergeModal from '@/features/people/PeopleMergeModal'
import Avatar from '@/components/shared/Avatar'
import { badgeWord } from '@/components/shared/RoleBadge'
import { BADGE_FOLLOWS } from '@/lib/badgeFollows'
import { PhotoField } from '@/components/shared/EditRecordModal'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import Card, { CardHeader } from '@/components/shared/Card'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { gasAction } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useBadgeAccessStore, badgeAllowsApp, roleWordCounts } from '@/lib/badgeAccess'
import { useEffectiveIsMaster } from '@/lib/effectiveUser'
import { formatPhoneDisplay, formatPhoneE164 } from '@/lib/phoneFormat'
import { AppIcon } from '@/lib/icons'
import { Switch } from '@/components/ui/switch'
import { PERMISSION_GROUPS } from '@/auth/permissions'
import { ROLE_PRESETS } from '@/auth/permissions'
import type { Permission } from '@/auth/types'
import { ROLE_LABEL } from '@/auth/types'
import { isSystemManagedAccount, restrictedAppsFor } from '@/lib/roleAccess'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenantStore } from '@/stores/useTenantStore'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'

type HubRole = 'admin' | 'manager' | 'staff' | 'client' | 'interviewer' | 'onboarding'

export interface HubUser {
  id: string
  email: string
  display_name: string
  role: HubRole
  active: boolean
  created_at: string
  last_login: string
  // The person-grade profile — a USER is the official record of a person with the same attributes as People; the…
  title?: string
  phone?: string
  avatar?: string
  /** false = account has no password yet — awaiting arming, not locked */
  armed?: boolean
  /** labelled contact numbers — the backend keeps `phone` = the first one */
  phones?: { label: string; number: string }[]
  /** extra contact addresses; `email` above is the sign-in one, untouched */
  emails?: string[]
  // system TYPE (DIRECTOR / HR / …) — a label for the Settings-side accounts, orthogonal to the access role
  system_type?: string
  // WHICH PERSON a client-role account IS — the column that decides whether their Clients, ISP and wellbeing…
  client_key?: string
  types?: string[]
  // removed from the CONFIG surfaces only (System users + Per-person overrides) — sign-in and everything else…
  system_hidden?: boolean
  // apps DENIED to this person on top of the badge matrix — the master's eye writes it; narrowing only, it never…
  app_denials?: string[]
  // per-person capability overrides — the same column the old Per-person matrix wrote (userPublic_ ships it on…
  overrides?: Partial<Record<Permission, boolean>>
  // WHERE THIS ACCOUNT LIVES — the place a session lands in when the envelope names none (Tenant.gs).
  home_tenant?: string
  /** the extra places it may also stand in; home is implicit */
  tenants?: string[]
  // THE PLATFORM CONTACT LINK (ContactsSync.gs): the roster row this account is, the platform's employment status…
  people_id?: string
  roster_status?: string
  employee_id?: string
  start_date?: string
  end_date?: string
  contact_sources?: Record<string, string>
  contact_synced_at?: string
}

/** The system TYPES — mirrors SYSTEM_USER_TYPES in the backend whitelist. */
const SYSTEM_TYPES = ['DIRECTOR', 'ADMINISTRATOR', 'FINANCES', 'HR', 'DIVISION SUPERVISOR', 'QUALITY'] as const

type Variant = 'system' | 'people' | 'active' | 'inactive' | 'all'

/** Which roles each home can create/assign — mirrors OPEN_ACCESS_ROLES. */
export const VARIANT_ROLES: Record<Variant, HubRole[]> = {
  people: ['staff', 'client'],
  system: ['admin', 'manager', 'interviewer', 'onboarding'],
  // the unified Users app: sections by STATE, not by role — every role may appear in either
  active: ['admin', 'manager', 'staff', 'client', 'interviewer', 'onboarding'],
  inactive: ['admin', 'manager', 'staff', 'client', 'interviewer', 'onboarding'],
  // one list over every state, so every role it could ever hold
  all: ['admin', 'manager', 'staff', 'client', 'interviewer', 'onboarding'],
}

const VARIANT_COPY: Record<Variant, { title: string; sub: string; empty: string }> = {
  people: {
    title: 'Users',
    sub: 'Access accounts you create — staff and clients who can sign in.',
    empty: 'Add the first access account with the button above.',
  },
  system: {
    title: 'System users',
    sub: 'The master admin, the shared seats and the directors.',
    empty: 'System accounts appear here — the master admin, the seats and the directors.',
  },
  active: {
    title: 'System Users',
    sub: 'Everyone who can sign in TODAY — active, with a password and a role. The shared seats live here until they are removed.',
    empty: 'No active accounts — which would mean nobody can sign in, including you.',
  },
  all: {
    title: 'Users',
    sub: 'Every account, active or not — the status column says which is which.',
    empty: 'No accounts at all — which would mean nobody can sign in, including you.',
  },
  inactive: {
    title: 'Inactive Users',
    sub: 'Accounts that cannot sign in — no password yet, or deactivated. Arm them or clean them up.',
    empty: 'Nothing waiting — every account either signs in or was removed.',
  },
}

const ROLE_CHIP: Record<HubRole, string> = {
  admin: 'bg-tint-primary text-tint-fg-primary',
  manager: 'bg-tint-lavender text-tint-fg-lavender',
  staff: 'bg-tint-blue text-tint-fg-blue',
  client: 'bg-tint-amber text-tint-fg-amber',
  interviewer: 'bg-surface-2 text-text-2',
  onboarding: 'bg-surface-2 text-text-2',
}

const INPUT_CLS =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const PRIMARY_BTN =
  'flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40'

const GHOST_BTN =
  'h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

/** A real button — bordered, not a drawing floating in the header. */
const OUTLINE_BTN =
  'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 active:scale-[0.98]'

const ICON_BTN =
  'grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

/** "24 min" · "3h" · "37d" · "Never" — the old platform's last-login language. */
function fmtAgo(v?: string): string {
  if (!v) return 'Never'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'Never'
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

function RoleChip({ role }: { role: HubRole }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', ROLE_CHIP[role] ?? 'bg-surface-2 text-text-2')}>
      {ROLE_LABEL[role] ?? role}
    </span>
  )
}

/** <tbody> that becomes a drag surface while manual ordering is on. */
function SortBody({
  manual,
  ids,
  sensors,
  onDragEnd,
  children,
}: {
  manual: boolean
  ids: string[]
  sensors: ReturnType<typeof useSheetOrdering>['orderSensors']
  onDragEnd: ReturnType<typeof useSheetOrdering>['onOrderDragEnd']
  children: React.ReactNode
}) {
  if (!manual) return <tbody>{children}</tbody>
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <tbody>{children}</tbody>
      </SortableContext>
    </DndContext>
  )
}

function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{msg}</p>
}

/** inactive or never armed — either way, giving a password should open the door */
export function u_needsActivation(u: HubUser): boolean {
  return !u.active || u.armed === false
}

// ------------------------------------------------------------------ THE AUTOMATIC TRUTH — who is active and who is…

// roster/client words that mean OUT — the bulkStatusWanted_ cut, plus the archive family
const OUT_STATUS = /archiv|inactiv|offboard|leave|away|terminat|^off$/i
function statusIsOut(s: string): boolean {
  const v = s.trim().toLowerCase()
  return !!v && OUT_STATUS.test(v)
}
const normJoinName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

type DerivedState = 'active' | 'awaiting' | 'inactive'
type SegType = 'all' | 'staff' | 'clients' | 'system'

// LIVE IN THE SYSTEM — the exact question the status cell answers, asked once so the avatar and the cell can never…
function u_isLive(u: HubUser): boolean {
  return u.armed !== false && !!u.active
}

type DialogState =
  | { kind: 'create'; prefill?: { name: string; email: string } }
  | { kind: 'promote' }
  | { kind: 'merge-selected'; users: HubUser[] }
  | { kind: 'role'; user: HubUser }
  | { kind: 'password'; user: HubUser }
  | { kind: 'active'; user: HubUser }
  | { kind: 'contacts'; user: HubUser }
  | { kind: 'profile'; user: HubUser }
  | { kind: 'remove'; user: HubUser }
  | { kind: 'type'; user: HubUser }
  | { kind: 'place'; user: HubUser }
  | { kind: 'badges'; user: HubUser }
  | { kind: 'app-access'; user: HubUser }
  | { kind: 'bulk-remove'; users: HubUser[] }
  | { kind: 'arm' }
  | { kind: 'invite' }
  | null

// `extraActions` — buttons the CALLER owns, rendered at the head of this card's action row.
export default function UsersSection({ variant = 'system', extraActions }:
  { variant?: Variant; extraActions?: ReactNode } = {}) {
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<HubUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  // The merge lives here too — when the roster throws more variants of the SYSTEM people (directors included), they…
  const [showMerge, setShowMerge] = useState(false)
  const copy = VARIANT_COPY[variant]
  const roles = VARIANT_ROLES[variant]
  // "Removed" system accounts left THESE config surfaces, nothing else — they are not listed here, and they never…
  const inHome = users.filter((u) => {
    // the unified app cuts by STATE — armed and active vs not — across every role, so a shared seat and a…
    if (variant === 'all') return true
    if (variant === 'active') return String(u.active ?? 'true') !== 'false' && u.armed === true
    if (variant === 'inactive') return String(u.active ?? 'true') === 'false' || u.armed !== true
    return isSystemManagedAccount(u) === (variant === 'system') && !(variant === 'system' && u.system_hidden)
  })
  const hiddenSystem = variant === 'system' ? users.filter((u) => isSystemManagedAccount(u) && u.system_hidden) : []

  // THE HM RELEASE: a House-Manager-badged manager reads this screen — who is active, who is not — and touches…
  const readOnly = me?.role !== 'admin'

  /* ---- the roster/client joins that make the status AUTOMATIC ---- */
  const [rosterStatus, setRosterStatus] = useState<Map<string, string> | null>(null)
  const [clientStatus, setClientStatus] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    void api.list<Record<string, string>>('people').then((rows) => {
      const m = new Map<string, string>()
      for (const r of rows ?? []) {
        const n = normJoinName(String(r.name ?? ''))
        if (n && !m.has(n)) m.set(n, String(r.status ?? ''))
      }
      setRosterStatus(m)
    }).catch(() => { /* the account flag stands alone */ })
    void api.list<Record<string, string>>('clients').then((rows) => {
      const m = new Map<string, string>()
      for (const r of rows ?? []) {
        const k = String(r.client_key ?? '').trim()
        if (k) m.set(k, String(r.status ?? ''))
      }
      setClientStatus(m)
    }).catch(() => { /* same */ })
  }, [])

  const derivedState = useCallback((u: HubUser): DerivedState => {
    if (u.armed === false) return 'awaiting'
    if (u.role === 'client') {
      const s = u.client_key ? clientStatus?.get(String(u.client_key).trim()) : undefined
      if (s !== undefined) return statusIsOut(s) ? 'inactive' : 'active'
    } else {
      // THE SERVER'S ANSWER FIRST (ContactsSync.gs): the merge stamps the platform's status on the account row…
      if (u.roster_status) return statusIsOut(u.roster_status) ? 'inactive' : 'active'
      const s = rosterStatus?.get(normJoinName(u.display_name || ''))
      if (s !== undefined) return statusIsOut(s) ? 'inactive' : 'active'
    }
    return u_isLive(u) ? 'active' : 'inactive'
  }, [rosterStatus, clientStatus])

  /* ---- segmentation: WHO (staff/clients/system) × STATE, with counts ---- */
  const [typeFilter, setTypeFilter] = useState<SegType>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | DerivedState>('all')
  // an SSA or a FAMILY on role staff is the client side, never the staff (badgeAccess.roleWordCounts)
  const segTypeOf = useCallback((u: HubUser): SegType =>
    isSystemManagedAccount(u) ? 'system' : u.role === 'client' || !roleWordCounts(u) ? 'clients' : 'staff', [])
  const segCounts = useMemo(() => {
    const t: Record<string, number> = { all: inHome.length, staff: 0, clients: 0, system: 0 }
    const s: Record<string, number> = { all: inHome.length, active: 0, awaiting: 0, inactive: 0 }
    for (const u of inHome) {
      t[segTypeOf(u)]++
      s[derivedState(u)]++
    }
    return { t, s }
  }, [inHome, segTypeOf, derivedState])
  const segmented = useMemo(() => inHome.filter((u) =>
    (typeFilter === 'all' || segTypeOf(u) === typeFilter) &&
    (statusFilter === 'all' || derivedState(u) === statusFilter)),
    [inHome, typeFilter, statusFilter, segTypeOf, derivedState])

  /* ---- toolbar: search + the engine's own ordering (A→Z, random, drag) ---- */
  const [qRaw, setQRaw] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(qRaw), 200)
    return () => clearTimeout(t)
  }, [qRaw])

  const searched = useMemo(() => {
    if (!q.trim()) return segmented
    const needle = q.trim().toLowerCase()
    return segmented.filter((u) =>
      [u.display_name, u.email, u.title, u.phone, u.phone && formatPhoneE164(u.phone), u.phone && formatPhoneDisplay(u.phone), u.role, u.system_type].some((v) => String(v ?? '').toLowerCase().includes(needle)),
    )
  }, [segmented, q])

  /* ---- selection: a select-and-remove button over the list ---- */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const restore = async (u: HubUser) => {
    setRestoringId(u.id)
    try {
      await gasAction('userUpdate', { user_id: u.id, system_hidden: false })
      toast({ type: 'success', title: 'Restored', body: `${u.display_name || u.email} is back on System users and Per-person overrides.` })
      await reload(true)
    } catch (err) {
      toast({ type: 'danger', title: 'Could not restore', body: err instanceof Error ? err.message : undefined })
    } finally {
      setRestoringId(null)
    }
  }
  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // rows that can actually be removed: never yourself (backend refuses too)
  const selectable = (u: HubUser) => !(me?.email != null && u.email.toLowerCase() === me.email.toLowerCase())

  const allIds = useMemo(() => searched.map((u) => u.id), [searched])
  const { ordering, setOrdering, shuffleSeed, setShuffleSeed, orderSensors, effectiveOrder, onOrderDragEnd } =
    useSheetOrdering(`asa-users-order-v1:${variant}`, allIds)

  const visible = useMemo<HubUser[]>(() => {
    const rows = [...searched]
    if (ordering === 'az') return rows.sort((a, b) => String(a.display_name || a.email).localeCompare(String(b.display_name || b.email)))
    if (ordering === 'za') return rows.sort((a, b) => String(b.display_name || b.email).localeCompare(String(a.display_name || a.email)))
    if (ordering === 'random') {
      const rand = mulberry32(shuffleSeed)
      return rows
        .map((r: HubUser) => ({ r, k: rand() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.r)
    }
    if (ordering === 'manual') {
      const pos = new Map(effectiveOrder.map((id, i) => [id, i]))
      return rows.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    }
    return rows
  }, [searched, ordering, shuffleSeed, effectiveOrder])

  // near-live: another admin's change is on screen when you look back
  useEffect(() => watchUsersFreshness((rows) => setUsers(rows as unknown as HubUser[])), [])

  // ONE CLICK TO SYSTEM USERS — the default password does the arming; nobody types anything.
  const activateUser = async (u: HubUser) => {
    try {
      const d = await gasAction<{ activated: boolean; defaulted: boolean }>('userActivate', { user_id: u.id })
      toast({
        type: 'success',
        title: `${u.display_name || u.email} — System User`,
        body: d.defaulted ? 'Activated with the default password.' : 'Reactivated — their own password kept.',
      })
      await reload(true)
    } catch (e) {
      toast({ type: 'danger', title: 'Not activated', body: e instanceof Error ? e.message : 'Try again.' })
    }
  }

  // PAGINATION — without it the rest of the list never appears; search/order run over the WHOLE set, the page…
  const pager = usePager(visible, PAGE_SIZE, `${variant}|${q}|${ordering}|${typeFilter}|${statusFilter}`)
  const pageRows = pager.slice

  const manual = ordering === 'manual'
  /** the row element: draggable while ordering is manual, a plain row otherwise */
  const RowTag = ({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) =>
    manual ? (
      <SortableRow id={id} className={className}>{children}</SortableRow>
    ) : (
      <tr className={className}>{children}</tr>
    )
  /** what Export / Share / Print carry: the rows AS SHOWN */
  const exportColumns = [
    { key: 'display_name', label: 'Name' },
    { key: 'title', label: 'Title' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone', accessor: (u: HubUser) => formatPhoneDisplay(u.phone) },
    { key: 'role', label: 'Role' },
    ...(variant === 'system' ? [{ key: 'system_type', label: 'Type' }] : []),
    { key: 'last_login', label: 'Last sign-in' },
    // the derived word, exactly as the Status cell shows it — the Share subtitle promises "as shown on screen"
    { key: 'derived_status', label: 'Status', accessor: (u: HubUser) => derivedState(u) },
  ]

  const reload = useCallback(async (fresh = false) => {
    setLoadError(null)
    // paint the tab's last fetch instantly; the live call refreshes underneath
    const seed = cachedUsers() as HubUser[] | null
    if (seed) {
      setUsers(seed)
      setLoading(false)
    } else {
      setLoading(true)
    }
    try {
      // fresh=true after a mutation: never ride a request that started before the write — it would repaint the…
      setUsers((await fetchUsers(fresh ? { force: true } : undefined)) as unknown as HubUser[])
    } catch (err) {
      // with a seed on screen a failed refresh is a note, not a blank card
      if (seed) toast({ type: 'warning', title: 'Showing the last known list', body: 'Refreshing the users failed — retry from the menu or reload.' })
      else setLoadError(err instanceof Error ? err.message : 'Could not load users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Search · order (A→Z, random, drag) · export · share · print — the same affordances every table in the platform…
  const toolbar = () => (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedTabs
          tabs={[
            { id: 'all', label: `All · ${segCounts.t.all}` },
            { id: 'staff', label: `Staff · ${segCounts.t.staff}` },
            { id: 'clients', label: `Clients · ${segCounts.t.clients}` },
            { id: 'system', label: `System · ${segCounts.t.system}` },
          ]}
          value={typeFilter}
          onChange={(id) => setTypeFilter(id as SegType)}
        />
        <SegmentedTabs
          tabs={[
            { id: 'all', label: 'Any state' },
            { id: 'active', label: `Active · ${segCounts.s.active}` },
            { id: 'awaiting', label: `Awaiting · ${segCounts.s.awaiting}` },
            { id: 'inactive', label: `Inactive · ${segCounts.s.inactive}` },
          ]}
          value={statusFilter}
          onChange={(id) => setStatusFilter(id as 'all' | DerivedState)}
        />
      </div>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <SearchInput
        value={qRaw}
        onChange={setQRaw}
        className="w-full max-w-full sm:w-[280px]"
        placeholder="Search name, email, title or phone…"
      />
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Row ordering" className={OUTLINE_BTN}>
              <ArrowUpDown size={14} /> Order <ChevronDown size={12} className="text-text-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-surface">
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
            {ORDERING_MODES.find((m) => m.key === ordering)?.short ?? ORDERING_MODES.find((m) => m.key === ordering)?.label}
            {ordering === 'random' && (
              <button
                aria-label="Re-shuffle"
                title="Re-shuffle"
                onClick={() => setShuffleSeed(Math.floor(Math.random() * 1e9))}
                className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-surface/60"
              >
                <Shuffle size={11} />
              </button>
            )}
            <button
              aria-label="Back to default order"
              title="Back to default order"
              onClick={() => setOrdering('default')}
              className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-surface/60"
            >
              <X size={11} />
            </button>
          </span>
        )}
      </div>
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => setDialog({ kind: 'bulk-remove', users: visible.filter((u) => selected.has(u.id)) })}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-tint-pink active:scale-[0.98]"
        >
          <Trash2 size={14} /> Remove selected
          <span className="rounded-full bg-tint-pink px-1.5 text-[11px] font-bold text-tint-fg-pink">{selected.size}</span>
        </button>
      )}
      <div className="ml-auto flex items-center gap-1">
        <ExportMenu filename="users" columns={exportColumns} rows={visible} />
        <button
          type="button"
          aria-label="Share this list"
          title="Share this list"
          onClick={() =>
            share({
              title: copy.title,
              subtitle: `${visible.length} ${visible.length === 1 ? 'account' : 'accounts'} — as shown on screen`,
              rows: visible,
              columns: exportColumns,
              filename: 'users',
              icon: 'users',
            })
          }
          className={ICON_BTN}
        >
          <Share2 size={15} />
        </button>
        <button type="button" aria-label="Print" title="Print this list" onClick={() => window.print()} className={ICON_BTN}>
          <Printer size={15} />
        </button>
      </div>
    </div>
    </>
  )

  const body = () => (
    <>
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading users…
          </p>
        ) : loadError ? (
          <div className="space-y-3 py-2">
            <FieldError msg={loadError} />
            <button type="button" onClick={() => void reload()} className={GHOST_BTN}>
              Retry
            </button>
          </div>
        ) : inHome.length === 0 ? (
          <EmptyState title="No users yet" body={copy.empty} />
        ) : (
          <div>
            {toolbar()}
            {visible.length === 0 ? (
              <EmptyState title="Nothing matches" body="No account matches that search." />
            ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-text-3">
                  {manual && <th className="w-9 pb-2" aria-label="Drag" />}
                  <th className="w-8 pb-2" aria-label="Select">
                    {!readOnly && (
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        className="h-3.5 w-3.5 accent-[var(--primary)]"
                        checked={visible.filter(selectable).length > 0 && visible.filter(selectable).every((u) => selected.has(u.id))}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(visible.filter(selectable).map((u) => u.id)) : new Set())
                        }
                      />
                    )}
                  </th>
                  <th className="pb-2 pr-3 font-semibold">Person</th>
                  <th className="pb-2 pr-3 font-semibold">Email</th>
                  <th className="pb-2 pr-3 font-semibold">Phone</th>
                  <th className="pb-2 pr-3 font-semibold">Role</th>
                  {variant === 'system' && <th className="pb-2 pr-3 font-semibold">Type</th>}
                  <th className="pb-2 pr-3 font-semibold">Last sign-in</th>
                  <th className="pb-2 pr-3 font-semibold">Status</th>
                  <th className="pb-2 font-semibold" aria-label="Actions" />
                </tr>
              </thead>
              <SortBody
                manual={manual}
                ids={pageRows.map((u) => u.id)}
                sensors={orderSensors}
                onDragEnd={onOrderDragEnd}
              >
                {pageRows.map((u) => {
                  const isMe = me?.email != null && u.email.toLowerCase() === me.email.toLowerCase()
                  return (
                    // full colour always — the STATUS column carries the state; a faded row reads as dead
                    <RowTag key={u.id} id={u.id} className="group/row border-b border-border last:border-0">
                      <td className="py-2.5 pr-1">
                        {!readOnly && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${u.display_name || u.email}`}
                            className="h-3.5 w-3.5 accent-[var(--primary)] disabled:opacity-30"
                            disabled={!selectable(u)}
                            title={selectable(u) ? undefined : 'You cannot remove your own account'}
                            checked={selected.has(u.id)}
                            onChange={() => toggleSelected(u.id)}
                          />
                        )}
                      </td>
                      <td
                        className="cursor-pointer py-2.5 pr-3"
                        onClick={() => navigate(`/app/users/profile?u=${u.id}`)}
                        title="Open the profile"
                      >
                        {/* every person's name drags to the tracker beside
                            the asa. wordmark */}
                        <DragPerson name={u.display_name || u.email} id={u.id} type="staff" avatar={u.avatar} subtitle={u.title} className="block">
                        <span className="flex items-center gap-2.5">
                          {/* THE ROUND ICON CARRIES THE STATUS: the circle in
                              front of a name — initials or a photo — goes
                              green for everyone active in the system, staff
                              and clients alike.

                              A RING, not a fill: the tile's own colour is the
                              person's — deterministic from their name, and it
                              is how a roster of 188 gets scanned for one face
                              — and a photo cannot be recoloured at all. The
                              rim goes green and both survive.

                              `--status-green` is the platform's explicit
                              status green; `--success` is the brand cyan the
                              status dot uses, which is the wrong green here.
                              Same question as the status cell (u_isLive), so
                              the ring and the word can never disagree. */}
                          {/* THE RING SPEAKS BOTH WAYS — green ring
                              = active/online, BLUE ring = inactive; awaiting
                              wears none, its amber chip already says it. */}
                          <Avatar
                            src={u.avatar}
                            name={u.display_name || u.email}
                            size="sm"
                            className={cn(
                              derivedState(u) === 'active' && 'ring-2 ring-[var(--status-green)]',
                              derivedState(u) === 'inactive' && 'ring-2 ring-[var(--info)]',
                            )}
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 font-medium text-text-1 hover:text-primary">
                              {u.display_name || '—'}
                              {isMe && (
                                <span className="inline-flex rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">You</span>
                              )}
                            </span>
                            <span className="block truncate text-[11.5px] text-text-3">{u.title || ' '}</span>
                          </span>
                        </span>
                        </DragPerson>
                      </td>
                      <td className="py-2.5 pr-3 text-text-2">
                        {u.email}
                        {(u.emails?.length ?? 0) > 0 && (
                          <span className="ml-1.5 text-[11px] text-text-3">+{u.emails!.length}</span>
                        )}
                      </td>
                      {/* nowrap: a phone folding over lines inside the
                          column reads badly. The cell is a view; the stored
                          value keeps its spelling. */}
                      <td
                        className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-text-2"
                        title={u.contact_sources?.phone
                          ? `Phone from the platform (${u.contact_sources.phone.replace(/^platform:?/, '') || 'roster'})`
                          : undefined}
                      >
                        {u.phone ? formatPhoneDisplay(u.phone) : '—'}
                        {(u.phones?.length ?? 0) > 1 && (
                          <span className="ml-1.5 text-[11px] text-text-3">+{u.phones!.length - 1}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <RoleChip role={u.role} />
                      </td>
                      {variant === 'system' && (
                        <td className="py-2.5 pr-3">
                          {u.system_type ? (
                            <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-2">
                              {u.system_type}
                            </span>
                          ) : (
                            <span className="text-text-3">—</span>
                          )}
                        </td>
                      )}
                      <td className="py-2.5 pr-3 tabular-nums text-text-2">{fmtAgo(u.last_login)}</td>
                      <td className="py-2.5 pr-3">
                        {/* THE WORD IS THE DERIVED ONE: the
                            roster/client record decides, the account flag
                            only when the records don't know the person —
                            the tooltip says which spoke. */}
                        {derivedState(u) === 'awaiting' ? (
                          <span className="inline-flex items-center rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold text-tint-fg-amber" title="Set a password (menu → Reset password) and this person can sign in">
                            Awaiting password
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-text-2"
                            title={`From the ${u.role === 'client' ? 'client list' : 'roster'} — automatic; account flag: ${u.active ? 'active' : 'inactive'}`}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', derivedState(u) === 'active' ? 'bg-success' : 'bg-danger')} />
                            {derivedState(u) === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {readOnly ? null : (
                        <span className="flex items-center justify-end gap-1">
                          {/* THE MASTER'S EYE — an eye on the row, the
                              master-only door to narrowing this one
                              person's per-app access */}
                          {me?.isMaster && (
                            <button
                              type="button"
                              aria-label={`App access for ${u.display_name || u.email}`}
                              title="App access — what their badges reach, narrowed per person"
                              onClick={() => setDialog({ kind: 'app-access', user: u })}
                              className="rounded-md border border-border bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                            >
                              <Eye size={13} className="block" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDialog({ kind: 'profile', user: u })}
                            className="rounded-md border border-border bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                          >
                            Details
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Actions for ${u.display_name || u.email}`}
                                className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                              >
                                <MoreHorizontal size={15} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-surface">
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'profile', user: u })}>Edit profile</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'contacts', user: u })}>Contacts</DropdownMenuItem>
                              {u_needsActivation(u) && (
                                // THE EXPLICIT MOVE, NO TYPED PASSWORD: everyone activates with the default from…
                                <DropdownMenuItem onSelect={() => void activateUser(u)}>
                                  Move to System Users
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'role', user: u })}>Change role</DropdownMenuItem>
                              {variant === 'system' && (
                                <DropdownMenuItem onSelect={() => setDialog({ kind: 'type', user: u })}>Set type</DropdownMenuItem>
                              )}
                              {/* WHERE THEY WORK IS A SETTING, NOT A DIRECTORY ENTRY. A STAFF
                                  account has no access to the USERS app — knowing every
                                  teammate's profile is not their business — so this
                                  configuration has to live in Settings.

                                  This component is rendered in two places — Settings, and the
                                  Users APP, which imports it. Deciding which place an account
                                  lives in is administration of the platform rather than a fact
                                  about a person, so it belongs to the half that is Settings:
                                  'system' and 'people'. The app's own variants ('active',
                                  'inactive') are a directory, and a directory should not carry
                                  the control that moves somebody between companies. */}
                              {(variant === 'system' || variant === 'people') && (
                                <DropdownMenuItem onSelect={() => setDialog({ kind: 'place', user: u })}>
                                  Where they work
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'badges', user: u })}>Set badges</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'password', user: u })}>Reset password</DropdownMenuItem>
                              {!isMe && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'active', user: u })}>
                                    {u.active ? 'Deactivate' : 'Reactivate'}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'remove', user: u })}>
                                    {variant === 'people' ? 'Back to roster (delete account)' : 'Remove from this list'}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                        )}
                      </td>
                    </RowTag>
                  )
                })}
              </SortBody>
            </table>
            <div className="mt-2 flex justify-end px-1">
              <Pager {...pager} onPage={pager.setPage} noun="accounts" />
            </div>
          </div>
            )}
            {/* Removed-from-list door (system only): they left the CONFIG
                surfaces, not the platform — this is the way back. */}
            {hiddenSystem.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setShowHidden((v) => !v)}
                  className="text-[12px] font-medium text-text-3 transition-colors hover:text-text-1"
                >
                  {hiddenSystem.length} removed from this list — {showHidden ? 'hide' : 'show'}
                </button>
                {showHidden && (
                  <ul className="mt-2 space-y-1">
                    {hiddenSystem.map((u) => (
                      <li key={u.id} className="flex items-center gap-2.5 rounded-md bg-surface-2/50 px-2.5 py-1.5 text-[12.5px]">
                        {/* removed from the list is still a person — same row
                            shape as the table above, same handle */}
                        <DragPerson name={u.display_name || u.email} id={u.id} avatar={u.avatar} subtitle={u.title} className="min-w-0 items-center gap-2.5">
                          <Avatar src={u.avatar} name={u.display_name || u.email} size="xs" />
                          <span className="truncate font-medium text-text-1">{u.display_name || u.email}</span>
                        </DragPerson>
                        <span className="text-[11px] text-text-3">{u.email}</span>
                        <button
                          type="button"
                          onClick={() => void restore(u)}
                          disabled={restoringId === u.id}
                          className="ml-auto flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                        >
                          {restoringId === u.id && <Loader2 size={11} className="animate-spin" />} Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
    </>
  )

  const dialogs = () => (
    <>
      {dialog?.kind === 'create' && <CreateUserDialog roles={roles} prefill={dialog.prefill} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'merge-selected' && (
        <MergeSelectedDialog
          users={dialog.users}
          onClose={() => setDialog(null)}
          onDone={async () => { setSelected(new Set()); await reload(true) }}
        />
      )}
      {dialog?.kind === 'promote' && (
        <PromoteFromPeopleDialog
          onPick={(p) => setDialog({ kind: 'create', prefill: p })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'place' && <SetPlaceDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'role' && <ChangeRoleDialog roles={roles} user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'password' && <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'active' && <ToggleActiveDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'contacts' && <ContactsDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'profile' && <ProfileDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'remove' && <RemoveUserDialog variant={variant} user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'type' && <SetTypeDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'badges' && <SetBadgesDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'app-access' && <AppAccessDialog user={dialog.user} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'bulk-remove' && (
        <BulkRemoveDialog
          variant={variant}
          users={dialog.users}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setSelected(new Set())
            await reload(true)
          }}
        />
      )}
      {dialog?.kind === 'arm' && <ArmAccountsDialog users={visible.filter(u_needsActivation)} preselected={selected} onClose={() => setDialog(null)} onDone={() => reload(true)} />}
      {dialog?.kind === 'invite' && <InviteDialog users={visible} preselected={selected} onClose={() => setDialog(null)} />}
    </>
  )

  /** the HM release reads; every account-making door stays with admins */
  const headerActions = readOnly ? null : (
    <div className="flex flex-wrap items-center gap-2">
      {extraActions}
      {(variant === 'system' || variant === 'active' || variant === 'inactive') && (
        // ONE WORD, ONE DOOR — pressed with two rows selected, this used to open the auto-variants modal and report…
        <button
          type="button"
          onClick={() =>
            selected.size >= 2
              ? setDialog({ kind: 'merge-selected', users: visible.filter((u) => selected.has(u.id)) })
              : setShowMerge(true)
          }
          className={OUTLINE_BTN}
        >
          <GitMerge size={14} /> Merge
          {selected.size >= 2 && (
            <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary-strong">{selected.size}</span>
          )}
        </button>
      )}
      {/* THE INVITATION IS A DELIBERATE ACT. It is not
          sent when an account is created — this platform makes rows long
          before it means to hand them out — so it has its own button, and it
          says how many accounts are selected to receive it. */}
      <button
        type="button"
        onClick={() => setDialog({ kind: 'invite' })}
        className={OUTLINE_BTN}
        title="Send the platform invitation — the sign-in, the first-time password, and what happens next"
      >
        <Send size={14} /> Invite
      </button>
      {/* No count badge on this button — the dialog itself says how many are
          picked, so a standing count on the button would only repeat it. */}
      {inHome.some(u_needsActivation) && (
        <button type="button" onClick={() => setDialog({ kind: 'arm' })} className={OUTLINE_BTN}>
          <ShieldCheck size={14} /> Arm accounts
        </button>
      )}
      {variant === 'people' && (
        <button type="button" onClick={() => setDialog({ kind: 'promote' })} className={GHOST_BTN} title="Turn a roster person into an official platform user">
          <UserPlus size={14} /> From People
        </button>
      )}
      <button type="button" onClick={() => setDialog({ kind: 'create' })} className={PRIMARY_BTN}>
        <UserPlus size={14} /> Add user
      </button>
    </div>
  )

  // The USERS app is a full-page directory like every other app — never a floating settings card: it fills the…
  if (variant === 'people') {
    return (
      <div className="w-full">
        <PageHeader title={copy.title} subtitle={copy.sub} actions={headerActions} />
        {showMerge && <PeopleMergeModal scope="system" onClose={() => { setShowMerge(false); void reload(true) }} />}
        <Card padded={false} className="p-6">
          {body()}
        </Card>
        {dialogs()}
      </div>
    )
  }

  return (
    <motion.section
      id="users"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader title={copy.title} sub={copy.sub} extra={headerActions} />
        {showMerge && <PeopleMergeModal scope="system" onClose={() => { setShowMerge(false); void reload(true) }} />}
        {body()}
      </Card>

      {dialogs()}
    </motion.section>
  )
}

/* ---------- dialogs ---------- */

function DialogShell({
  title,
  sub,
  children,
  onClose,
  wide,
}: {
  title: string
  sub?: string
  children: React.ReactNode
  onClose: () => void
  /** 520px instead of 440 — for dialogs whose rows carry an e-mail. */
  wide?: boolean
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn('bg-surface', wide ? 'sm:max-w-[520px]' : 'sm:max-w-[440px]')}>
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">{title}</DialogTitle>
          {/* pr-8 clears the close X — the sub used to wrap under it and read
              as clipped ("passw…d"), twice over. */}
          {sub && <DialogDescription className="pr-8 text-[12.5px] leading-5 text-text-3">{sub}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-text-2">{label}</span>
      {children}
    </label>
  )
}

function RoleSelect({ value, onChange, roles }: { value: HubRole; onChange: (r: HubRole) => void; roles: HubRole[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as HubRole)}>
      <SelectTrigger className="h-9 w-full rounded-sm border-border bg-surface text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CreateUserDialog({ roles, prefill, onClose, onDone }: { roles: HubRole[]; prefill?: { name: string; email: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(prefill?.name ?? '')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [role, setRole] = useState<HubRole>(roles.includes('staff') ? 'staff' : roles[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const n = name.trim()
    const e = email.trim().toLowerCase()
    if (!n) return setError('Display name is required.')
    if (!/^\S+@\S+\.\S+$/.test(e)) return setError('Enter a valid email address.')
    setError(null)
    setBusy(true)
    try {
      // No typed password: the backend arms the account with the workspace default from FIRST_USER_PASSWORD.
      await gasAction('userCreate', { email: e, display_name: n, role })
      toast({ type: 'success', title: 'User created', body: `${n} can now sign in as ${ROLE_LABEL[role]}.` })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create the user.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not create user', body: msg })
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Add user" sub="Creates a workspace account on the Hub backend — they can sign in right away." onClose={onClose}>
      <div className="space-y-3.5">
        <Labeled label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className={INPUT_CLS} />
        </Labeled>
        <Labeled label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@asalifecare.com"
            spellCheck={false}
            className={INPUT_CLS}
          />
        </Labeled>
        <Labeled label="Role">
          <RoleSelect value={role} onChange={setRole} roles={roles} />
        </Labeled>
        <p className="text-[11.5px] leading-5 text-text-3">
          They start with the workspace's default password. Ask them to change it after first sign-in.
        </p>
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Create user
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

export function ChangeRoleDialog({ roles, user, onClose, onDone }: { roles: HubRole[]; user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [role, setRole] = useState<HubRole>(user.role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // AND WHICH PERSON THEY ARE — authorizing the app has to be enough for the data to appear.
  const [clientKey, setClientKey] = useState(String(user.client_key ?? ''))
  const [people, setPeople] = useState<{ client_key?: string; name?: string }[]>([])
  useEffect(() => {
    if (role !== 'client') return
    // one read, only when it can matter — the picker is what stops a typo becoming an account linked to a key…
    void api.list<{ client_key?: string; name?: string }>('clients')
      .then((rows) => setPeople(rows.filter((r) => String(r.client_key ?? '').trim())))
      .catch(() => setPeople([]))
  }, [role])

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const linkChanged = role === 'client' && clientKey.trim() !== String(user.client_key ?? '').trim()
      await gasAction('userUpdate', {
        user_id: user.id, role,
        ...(linkChanged ? { client_key: clientKey.trim() } : {}),
      })
      toast({ type: 'success', title: 'Role updated', body: `${user.display_name || user.email} is now ${ROLE_LABEL[role]}.` })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not change the role.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not change role', body: msg })
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Change role" sub={`${user.display_name || user.email} — role presets drive what they can see and edit.`} onClose={onClose}>
      <div className="space-y-3.5">
        <Labeled label="Role">
          <RoleSelect value={role} onChange={setRole} roles={roles} />
        </Labeled>
        {role === 'client' && (
          <Labeled label="Which person this login is">
            <select
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1"
            >
              <option value="">Not linked — their screens stay empty</option>
              {people.map((p) => (
                <option key={p.client_key} value={p.client_key}>{p.name || p.client_key}</option>
              ))}
            </select>
            <p className="mt-1 text-[11.5px] leading-[16px] text-text-3">
              A client account sees exactly one record — this one. Without it the Clients, ISP and
              wellbeing screens hold nothing, however many apps you switch on for them.
            </p>
          </Labeled>
        )}
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy || role === user.role} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save role
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

export function ResetPasswordDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (password.length < 8) return setError('The new password needs at least 8 characters.')
    if (password !== confirm) return setError("Passwords don't match.")
    setError(null)
    setBusy(true)
    try {
      // setting a password on a dormant account IS arming it — activate in the same write, or "reset password"…
      await gasAction('userUpdate', { user_id: user.id, password, ...(u_needsActivation(user) ? { active: true } : {}) })
      toast({ type: 'success', title: 'Password reset', body: `${user.display_name || user.email} can sign in with the new password.` })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not reset the password.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not reset password', body: msg })
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Reset password" sub={`Set a new password for ${user.display_name || user.email}. Ask them to change it after first sign-in.`} onClose={onClose}>
      <div className="space-y-3.5">
        <Labeled label="New password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" className={INPUT_CLS} />
        </Labeled>
        <Labeled label="Confirm password">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat it" className={INPUT_CLS} />
        </Labeled>
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Reset password
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

export function ToggleActiveDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const deactivating = user.active
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await gasAction('userUpdate', { user_id: user.id, active: !user.active })
      toast({
        type: 'success',
        title: deactivating ? 'User deactivated' : 'User reactivated',
        body: deactivating
          ? `${user.display_name || user.email} can no longer sign in.`
          : `${user.display_name || user.email} can sign in again.`,
      })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not update the user.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not update user', body: msg })
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title={deactivating ? 'Deactivate user?' : 'Reactivate user?'}
      sub={
        deactivating
          ? `${user.display_name || user.email} will be signed out and blocked from signing in. Their data stays — you can reactivate anytime.`
          : `${user.display_name || user.email} will be able to sign in again with their existing password.`
      }
      onClose={onClose}
    >
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} {deactivating ? 'Deactivate' : 'Reactivate'}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// Contacts — several phones and several e-mails per account (born for the system users; every account gets it).
export function ContactsDialog({ user, onClose, onDone, add }: {
  user: HubUser; onClose: () => void; onDone: () => Promise<void>
  /** a value prepared elsewhere (Support Requests' ADP approval), filled in as one more row — Save still writes it */
  add?: { email?: string; phone?: string }
}) {
  const [phones, setPhones] = useState<{ label: string; number: string }[]>(() => {
    const base = user.phones?.length ? user.phones : []
    const extra = add?.phone?.trim() ?? ''
    const digits = (s: string) => s.replace(/\D/g, '').slice(-10)
    if (extra && !base.some((p) => digits(p.number) === digits(extra))) return [...base, { label: 'Phone', number: extra }]
    return base.length ? base : [{ label: 'Phone', number: '' }]
  })
  const [emails, setEmails] = useState<string[]>(() => {
    const base = user.emails?.length ? user.emails : []
    const extra = add?.email?.trim() ?? ''
    if (extra && !base.some((e) => e.trim().toLowerCase() === extra.toLowerCase())) return [...base, extra]
    return base.length ? base : ['']
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const cleanPhones = phones.map((p) => ({ label: p.label.trim() || 'Phone', number: p.number.trim() })).filter((p) => p.number)
    // kept lowercase, once each: sign-in compares lowercase
    const cleanEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
    const bad = cleanEmails.find((e) => !/^\S+@\S+\.\S+$/.test(e))
    if (bad) return setError(`"${bad}" is not a valid email address.`)
    setError(null)
    setBusy(true)
    try {
      await gasAction('userUpdate', { user_id: user.id, phones: cleanPhones, emails: cleanEmails })
      toast({ type: 'success', title: 'Contacts saved', body: `${cleanPhones.length} phone(s), ${cleanEmails.length} extra email(s).` })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the contacts.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Contacts"
      sub={`${user.display_name || user.email} — several phones and e-mails; an extra e-mail no other account uses also signs this person in.`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Labeled label="Main sign-in email (identity — a new address is added below and signs in too)">
          <input className={cn(INPUT_CLS, 'opacity-60')} value={user.email} disabled />
        </Labeled>

        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Phones</span>
          <div className="space-y-2">
            {phones.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={cn(INPUT_CLS, 'w-[120px] shrink-0')}
                  placeholder="Label"
                  value={p.label}
                  onChange={(e) => setPhones((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <input
                  className={INPUT_CLS}
                  placeholder="+1 330 …"
                  value={p.number}
                  onChange={(e) => setPhones((l) => l.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))}
                />
                <button
                  type="button"
                  onClick={() => setPhones((l) => l.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-text-3 hover:bg-surface-2 hover:text-text-1"
                  title="Remove this phone"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPhones((l) => (l.length < 8 ? [...l, { label: 'Phone', number: '' }] : l))}
              className={GHOST_BTN}
            >
              + Add phone
            </button>
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-text-2">Extra emails</span>
          <div className="space-y-2">
            {emails.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={INPUT_CLS}
                  placeholder="name@example.com"
                  value={e}
                  onChange={(ev) => setEmails((l) => l.map((x, j) => (j === i ? ev.target.value : x)))}
                />
                <button
                  type="button"
                  onClick={() => setEmails((l) => l.filter((_, j) => j !== i))}
                  className="shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-text-3 hover:bg-surface-2 hover:text-text-1"
                  title="Remove this email"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setEmails((l) => (l.length < 8 ? [...l, ''] : l))}
              className={GHOST_BTN}
            >
              + Add email
            </button>
          </div>
        </div>

        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save contacts
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

/** Edit profile — the user row is the official person record, saved on the account row itself. */
export function ProfileDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(user.display_name)
  const [title, setTitle] = useState(user.title ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [avatar, setAvatar] = useState(user.avatar ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const n = name.trim()
    if (!n) return setError('The name cannot be empty.')
    setError(null)
    setBusy(true)
    try {
      await gasAction('userUpdate', {
        user_id: user.id,
        display_name: n,
        title: title.trim(),
        phone: phone.trim(),
        avatar: avatar.trim(),
      })
      toast({ type: 'success', title: 'Profile saved' })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Edit profile" sub={`${user.display_name || user.email} — the official record the system uses.`} onClose={onClose}>
      <div className="space-y-4">
        <PhotoField value={avatar} onChange={setAvatar} name={name || user.display_name || user.email} />
        <Labeled label="Name">
          <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        <Labeled label="Title (e.g. DSP, HR / Administration)">
          <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Labeled>
        <Labeled label="Primary phone">
          <input className={INPUT_CLS} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 330 …" />
        </Labeled>
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save profile
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// Back to roster / delete account — removes the ACCOUNT row for good.
export function RemoveUserDialog({ variant, user, onClose, onDone }: { variant: Variant; user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (variant === 'system') {
        await gasAction('userUpdate', { user_id: user.id, system_hidden: true })
        toast({ type: 'success', title: 'Removed from this list', body: 'The account itself is untouched — restore it from below the table.' })
      } else {
        await gasAction('userDelete', { user_id: user.id })
        toast({ type: 'success', title: 'Account removed', body: `${user.display_name || user.email} is back to roster-only.` })
      }
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the account.')
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title={variant === 'people' ? 'Back to roster?' : 'Remove from this list?'}
      sub={
        variant === 'people'
          ? `${user.display_name || user.email} — the sign-in account is deleted for good. The person's record stays where it lives (People / Clients).`
          : `${user.display_name || user.email} leaves System users and Per-person overrides only — sign-in, permissions and everything else stay exactly as they are.`
      }
      onClose={onClose}
    >
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-danger px-4 text-[13px] font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} {variant === 'people' ? 'Back to roster' : 'Remove from list'}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// WHERE THIS ACCOUNT LIVES — nothing in a spreadsheet; this belongs on the platform, always.
export function SetPlaceDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const tenants = useTenantStore((s) => s.tenants)
  const homeId = useTenantStore((s) => s.homeTenantId)
  const [home, setHome] = useState<string>(user.home_tenant || '')
  const [also, setAlso] = useState<string[]>(user.tenants?.filter((t) => t && t !== user.home_tenant) ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hq = tenants.find((t) => t.id === homeId)
  const elsewhere = tenants.filter((t) => t.id !== homeId)
  const nameOf = (id: string) => tenants.find((t) => t.id === id)?.name || id
  // home is implicit in the reach; ticking it twice would only be confusing
  const toggle = (id: string) => setAlso((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const awayWithNoWayBack = Boolean(home) && home !== homeId && !also.includes(homeId)
  const dirty = home !== (user.home_tenant || '') ||
    also.slice().sort().join(',') !== (user.tenants?.filter((t) => t && t !== user.home_tenant) ?? []).slice().sort().join(',')

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await gasAction('userUpdate', {
        user_id: user.id,
        home_tenant: home,
        tenants: also.filter((t) => t && t !== home),
      })
      toast({ type: 'success', title: home ? `Now works at ${nameOf(home)}` : 'Now works at headquarters' })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change where they work.')
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Where they work"
      sub={`${user.display_name || user.email} — the place their session opens in, and anywhere else they may go.`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">Home</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setHome('')}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                !home ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              {hq?.name || 'Headquarters'}
            </button>
            {elsewhere.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setHome(t.id)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                  home === t.id ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-3">Also reaches</div>
          <div className="flex flex-wrap gap-1.5">
            {[...(hq ? [hq] : []), ...elsewhere].filter((t) => t.id !== (home || homeId)).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                  also.includes(t.id) ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {awayWithNoWayBack && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] leading-relaxed text-text-2">
            With only {nameOf(home)} ticked, this account can no longer open{' '}
            {hq?.name || 'headquarters'} — which is right for somebody who works there and
            wrong for an account you sign into on both sides.
          </p>
        )}
      </div>
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy || !dirty} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save place
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// Set the system TYPE: DIRECTOR / ADMINISTRATOR / FINANCES / HR / DIVISION SUPERVISOR / QUALITY — a label for who…
export function SetTypeDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [picked, setPicked] = useState<string>(user.system_type || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await gasAction('userUpdate', { user_id: user.id, system_type: picked })
      toast({ type: 'success', title: picked ? `Type set — ${picked}` : 'Type cleared' })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the type.')
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Set type" sub={`${user.display_name || user.email} — who this account is in the company.`} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5">
        {['', ...SYSTEM_TYPES].map((t) => (
          <button
            key={t || 'none'}
            type="button"
            onClick={() => setPicked(t)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
              picked === t
                ? 'border-primary bg-primary-soft text-primary-strong'
                : 'border-border bg-surface text-text-2 hover:bg-surface-2',
            )}
          >
            {t || 'None'}
          </button>
        ))}
      </div>
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy || picked === (user.system_type || '')} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save type
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// Remove every selected account in one confirmed move, from a single select-and-remove button.
function BulkRemoveDialog({ variant, users, onClose, onDone }: { variant: Variant; users: HubUser[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const failed: string[] = []
    const removeOne = (u: HubUser) =>
      variant === 'system'
        ? gasAction('userUpdate', { user_id: u.id, system_hidden: true })
        : gasAction('userDelete', { user_id: u.id })
    for (let i = 0; i < users.length; i += 8) {
      const chunk = users.slice(i, i + 8)
      const results = await Promise.allSettled(chunk.map(removeOne))
      results.forEach((r, j) => {
        if (r.status === 'rejected') failed.push(chunk[j].display_name || chunk[j].email)
      })
    }
    const gone = users.length - failed.length
    if (gone > 0) {
      toast({
        type: 'success',
        title: `${gone} ${gone === 1 ? 'account' : 'accounts'} removed`,
        body: variant === 'people' ? 'They are back to roster-only.' : 'From this list only — restore them from below the table.',
      })
    }
    if (failed.length) {
      setError(`Could not remove: ${failed.join(', ')}`)
      setBusy(false)
      await onDone()
      return
    }
    onClose()
    await onDone()
  }

  return (
    <DialogShell
      title={variant === 'people' ? `Back to roster — ${users.length} selected?` : `Remove ${users.length} from this list?`}
      sub={
        variant === 'people'
          ? 'The sign-in accounts are deleted for good. Each person\'s record stays where it lives (People / Clients).'
          : 'They leave System users and Per-person overrides only — sign-in, permissions and everything else stay exactly as they are.'
      }
      onClose={onClose}
    >
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-2/50 p-2.5">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-2 text-[12.5px] text-text-2">
            {/* a read-only summary of what is about to happen — no checkbox,
                no radio, so it is not a chooser and the face still drags */}
            <DragPerson name={u.display_name || u.email} id={u.id} avatar={u.avatar} className="min-w-0 items-center gap-2">
              <Avatar src={u.avatar} name={u.display_name || u.email} size="xs" />
              <span className="truncate font-medium text-text-1">{u.display_name || u.email}</span>
            </DragPerson>
            <span className="ml-auto shrink-0 text-[11px] text-text-3">{ROLE_LABEL[u.role] ?? u.role}</span>
          </li>
        ))}
      </ul>
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-md bg-danger px-4 text-[13px] font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} {variant === 'people' ? 'Back to roster' : 'Remove from list'}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

// Arm accounts — WITH THE SYSTEM DEFAULT: every selected account is activated, but on the workspace's standard…
export function ArmAccountsDialog({ users, preselected, onClose, onDone }: {
  users: HubUser[]
  preselected?: Set<string>
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [picked, setPicked] = useState<Set<string>>(() => {
    // the hand's own table selection wins; with none, everything eligible
    const fromTable = users.filter((u) => preselected?.has(u.id)).map((u) => u.id)
    return new Set(fromTable.length ? fromTable : users.map((u) => u.id))
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async () => {
    if (!picked.size) return setError('Pick at least one account.')
    setError(null)
    setBusy(true)
    try {
      const r = await gasAction<{ armed: number; defaulted: number; kept: number }>('usersArm', { user_ids: [...picked] })
      toast({
        type: 'success',
        title: `${r.armed} account${r.armed === 1 ? '' : 's'} activated`,
        body: r.kept > 0
          ? `${r.defaulted} armed with the system default password; ${r.kept} kept their own.`
          : 'Armed with the system default password — they can sign in now.',
      })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not arm the accounts.')
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Arm accounts"
      sub="Every selected account becomes active with the system default password — an account that already has its own keeps it."
      onClose={onClose}
      wide
    >
      <div className="space-y-4">
        {/* TWO LINES PER PERSON — the one-line modal read as broken:
            name above, the WHOLE e-mail under it, nothing racing
            a scrollbar for the last characters. pr-2 keeps the bar outside
            the text either way. */}
        <div className="scroll-thin max-h-[300px] space-y-0.5 overflow-y-auto pr-2">
          {users.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
              <Avatar src={u.avatar} name={u.display_name || u.email} size="xs" />
              <span className="min-w-0 flex-1">
                <span className="clamp-1 block text-[13px] leading-4 text-text-1">{u.display_name || u.email}</span>
                <span className="clamp-1 block text-[11px] leading-4 text-text-3">{u.email}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Activate {picked.size} account{picked.size === 1 ? '' : 's'}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

/** One account in the invite's answer (HubCore.gs userInvite). */
export type InviteEntry = { id?: string; name?: string; email?: string; state?: string; via?: string; why?: string;
                            with_password?: boolean }

// The invite's answer: `off` or `held` for a press a switch stopped (with the switch in `situation`, and `planted`…
export type InviteAnswer = { state?: string; situation?: string; planted?: boolean | null; why?: string;
                             sent?: InviteEntry[]; held?: InviteEntry[]; skipped?: InviteEntry[] }

/** The switch a stopped press names, in words, with its Smart Comms id. */
function inviteSwitch(situation?: string): string {
  if (situation === 'auth_invitation') return 'the invitation switch (auth_invitation)'
  if (situation === 'user_account_invite') return 'the account invitation (user_account_invite)'
  return situation ? `the situation ${situation}` : 'the invitation'
}

// The answer in one toast: what left, what a brake held, what was refused — each with its sentence.
export function inviteToast(r: InviteAnswer): { type: 'success' | 'warning'; title: string; body: string } {
  const sent = r.sent ?? []
  const held = r.held ?? []
  const refused = r.skipped ?? []
  const who = (e: InviteEntry) => e.name ?? e.email ?? 'an account'
  if (!sent.length && !held.length && !refused.length) {
    const sw = inviteSwitch(r.situation)
    return { type: 'warning',
             title: r.state === 'off' && r.planted === false ? `Nothing was sent — ${sw} is not in Smart Comms yet`
               : r.state === 'off' ? `Nothing was sent — ${sw} is switched off`
               : r.state === 'held' ? `Nothing was sent — ${sw} could not be read, so it is held`
               : 'Nothing was sent',
             body: r.why || 'The server gave no reason.' }
  }
  const counts = [sent.length ? `${sent.length} sent` : '', held.length ? `${held.length} held` : '',
                  refused.length ? `${refused.length} refused` : ''].filter(Boolean).join(' · ')
  const lines = [
    ...sent.map((e) => `${who(e)}: sent by ${(e.via || 'email').replace('+', ' and ')}${e.why ? ` (${e.why})` : ''}`),
    ...held.map((e) => `${who(e)}: ${e.state === 'already' ? 'already sent earlier' : 'held'} — ${e.why || 'a brake held it'}`),
    ...refused.map((e) => `${who(e)}: refused — ${e.why || 'refused'}`),
  ]
  return { type: sent.length && !held.length && !refused.length ? 'success' : 'warning',
           title: sent.length ? `${sent.length} invitation${sent.length === 1 ? '' : 's'} sent${
             held.length || refused.length ? ` (${counts})` : ''}` : `Nothing was sent (${counts})`,
           body: lines.join(' · ') }
}

// THE INVITATION — the letter that lets a person into the platform and explains that the first sign-in uses the…
export function InviteDialog({ users, preselected, onClose }: {
  users: HubUser[]
  preselected?: Set<string>
  onClose: () => void
}) {
  // REACHABLE, NOT MAILABLE.
  const mailable = users.filter((u) => {
    const login = u.email ?? ''
    if (login.includes('@')) return true
    return (login + ' ' + (u.phone ?? '')).replace(/\D+/g, '').length >= 10
  })
  const [picked, setPicked] = useState<Set<string>>(() => {
    const fromTable = mailable.filter((u) => preselected?.has(u.id)).map((u) => u.id)
    return new Set(fromTable)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async () => {
    if (!picked.size) return setError('Pick at least one person.')
    setError(null)
    setBusy(true)
    try {
      const r = await gasAction<InviteAnswer>('userInvite', { user_ids: [...picked] })
      // Naming every held and refused account is the point: "3 of 4" leaves the fourth person waiting for a letter…
      toast(inviteToast(r))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitations.')
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Send the invitation"
      sub="The letter carries their sign-in, the first-time password and the fact that the platform will ask them to choose their own before it draws a screen."
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="scroll-thin max-h-[260px] space-y-1 overflow-y-auto">
          {mailable.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
              <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
              <Avatar src={u.avatar} name={u.display_name || u.email} size="xs" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">{u.display_name || u.email}</span>
              {/* IT HAS TO BE ABLE TO SHRINK. A flex child without
                  min-width will not go below its own content, so a long address
                  pushed the row past the dialog and the column was clipped at
                  the edge — the name is what identifies the row, the address is
                  the confirmation, so the address is the half that gives way. */}
              <span className="min-w-0 shrink truncate text-[11.5px] text-text-3" title={u.email}>{u.email}</span>
              {/* WHICH DOOR it will arrive by, because the two are not the
                  same experience and the person sending should know which. */}
              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-text-3">
                {(u.email ?? '').includes('@') ? 'letter' : 'text'}
              </span>
            </label>
          ))}
        </div>
        {users.length > mailable.length && (
          <p className="text-[12px] leading-4 text-text-3">
            {users.length - mailable.length} account{users.length - mailable.length === 1 ? '' : 's'} carry neither
            an address nor a number that can be texted, so there is no way to reach them. They are not listed here.
          </p>
        )}
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Send {picked.size} invitation{picked.size === 1 ? '' : 's'}
        </button>
      </DialogFooter>
    </DialogShell>
  )
}

/** Non-admin placeholder for #users — keeps the anchor alive but gated. */
export function RestrictedUsersSection() {
  return (
    <motion.section
      id="users"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Users"
          sub="Workspace accounts — who can sign in, and as what."
          extra={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary-strong">
              <ShieldCheck size={12} /> Admins only
            </span>
          }
        />
        <EmptyState
          title="Restricted — admins only"
          body="User accounts are managed by workspace admins. Ask an admin if you need a change."
        />
      </Card>
    </motion.section>
  )
}


// The official TYPE BADGES: several allowed — the first House Manager wears HM + INTERVIEWER and signs the…
const HUB_TYPES = ['ADMIN', 'ADMINISTRATOR', 'PLATFORMLEAD', 'DIRECTOR', 'SUPERVISOR', 'TEAMLEAD', 'MANAGER', 'HM',
                   'STAFF', 'INTERVIEWER', 'ONBOARDING', 'ENTITY', 'FAMILY', 'CLIENT', 'SSA']

/** Granted and removed by the master alone (Profile.gs HUB_MASTER_GRANTED_BADGES): the server refuses anyone else. */
const MASTER_GRANTED_TYPES: ReadonlyArray<string> = ['PLATFORMLEAD']

export function SetBadgesDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>(user.types ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isMaster = useEffectiveIsMaster()
  const locked = (t: string) => !isMaster && MASTER_GRANTED_TYPES.includes(t)

  const toggle = (t: string) => {
    if (locked(t)) return
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await gasAction('userUpdate', { user_id: user.id, types: picked })
      toast({ type: 'success', title: picked.length ? `Badges set — ${picked.join(', ')}` : 'Badges cleared' })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the badges.')
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Set badges"
      sub={`${user.display_name || user.email} — the type chips this account wears (several allowed).`}
      onClose={onClose}
    >
      <div className="flex flex-wrap gap-1.5">
        {HUB_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            disabled={locked(t)}
            title={locked(t) ? 'Only the master grants or removes this badge.' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
              picked.includes(t)
                ? 'border-primary bg-primary-soft text-primary-strong'
                : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              locked(t) && 'cursor-not-allowed opacity-50',
            )}
          >
            {/* the TOKEN is what is ticked and saved; the reader sees the
                word as the company says it (RoleBadge badgeWord) */}
            {badgeWord(t)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-4 text-text-3">
        HM and INTERVIEWER also grant "Record interview scorecard" — the badge carries the pen.
        {/* read from BADGE_FOLLOWS, never typed — the sentence must leave with the equivalence */}
        {Object.entries(BADGE_FOLLOWS).map(([worn, stands]) => (
          <span key={worn}>
            {' '}{badgeWord(worn).toUpperCase()} currently reaches everything{' '}
            {badgeWord(stands).toUpperCase()} reaches, and can be narrowed on its own in Access
            control.
          </span>
        ))}{' '}
        {MASTER_GRANTED_TYPES.map((t) => (
          <span key={t}>{badgeWord(t).toUpperCase()} is granted and removed by the master alone. </span>
        ))}
        MASTER is never assignable: it derives from the master property.
      </p>
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save badges
        </button>
      </DialogFooter>
    </DialogShell>
  )
}


/** The person dialog's one write: the denial list rides only when the apps half is this session's to change. */
export function personAccessUpdate(
  userId: string,
  denied: Iterable<string>,
  perms: Partial<Record<Permission, boolean>>,
  mayNarrowApps: boolean,
): { user_id: string; perm_overrides: Partial<Record<Permission, boolean>>; app_denials?: string[] } {
  return mayNarrowApps
    ? { user_id: userId, app_denials: [...denied], perm_overrides: perms }
    : { user_id: userId, perm_overrides: perms }
}

// THE MASTER'S EYE — an eye on the row that opens a modal holding every app access this person's badge reaches…
export function AppAccessDialog({ user, onClose, onDone }: { user: HubUser; onClose: () => void; onDone: () => Promise<void> }) {
  const apps = useRegistryStore((s) => s.apps)
  const rules = useBadgeAccessStore((s) => s.rules)
  const mayNarrowApps = useEffectiveIsMaster()

  // FRESH TRUTH ON OPEN.
  const [fresh, setFresh] = useState<HubUser | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [denied, setDenied] = useState<Set<string>>(new Set())
  // THE SECOND HALF OF THE SAME PERSON — Per-person overrides folded in here, because on their own they were of no…
  const [perms, setPerms] = useState<Partial<Record<Permission, boolean>>>({})

  useEffect(() => {
    let alive = true
    fetchUsers({ force: true })
      .then((rows) => {
        if (!alive) return
        const row = (rows as unknown as HubUser[]).find((r) => r.id === user.id)
        if (!row) {
          setLoadError('This account is no longer on the list — close and reload before narrowing anything.')
          return
        }
        setFresh(row)
        setDenied(new Set(row.app_denials ?? []))
        setPerms({ ...(row.overrides ?? {}) })
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : 'Could not re-read this account.')
      })
    return () => {
      alive = false
    }
  }, [user.id])

  // A restricted role (lib/roleAccess.ts) never asks the badge matrix: its workspace IS the hard allow-list.
  const fixedApps = restrictedAppsFor(fresh?.role)
  const reachable = useMemo(() => {
    if (!fresh || !mayNarrowApps) return []
    if (fixedApps) return apps.filter((a) => a.enabled && fixedApps.includes(a.id))
    // isMaster:false + appDenials:[] on purpose — asking "what does the BADGE give?", not "what do they see…
    return apps.filter((a) => a.enabled && badgeAllowsApp(a.id, { isMaster: false, types: fresh.types ?? [], role: fresh.role, appDenials: [] }, rules))
  }, [apps, rules, fresh, fixedApps, mayNarrowApps])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Toggles only exist once a fresh row landed AND the role honours denials. */
  const editable = fresh !== null && !fixedApps

  const toggle = (id: string) =>
    setDenied((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      // ONE WRITE, ONE ROW: apps taken away and capabilities changed are two columns of the same person — they were…
      await gasAction('userUpdate', personAccessUpdate(user.id, denied, perms, mayNarrowApps))
      const permCount = Object.keys(perms).length
      const parts: string[] = []
      if (mayNarrowApps && denied.size) parts.push(`${denied.size} app${denied.size === 1 ? '' : 's'} removed`)
      if (permCount) parts.push(`${permCount} capability change${permCount === 1 ? '' : 's'}`)
      toast({
        type: 'success',
        title: 'Person access saved',
        body: parts.length
          ? `${user.display_name || user.email} — ${parts.join(' · ')}.`
          : `${user.display_name || user.email} keeps exactly what their badges and role give.`,
      })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save the app access.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not save app access', body: msg })
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title="Person access"
      sub={
        !mayNarrowApps
          ? `${user.display_name || user.email} — what they may do inside the apps they reach. Which apps reach them is the master's to narrow.`
          : fixedApps
          ? `${user.display_name || user.email} — their apps are fixed by role; what they can DO is still yours to adjust below.`
          : `${user.display_name || user.email} — the apps their badges reach, and what they may do inside them. Narrowing only: nothing here can add what the badge or the role withholds.`
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        {loadError ? (
          <FieldError msg={loadError} />
        ) : !fresh ? (
          <p className="flex items-center gap-2 px-1 py-5 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Reading their current access…
          </p>
        ) : (
          <>
            {mayNarrowApps && fixedApps && (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[12px] leading-5 text-text-2">
                {ROLE_LABEL[fresh.role]} is a restricted role: what it reaches is the hard allow-list in the
                workspace map, not the badge matrix
                {fresh.role === 'onboarding'
                  ? ' — and a trainee bypasses the per-person denial layer altogether, so a toggle here would change nothing on their screen.'
                  : ' — the list below is the whole of it.'}{' '}
                Change the role to change what they see.
              </p>
            )}
            {!mayNarrowApps ? null : reachable.length === 0 ? (
              <p className="px-1 py-4 text-center text-[13px] italic text-text-3">
                {fixedApps ? 'Their role reaches no enabled app.' : 'Their badges reach no app — nothing to narrow.'}
              </p>
            ) : (
              <div className="scroll-thin max-h-[300px] space-y-1 overflow-y-auto">
                {reachable.map((a) => {
                  const on = !denied.has(a.id)
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5',
                        editable && 'cursor-pointer hover:bg-surface-2',
                      )}
                    >
                      <AppIcon name={a.icon} size={16} className="shrink-0 text-text-2" />
                      <span className={cn('min-w-0 flex-1 truncate text-[13px]', on ? 'text-text-1' : 'text-text-3 line-through')}>
                        {a.name}
                      </span>
                      {editable && (
                        <Switch
                          checked={on}
                          onCheckedChange={() => toggle(a.id)}
                          aria-label={`${on ? 'Deny' : 'Keep'} ${a.name} for ${user.display_name || user.email}`}
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            {/* ---- WHAT THEY CAN DO — the old Per-person overrides, now
                 beside the apps because both narrow the SAME person and both
                 live on the SAME row. A toggle that
                 matches the role default clears the override rather than
                 freezing today's preset onto the person. ---- */}
            {fresh && (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  What they can do
                </p>
                <p className="mb-2.5 text-[11.5px] leading-4 text-text-3">
                  Their {ROLE_LABEL[fresh.role]} role already answers each of these. A switch here
                  only records where THIS person differs.
                </p>
                <div className="scroll-thin max-h-[260px] space-y-3.5 overflow-y-auto pr-1">
                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.area}>
                      <p className="mb-1.5 text-[11px] font-semibold text-text-2">{group.label}</p>
                      <div className="space-y-1.5">
                        {group.perms.map(({ perm, label }) => {
                          const roleDefault = (ROLE_PRESETS[fresh.role] ?? []).includes(perm)
                          const overridden = perms[perm] !== undefined
                          const value = overridden ? perms[perm]! : roleDefault
                          return (
                            <div key={perm} className="flex items-center justify-between gap-3">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="clamp-1 text-[12.5px] text-text-1">{label}</span>
                                {overridden && (
                                  <span className="shrink-0 rounded-full bg-tint-amber px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-tint-fg-amber">
                                    override
                                  </span>
                                )}
                              </span>
                              <Switch
                                checked={value}
                                aria-label={`${label} for ${user.display_name || user.email}`}
                                onCheckedChange={(v) =>
                                  setPerms((p) => {
                                    const n = { ...p }
                                    if (v === roleDefault) delete n[perm]
                                    else n[perm] = v
                                    return n
                                  })
                                }
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <FieldError msg={error} />
      </div>
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
          {editable ? 'Cancel' : 'Close'}
        </button>
        {/* No Save while the read is pending, failed, or the role ignores
            denials — a button that writes a guessed set is worse than none. */}
        {fresh && (
          <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
            {busy && <Loader2 size={13} className="animate-spin" />} Save access
          </button>
        )}
      </DialogFooter>
    </DialogShell>
  )
}


// PEOPLE -> USERS: pick a person off the roster and make them an OFFICIAL platform user — name and e-mail carry…
export function PromoteFromPeopleDialog({ onPick, onClose }: { onPick: (p: { name: string; email: string }) => void; onClose: () => void }) {
  const [rows, setRows] = useState<{ id?: string; name?: string; email?: string; role?: string }[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let alive = true
    api.list<{ id?: string; name?: string; email?: string; role?: string }>('people')
      .then((r) => { if (alive) setRows(r ?? []) })
      .catch(() => setRows([]))
    return () => { alive = false }
  }, [])
  const needle = q.trim().toLowerCase()
  const view = (rows ?? []).filter((r) =>
    !needle || [r.name, r.email, r.role].some((v) => String(v ?? '').toLowerCase().includes(needle)))
  return (
    <DialogShell title="From People" sub="Pick the person — their name and e-mail come along; you choose the role and the first password." onClose={onClose}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the roster…"
        autoFocus
        className={INPUT_CLS}
      />
      <div className="mt-2 max-h-[300px] overflow-y-auto rounded-md border border-border">
        {rows === null ? (
          <p className="flex items-center gap-2 px-3 py-5 text-[13px] text-text-3"><Loader2 size={14} className="animate-spin" /> Reading the roster…</p>
        ) : view.length === 0 ? (
          <p className="px-3 py-5 text-center text-[13px] italic text-text-3">Nobody matches.</p>
        ) : (
          view.slice(0, 40).map((r, i) => (
            <button
              key={r.id ?? i}
              onClick={() => onPick({ name: String(r.name ?? ''), email: String(r.email ?? '') })}
              className="flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-surface-2"
            >
              <Avatar src="" name={String(r.name ?? '?')} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text-1">{r.name}</span>
                <span className="block truncate text-[11.5px] text-text-3">{r.email || 'no e-mail on the roster — type one on the next step'}</span>
              </span>
              {r.role && <span className="shrink-0 text-[11px] text-text-3">{r.role}</span>}
            </button>
          ))
        )}
      </div>
    </DialogShell>
  )
}


// The admin's fold: pick who STAYS; everyone else's sign-in e-mail, extra e-mails and phones are gathered onto the…
function MergeSelectedDialog({ users, onClose, onDone }: { users: HubUser[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [keepId, setKeepId] = useState(users.find((u) => u.armed)?.id ?? users[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await gasAction('userMergeManual', {
        keep_id: keepId,
        fold_ids: users.filter((u) => u.id !== keepId).map((u) => u.id),
      })
      toast({ type: 'success', title: 'Merged', body: 'Contacts gathered onto the keeper; the duplicates left the lists.' })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge.')
      setBusy(false)
    }
  }

  return (
    <DialogShell
      title={`Merge ${users.length} selected`}
      sub="Pick who stays. Every other row's e-mails and phones are gathered onto them; nothing is deleted, and the fold is reversible on the sheet."
      onClose={onClose}
    >
      <div className="space-y-1.5">
        {users.map((u) => (
          <label
            key={u.id}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2',
              keepId === u.id ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-surface-2',
            )}
          >
            <input
              type="radio"
              name="merge-keeper"
              checked={keepId === u.id}
              onChange={() => setKeepId(u.id)}
              className="accent-[var(--primary)]"
            />
            <Avatar src={u.avatar} name={u.display_name || u.email} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-1">{u.display_name || '—'}</span>
              <span className="block truncate text-[11.5px] text-text-3">{u.email}</span>
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-text-3">
              {keepId === u.id ? 'STAYS' : 'folds in'}
              {u.armed ? ' · has password' : ''}
            </span>
          </label>
        ))}
      </div>
      <FieldError msg={error} />
      <DialogFooter>
        <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>Cancel</button>
        <button type="button" onClick={() => void submit()} disabled={busy || !keepId} className={PRIMARY_BTN}>
          {busy && <Loader2 size={13} className="animate-spin" />} Merge into the keeper
        </button>
      </DialogFooter>
    </DialogShell>
  )
}
