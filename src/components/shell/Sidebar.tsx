// Sidebar / app launcher (§7.1).
// 264px ↔ 76px collapse, always-dark navy, collapsible nav groups derived from the categories present in the…
import { AnimatePresence, motion } from 'framer-motion'
import { Building2, Activity, Bookmark, ChevronDown, ChevronsLeft, ChevronsRight, CircleX, Crosshair, LogOut, Plus, Search, Settings, User } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { appIsNew } from '@/lib/appNew'
import { useShellStore } from '@/stores/useShellStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { useAuthStore } from '@/auth/useAuthStore'
import { isRestrictedRole } from '@/lib/roleAccess'
import { gasAction } from '@/features/hiring/shared'
import { type Role } from '@/auth/types'
import { HighestBadge } from '@/components/shared/RoleBadge'
import { buildProfilePanel, type MasterOverview } from '@/features/profile/profilePanel'
import { useProfileSheetStore } from '@/stores/useProfileSheetStore'
import { AppIcon } from '@/lib/icons'
import { groupedApps, mergedCategoryDefs, type CategoryDef } from '@/lib/categories'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { visibleTenants, useTenantStore } from '@/stores/useTenantStore'
import { tenantById, tenantTypeLabel } from '@/lib/tenancy'
import { useWorldStore } from '@/stores/useWorldStore'
import { useMemberStore } from '@/stores/useMemberStore'
import { crossHome, crossToMemberWork, crossToMemberWorld, crossToMyWorld, crossToTenant, leaveVisit } from '@/lib/crossPlace'
import { worldOfferedTo } from '@/lib/worldOffered'
import { useMyAsaOffered } from '@/lib/myAsaOffered'
import { useShellHides } from '@/lib/myWorkHides'
import { MY_PROFILE_APP_ID } from '@/registry/apps-myprofile'
import { VEHICLE_CALENDAR_APP_ID } from '@/registry/apps-vehicle-calendar'
import { fitName, useMembersRoster } from '@/stores/useMembersRoster'

/** A person brought into this environment — their own badge travels. */
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import AsaLogo from '@/components/shared/AsaLogo'
import { useContextStore, type FocusType } from '@/stores/useContextStore'
import { allowedPages, menuPageId, visibleManifests, type AccessChecker } from '@/lib/audience'
import { useClientViewsStore } from '@/stores/useClientViewsStore'
import { useClientsPolicyStore } from '@/stores/useClientsPolicyStore'
import { useHiringPolicyStore } from '@/stores/useHiringPolicyStore'
import { usePotClientsPolicyStore, usePotClientsViewsStore } from '@/stores/usePotClientsViewsStore'

// An app's views are ALSO governed per user and by the master: Hiring's Pipeline/Flow and Potential Clients filter…
function useAppViewsFilter() {
  // what Settings › My Work keeps to the master: My Profile's My Docs, and Transportation's submenu (its first page alone)
  const hides = useShellHides()
  const clientEnabled = useClientViewsStore((s) => s.enabled)
  // THE MASTER'S POLICY CUTS FIRST (server config, read once per session): a view the master disabled does not…
  const clientMaster = useClientsPolicyStore((s) => s.views)
  const hiringMaster = useHiringPolicyStore((s) => s.views)
  const potMaster = usePotClientsPolicyStore((s) => s.views)
  const potEnabled = usePotClientsViewsStore((s) => s.enabled)
  const ensureClients = useClientsPolicyStore((s) => s.ensure)
  const ensureHiring = useHiringPolicyStore((s) => s.ensure)
  const ensurePot = usePotClientsPolicyStore((s) => s.ensure)
  useEffect(() => { ensureClients(); ensureHiring(); ensurePot() }, [ensureClients, ensureHiring, ensurePot])
  return (appId: string, pages: ReturnType<typeof allowedPages>) => {
    // hidden pages are already dropped at the source (allowedPages) — one truth A PREFERENCE that would leave the…
    if (appId === MY_PROFILE_APP_ID && hides.profile_docs) return pages.filter((p) => p.id !== 'docs')
    if (appId === VEHICLE_CALENDAR_APP_ID && hides.transport_submenu) return pages.slice(0, 1)
    if (appId === 'clients') {
      const lawful = pages.filter((p) => (clientMaster as string[]).includes(p.id))
      const kept = lawful.filter((p) => clientEnabled[p.id as keyof typeof clientEnabled] ?? true)
      if (kept.length) return kept
      if (lawful.length) return lawful
      // the ONE visible rung was cut (the master disabled Unique, or a stale preference hides it) — the row still…
      return (clientMaster as string[]).length ? pages : []
    }
    // HIRING IS ONE PAGE NOW (the merge): Flow became a hidden page (it routes, it is no rung) and its sections are…
    if (appId === 'hiring') {
      const governed = pages.filter((p) => p.id === 'pipeline')
      const rest = pages.filter((p) => p.id !== 'pipeline')
      return (hiringMaster as string[]).length ? [...governed, ...rest] : rest
    }
    // Potential Clients joined the same law — the same two configs: master policy first, then the person's…
    if (appId === 'potential-clients') {
      const lawful = pages.filter((p) => (potMaster as string[]).includes(p.id))
      const kept = lawful.filter((p) => potEnabled[p.id as keyof typeof potEnabled] ?? true)
      return kept.length ? kept : lawful
    }
    return pages
  }
}
import { selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { useEffectiveRole } from '@/lib/effectiveUser'
import { dragHasPerson, readPersonDrag } from '@/lib/focus'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { currentPlaceKey } from '@/lib/placeKey'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { TintName } from '@/engine/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AppManifest, PageSchema } from '@/engine/types'

/** Per-group open/closed state, persisted (group name → open). Default: open. */
const GROUPS_KEY = 'asa-sidebar-groups'

function readGroupState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

/* ---------- Person Focus Mode: brand slot (context-mode) ---------- */

// focus type → pill tint (Client pink / Staff blue / Director lavender).
const NO_RECENTS: never[] = []

const FOCUS_TINT: Record<FocusType, TintName> = { client: 'pink', staff: 'blue', director: 'lavender', form: 'mint', project: 'amber', house: 'peach' }
const FOCUS_LABEL: Record<FocusType, string> = { client: 'Client', staff: 'Staff', director: 'Director', form: 'Form', project: 'Project', house: 'House' }

// The sidebar brand slot.
function BrandSlot({ collapsed, railOn }: { collapsed: boolean; railOn: boolean }) {
  const focus = useContextStore((s) => s.focus)
  const setFocus = useContextStore((s) => s.setFocus)
  const clearFocus = useContextStore((s) => s.clearFocus)
  const [armed, setArmed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // true from the moment a person is picked up anywhere on the page
  const [dragInFlight, setDragInFlight] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // PERSON FOCUS IS COMPANY CHROME: the tracker beside asa.
  const inWorldBrand = Boolean(useWorldStore((st) => st.currentWorldId))
  const recents = useContextStore((s) => (inWorldBrand ? NO_RECENTS : s.recents))

  // NOTHING TO DRAW HERE — and only then: the slot empties only while the platform is transformed, and goes back to…
  const emptyBrandSlot = railOn && !focus && !dragInFlight && (collapsed || recents.length === 0)

  // a new focus resets the remove-icon toggle
  useEffect(() => setArmed(false), [focus])

  // The slot used to react only once the pointer was already over it, so the only way to learn the target existed…
  useEffect(() => {
    const start = (e: DragEvent) => {
      if (e.dataTransfer && dragHasPerson(e.dataTransfer)) setDragInFlight(true)
    }
    const end = () => {
      setDragInFlight(false)
      setDragOver(false)
    }
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [])

  return (
    <div className="shrink-0">
      <div
        onDragOver={(e) => {
          if (!dragHasPerson(e.dataTransfer)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          const f = readPersonDrag(e.dataTransfer)
          if (!f) return
          e.preventDefault()
          setFocus(f)
          toast({
            type: 'success',
            title: `Workspace focused on ${f.name}`,
            body: `Sidebar now shows ${FOCUS_LABEL[f.type].toLowerCase()} apps — click the chip at the top to exit.`,
          })
        }}
        className={cn(
          // NO EMPTY BAND ABOVE THE APPS: when the platform transforms to serve multiple users a gap opens at the…
          'relative flex items-center gap-2.5 px-5 transition-[outline,background,height] duration-150',
          emptyBrandSlot ? 'h-2' : 'h-[68px]',
          dragInFlight && 'bg-primary-soft/[.06] outline-dashed outline-2 outline-offset-[-6px] outline-primary/50',
          dragOver && 'bg-primary-soft/10 outline-dashed outline-2 outline-offset-[-6px] outline-primary',
        )}
      >
        {focus ? (
          <>
            <button
              onClick={() => setArmed((a) => !a)}
              title={armed ? 'Keep focus' : `Focused on ${focus.name} — click to reveal remove`}
              aria-pressed={armed}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] bg-white/[.06] p-1.5 text-left transition-colors duration-150 hover:bg-white/[.09]',
                collapsed && 'flex-none bg-transparent p-0 hover:bg-transparent',
              )}
            >
              <Avatar src={focus.avatar} name={focus.name} size="sm" />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[13px] font-semibold leading-4 text-white">{focus.name}</span>
                  <span
                    className={cn(
                      'mt-1 inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold leading-3',
                      focus.type === 'client' && 'bg-tint-pink text-tint-fg-pink',
                      focus.type === 'staff' && 'bg-tint-blue text-tint-fg-blue',
                      focus.type === 'director' && 'bg-tint-lavender text-tint-fg-lavender',
                      focus.type === 'form' && 'bg-tint-mint text-tint-fg-mint',
                      focus.type === 'project' && 'bg-tint-amber text-tint-fg-amber',
                      focus.type === 'house' && 'bg-tint-peach text-tint-fg-peach',
                    )}
                  >
                    {FOCUS_LABEL[focus.type]}
                  </span>
                </span>
              )}
            </button>
            <AnimatePresence>
              {armed && (
                <motion.button
                  key="remove-focus"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  onClick={() => {
                    clearFocus()
                    toast({ type: 'info', title: 'Back to full workspace', body: 'Person Focus Mode cleared — all apps are visible again.' })
                  }}
                  aria-label={`Remove focus on ${focus.name}`}
                  title="Remove focus — back to full workspace"
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full text-tint-fg-pink transition-colors duration-150 hover:bg-tint-pink',
                    collapsed && 'absolute -right-1 -top-1 bg-sidebar shadow-1',
                  )}
                >
                  <CircleX size={collapsed ? 15 : 20} />
                </motion.button>
              )}
            </AnimatePresence>
          </>
        ) : (
          <>
            {/**
              * ONE MARK, ONE COLUMN: in this configuration the asa. mark
              * rides the users' column alone.
              *
              * With the rail drawn the brand appeared twice — once at the head
              * of the people and once at the head of the apps — which reads as
              * two products side by side rather than one platform with two
              * columns. The rail is the outer edge, so the name goes there and
              * this slot keeps only what is its own: the person-focus target.
              * Without the rail nothing changes; the mark is here as always.
              */}
            {railOn ? null : collapsed ? (
              <Activity size={22} strokeWidth={2.25} className="shrink-0 text-primary" aria-hidden />
            ) : (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }} className="inline-flex">
                <AsaLogo size="md" onDark />
              </motion.span>
            )}
            {dragInFlight && !collapsed && (
              <span className="ml-auto text-[11px] font-semibold text-primary">
                {dragOver ? 'Release to focus' : 'Drop a person here'}
              </span>
            )}
            {/* Without a drag: still reachable. Recents mean switching back to
                someone you were just looking at is one click, not a table hunt. */}
            {!dragInFlight && !collapsed && recents.length > 0 && (
              <button
                onClick={() => setPickerOpen((o) => !o)}
                title="Recently focused"
                aria-label="Recently focused"
                className="ml-auto grid h-7 w-7 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/[.08] hover:text-white"
              >
                <Crosshair size={14} />
              </button>
            )}
          </>
        )}
      </div>

      {/* recently focused — quick switch without going back to a table */}
      <AnimatePresence>
        {pickerOpen && !collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden px-3 pb-2"
          >
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">
              Recently focused
            </p>
            {recents.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => {
                  setFocus(r)
                  setPickerOpen(false)
                  toast({ type: 'success', title: `Workspace focused on ${r.name}` })
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-white/[.06]',
                  focus?.id === r.id && focus?.type === r.type && 'bg-white/[.08]',
                )}
              >
                <Avatar src={r.avatar} name={r.name} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="clamp-1 block text-[12.5px] font-medium leading-4 text-white">{r.name}</span>
                  {r.subtitle && <span className="clamp-1 block text-[11px] leading-3 text-white/45">{r.subtitle}</span>}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* context caption — subtle pulse whenever the focused person changes */}
      <AnimatePresence>
        {focus && !collapsed && (
          <motion.div
            key={focus.id}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="mx-5 mb-2 mt-0.5 flex items-center gap-1.5"
          >
            <motion.span
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.1, repeat: 2, ease: 'easeInOut' }}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              // driven by the FOCUS_TINT record so a new focus type can never fall through to somebody else's colour
              style={{ background: `var(--tint-${FOCUS_TINT[focus.type]}-fg)` }}
            />
            <span className="clamp-1 text-[11px] font-medium text-sidebar-text">
              Viewing: <span className="text-white/85">{focus.name}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- USER WORLDS: the two tenant tiles at the sidebar's foot ---------- */

// THE PLACES STACK — three chips only, the last three; a fourth one is a bug: the franchise and My world above the…
function WorldTiles({ collapsed, onProfile }: { collapsed: boolean; onProfile: () => void }) {
  const navigate = useNavigate()
  const worldId = useWorldStore((s) => s.currentWorldId)
  const switching = useWorldStore((s) => s.switching)
  const user = useAuthStore((s) => s.user)
  const tenantId = useTenantStore((s) => s.currentTenantId)
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  const tenantsLoaded = useTenantStore((s) => s.tenantsLoaded)
  const currentMemberId = useMemberStore((s) => s.currentMemberId)
  // ONE ROSTER, KEPT CURRENT: adding one more platform user used to need the screen refreshed before they appeared.
  const members = useMembersRoster((s) => s.rows) ?? []
  const loadRoster = useMembersRoster((s) => s.load)
  // THE BOOT USUALLY BEATS THIS.
  useEffect(() => { void loadRoster() }, [loadRoster])
  const inWorld = Boolean(worldId)

  // master always with everything; others by the two grants (server-computed): myworld_badges opens the My world…
  const canWorld = worldOfferedTo(user)
  const canFranchise = Boolean(user?.isMaster || user?.franchiseView)

  // YOU STAND IN EXACTLY ONE PLACE: clicking the franchise used to LOSE the place and MIX the franchise with the…
  const travelTenant = (id: string) => {
    const dest = tenantById(id)
    crossToTenant(id, dest ? `Loading ${dest.name} from scratch` : undefined)
  }

  // EVERY ROW, ONE GRAMMAR, to the letter: icon bubble in front, then TWO lines - the signed-in name in BOLD…
  type Place = {
    key: string; sub: string; icon: 'world' | 'tenant' | 'member'
    owner: boolean; active: boolean; go: () => void
    // a visited PERSON shows THEIR name and THEIR badge, not the viewer's.
    person?: { id?: string; name: string; role: string; types: string[] }
  }
  const places: Place[] = []
  if (tenantsLoaded && canFranchise) {
    visibleTenants(user?.role ?? null, tenantId).forEach((t) => {
      if (t.id === homeTenantId || t.status === 'archived') return
      places.push({
        key: t.id, icon: 'tenant', owner: false,
        sub: [tenantTypeLabel(t), t.city, t.state].filter(Boolean).join(', '),
        // THE DOT READS ALL THREE AXES.
        active: !inWorld && !currentMemberId && t.id === tenantId,
        go: () => { if (inWorld || currentMemberId || t.id !== tenantId) travelTenant(t.id) },
      })
    })
  }
  if (canWorld) {
    places.push({
      key: 'world', sub: 'My world', icon: 'world', owner: true,
      active: inWorld && !currentMemberId,
      go: () => {
        if (inWorld && !currentMemberId) return
        // MY world is mine alone: the visit AND their workbook id both go.
        crossToMyWorld()
      },
    })
  }

  // THE PEOPLE BROUGHT IN: a member has to appear as what they already are — staff, say — and bring the whole…
  members.forEach((m) => {
    const who = m.name || m.email
    const visiting = currentMemberId === m.member_id
    // TWO PLACES, NOT ONE LABEL: one row promising both work AND world left no way to tell what a click would open…
    places.push({
      key: m.member_id,
      // with no world of your own, worlds are not a thing a row speaks of
      sub: `Their work${m.world_id || !canWorld ? '' : ' — their world is closed'}`,
      icon: 'member', owner: false,
      active: visiting && !inWorld,
      person: { id: m.member_id, name: who, role: m.role, types: m.types ?? [] },
      go: () => {
        // ALREADY HERE = THE WAY OUT.
        if (visiting && !inWorld) { leaveVisit(); return }
        crossToMemberWork(m, `Opening ${who}'s work`)
      },
    })
    if (canWorld && m.world_id) {
      places.push({
        key: `${m.member_id}:world`, sub: 'Their world', icon: 'world', owner: false,
        active: visiting && inWorld && worldId === m.world_id,
        person: { id: m.member_id, name: who, role: m.role, types: m.types ?? [] },
        go: () => {
          // pressing the row you are standing on is the way out, and it drops THEIR workbook id with the visit…
          if (visiting && inWorld && worldId === m.world_id) { leaveVisit(); return }
          crossToMemberWorld(m, `Opening ${who}'s world`)
        },
      })
    }
  })
  if (!places.length) return null

  // ONE ICON PER PLACE, ON BOTH SURFACES: the icons have to be the same, and a person's own icon can still change…
  const iconFor = (kind: Place['icon'], p?: Place) =>
    kind === 'member' ? (
      <Avatar src={undefined} name={p?.person?.name ?? '?'} size="sm" />
    ) : kind === 'world' ? (
      p?.person
        ? <Avatar src={undefined} name={p.person.name} size="sm" />
        : <Avatar src={user?.avatar} name={user?.name ?? 'My world'} size="sm" />
    ) : (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-fg-blue">
        <Building2 size={14} />
      </span>
    )

  // A MEMBER'S FACE AND NAME ARE HANDLES: on 100% of the pages, every user name and every set of user initials must…
  const asPerson = (p: Place, node: ReactNode, className: string, title?: string) =>
    p.person ? (
      <DragPerson
        name={p.person.name}
        id={p.person.id}
        subtitle={p.person.types[0] || p.person.role}
        className={className}
        title={title}
      >
        {node}
      </DragPerson>
    ) : (
      node
    )

  const cardCls = cn(
    'flex w-full items-center gap-2.5 rounded-[12px] p-2 text-left transition-colors hover:bg-white/[.06]',
    switching && 'pointer-events-none opacity-60',
  )

  if (collapsed) {
    return (
      <div className="mb-1 flex flex-col items-center gap-1">
        {places.map((p) => {
          const face = (
            <button
              key={p.key}
              onClick={p.active ? undefined : p.go}
              // the collapsed tile has no room for a name, so the tooltip IS the name — and it said the SIGNED-IN…
              title={`${p.person ? p.person.name : (user?.name ?? '')} - ${p.sub}`}
              className={cn('relative flex justify-center rounded-[12px] p-1.5 transition-colors hover:bg-white/[.06]', switching && 'pointer-events-none opacity-60')}
            >
              {/* YOU ARE HERE IS A RING, NOT A DOT: a green outline around
                  the user's circle, and no little dot in front of it.
                  The dot sat BESIDE the face
                  and cost horizontal room the rail does not have — at 60px it
                  pushed the circle off centre and read as a broken tile. A
                  ring costs none: it is the same circle, lit. */}
              <span className={cn('rounded-full', p.active && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-sidebar')}>
                {/* inside the ring, so the emerald keeps hugging the circle;
                    the tooltip stays name-first — the rail has no other way
                    to say whose face this is */}
                {asPerson(p, iconFor(p.icon, p), 'block', p.person ? `${p.person.name} - ${p.sub} — drag to focus` : undefined)}
              </span>
            </button>
          )
          if (!p.active) return face
          return (
            <DropdownMenu key={p.key}>
              <DropdownMenuTrigger asChild>{face}</DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuItem onClick={onProfile}><User size={14} /> Profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')}><Settings size={14} /> Settings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
    )
  }

  return (
    <div className="mb-0.5 space-y-0.5">
      {places.map((p) => {
        const face = (
          <button key={p.key} onClick={p.active ? undefined : p.go} title={p.active ? `You are in ${p.sub}` : `Cross to ${p.sub}`} className={cardCls}>
            <span
              className={cn('rounded-full', p.active && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-sidebar')}
              aria-label={p.active ? 'You are here' : undefined}
            >
              {asPerson(p, iconFor(p.icon, p), 'block')}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {/* ALWAYS ONE LINE. A full name plus a job title plus the
                    MANAGER badge wrapped, which grew every card and
                    pushed the app nav off the screen. Initials keep the family
                    name, which is what tells two people sharing a first name
                    apart; an ellipsis would have thrown it away. */}
                {asPerson(
                  p,
                  <span
                    className="clamp-1 text-[13px] font-semibold leading-5 text-white"
                    title={p.person ? p.person.name : (user?.name ?? '')}
                  >
                    {fitName(p.person ? p.person.name : (user?.name ?? ''))}
                  </span>,
                  'block min-w-0',
                )}
                {p.person
                  ? <span className="inline-flex shrink-0 items-center rounded-full bg-tint-blue px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-tint-fg-blue"
                      title={`They arrive as ${p.person.types[0] || p.person.role}`}>
                      {(p.person.types[0] || p.person.role || 'staff').toUpperCase()}
                    </span>
                  : p.owner
                  // OWNER on your own ground, USER inside somebody else's platform (Members.gs) — the world is the…
                  ? <span className={cn(
                      'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      user?.worldRole === 'user'
                        ? 'bg-tint-blue text-tint-fg-blue'
                        : 'bg-tint-lavender text-tint-fg-lavender',
                    )}
                    title={user?.worldRole === 'user'
                      ? 'User — your world, on somebody else\'s platform'
                      : 'Owner — this world is yours'}>
                      {user?.worldRole === 'user' ? 'USER' : 'OWNER'}
                    </span>
                  : user && <HighestBadge user={user} size="xs" />}
              </span>
              <span className="clamp-1 block text-[12px] leading-4 text-sidebar-text">{p.sub}</span>
            </span>
          </button>
        )
        // the ACTIVE card answers like the account chip - clicking My world has to open the profile, so it carries…
        if (!p.active) return face
        return (
          <DropdownMenu key={p.key}>
            <DropdownMenuTrigger asChild>{face}</DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-48">
              <DropdownMenuItem onClick={onProfile}><User size={14} /> Profile</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}><Settings size={14} /> Settings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
    </div>
  )
}

function NavItem({
  app,
  collapsed,
  index,
  pages,
  activePageId,
}: {
  app: AppManifest
  collapsed: boolean
  index: number
  /** Pages minus ones denied for the signed-in role (fine-grained access). */
  pages: PageSchema[]
  /** Current route's page id when this app is active, else null. */
  activePageId: string | null
}) {
  const page = pages[0] ?? app.pages[0]
  const to = `/app/${app.id}/${page?.id ?? ''}`
  const showPages = !collapsed && activePageId !== null && pages.length > 1
  const lit = activePageId === null ? null : menuPageId(app, activePageId)
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, height: 0, marginBottom: 0 }}
      transition={{ delay: index * 0.025, duration: 0.2 }}
      layout
    >
      <NavLink
        to={to}
        title={collapsed ? app.name : undefined}
        className={({ isActive }) =>
          cn(
            'group relative flex h-10 items-center gap-3 rounded-[12px] px-3 text-[14px] font-medium transition-colors duration-150',
            isActive ? 'bg-primary-soft text-primary' : 'text-sidebar-text hover:bg-white/[.06] hover:text-white',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[8px] bg-primary" />}
            <span className="relative shrink-0">
              <AppIcon name={app.icon} size={18} />
              {/* the dot lasts ONE DAY from install, per browser — a static
                  manifest flag lit ~60 of these forever */}
              {appIsNew(app.id) && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
            </span>
            {!collapsed && <span className="clamp-1 transition-opacity duration-150">{app.name}</span>}
          </>
        )}
      </NavLink>
      {/* page submenu — active multi-page app; denied pages already dropped */}
      {showPages && (
        <ul className="mb-1 mt-0.5 space-y-0.5">
          {pages.map((p) => (
            <li key={p.id}>
              <NavLink
                to={`/app/${app.id}/${p.id}`}
                className={cn(
                  'clamp-1 block rounded-[8px] py-1.5 pl-[42px] pr-3 text-[12.5px] transition-colors duration-150',
                  p.id === lit ? 'font-semibold text-primary' : 'text-sidebar-text hover:bg-white/[.06] hover:text-white',
                )}
              >
                {p.title}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </motion.li>
  )
}

/** Collapsible category accordion. Collapsed rail mode always shows every app. */
function NavGroup({
  def,
  apps,
  collapsed,
  role,
  checker,
  activeAppId,
  activePageId,
}: {
  def: CategoryDef
  apps: AppManifest[]
  collapsed: boolean
  role: Role | null | undefined
  checker: AccessChecker
  activeAppId: string | null
  activePageId: string | null
}) {
  const [open, setOpen] = useState(() => readGroupState()[def.id] ?? true)
  const appPages = useAppViewsFilter()

  const toggle = () => {
    const next = !open
    setOpen(next)
    const map = readGroupState()
    map[def.id] = next
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(map))
    } catch {
      /* storage unavailable */
    }
  }

  if (collapsed) {
    return (
      <div className="mb-4">
        <div className="mx-3 mb-2 border-t border-white/10" />
        <ul className="space-y-0.5">
          <AnimatePresence initial={false}>
            {apps.filter((app) => app.id !== 'clients' || appPages(app.id, allowedPages(app, role, checker)).length > 0).map((app, i) => (
              <NavItem
                key={app.id}
                app={app}
                collapsed
                index={i}
                pages={appPages(app.id, allowedPages(app, role, checker))}
                activePageId={app.id === activeAppId ? activePageId : null}
              />
            ))}
          </AnimatePresence>
        </ul>
      </div>
    )
  }

  return (
    <div className="mb-4">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="mb-1.5 flex w-full items-center justify-between rounded-md px-3 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-text transition-colors duration-150 hover:text-white"
      >
        {/* A section heading is a label, and every one of them reads the same.
            Custom categories used to carry a tinted tile the built-ins never
            had, so HIRING sat next to CORE looking like a different kind of
            thing — the mix was the problem, not the icon. The apps below carry
            the icons; the heading over them does not need one. */}
        <span className="clamp-1 min-w-0">{def.label}</span>
        <ChevronDown
          size={12}
          className={cn('shrink-0 transition-transform duration-200', !open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            className="space-y-0.5 overflow-hidden"
          >
            <AnimatePresence initial={false}>
              {apps.filter((app) => app.id !== 'clients' || appPages(app.id, allowedPages(app, role, checker)).length > 0).map((app, i) => (
                <NavItem
                  key={app.id}
                  app={app}
                  collapsed={false}
                  index={i}
                  pages={appPages(app.id, allowedPages(app, role, checker))}
                  activePageId={app.id === activeAppId ? activePageId : null}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Sidebar({ mobile = false }: { mobile?: boolean }) {
  const allApps = useRegistryStore((s) => s.apps)
  /** Real, and the only number the profile panel is allowed to show. */
  const installedCount = allApps.filter((a) => a.enabled).length
  const focus = useContextStore((s) => s.focus)
  // THE NAV IS DRAWN FOR THE EFFECTIVE PERSON (sixth round).
  const role = useEffectiveRole()
  // Fine-grained access: explicit per-role denies hide apps (and pages, via allowedPages in NavItem) — onboarding…
  const badgeVersion = useBadgeRulesVersion()
  const bookmarksOffered = useMyAsaOffered()
  // Settings › My Work keeps "+ Add apps" to the master's own session unless its switch shows it to everyone
  const shellHides = useShellHides()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- badgeVersion re-arms the checker when the badge matrix changes
  const checker = useMemo<AccessChecker>(() => selectAccessChecker(allApps, role), [allApps, role, badgeVersion])
  // Audience filter (src/lib/audience.ts): Person Focus Mode scoping, the caregiver (staff) tightening and the…
  const apps = useMemo(
    () => visibleManifests(allApps, { focus, role }, checker).filter((a) => a.enabled),
    [allApps, focus, role, checker],
  )
  // user-created categories + per-app assignment overrides (App Hub → "Manage categories") merge with the built-in…
  const customCategories = useCategoryStore((s) => s.customCategories)
  const labelOverrides = useCategoryStore((s) => s.labelOverrides)
  const categoryOrder = useCategoryStore((s) => s.categoryOrder)
  const appCategory = useCategoryStore((s) => s.appCategory)
  const appOrder = useCategoryStore((s) => s.appOrder)
  const groups = useMemo(
    () => groupedApps(apps, appCategory, mergedCategoryDefs(customCategories, labelOverrides, categoryOrder), appOrder),
    [apps, appCategory, customCategories, labelOverrides, categoryOrder, appOrder],
  )
  const tenantId = useTenantStore((s) => s.currentTenantId)
  // USER WORLDS: which face the shell is wearing, and who gets the tiles — worlds are an employee thing (restricted…
  const worldActive = Boolean(useWorldStore((s) => s.currentWorldId))
  const worldName = useWorldStore((s) => s.worldName)
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  // the account chip IS the ASA LifeCare card - no asa.
  const tenantsLoadedChip = useTenantStore((s) => s.tenantsLoaded)
  // HOME IS ALL THREE AXES, AND THIS LINE READ TWO: there was no way back to the headquarters at all except through…
  const visitingChip = Boolean(useMemberStore((s) => s.currentMemberId))
  const atHome = !worldActive && !visitingChip &&
                 (!tenantsLoadedChip || tenantId === homeTenantId)
  const goHomeFromChip = () =>
    crossHome(`Coming home to ${homeTenantRow?.name ?? 'ASA LifeCare'}`)
  // THE STACK IS THE ACCOUNT'S, NOT THE VISIT'S.
  const accountRole = useAuthStore((s) => s.user?.role)
  // THE SERVER SAYS WHO HAS A WORLD, NOT THIS LINE: the CLIENT role had no My world at all, and every role has to…
  const placesEligible = !isRestrictedRole(accountRole)
  const { sidebarCollapsed, toggleSidebar, setPaletteOpen, setDrawerOpen, railExpanded, toggleRail } = useShellStore()
  // the mobile drawer always renders the expanded sidebar content
  const collapsed = mobile ? false : sidebarCollapsed
  const openDetail = useDetailPanelStore((s) => s.openDetail)
  const openProfileSheet = useProfileSheetStore((s) => s.setOpen)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const location = useLocation()

  const signOut = () => {
    logout()
    navigate('/login', { replace: true })
  }

  // The profile panel opener - ONE door, two handles: the account chip's menu and the active place card's menu both…
  const homeTenantRow = tenantById(homeTenantId)
  const placeLabel = homeTenantRow
    ? [tenantTypeLabel(homeTenantRow), homeTenantRow.city, homeTenantRow.state].filter(Boolean).join(', ')
    : 'ASA LifeCare'
  const standingLabel = worldActive
    ? (worldName || 'My world')
    : (() => { const t = tenantById(tenantId); return t ? [tenantTypeLabel(t), t.city, t.state].filter(Boolean).join(', ') : placeLabel })()

  const openProfilePanel = async () => {
    if (!user) return
    let master: MasterOverview | null = null
    if (user.role === 'admin') {
      try { master = await gasAction<MasterOverview>('masterOverview', {}) } catch { master = null }
    }
    // THE CLIENT MUST NOT PROMOTE ITSELF: the configs appeared to take and were gone on the next sign-in, with…
    let shown = master && !user.isMaster ? { ...user, isMaster: true } : user
    const place = currentPlaceKey()
    if (place) {
      try {
        const r = await gasAction<{ profile: { display_name?: string; title?: string; avatar?: string } | null }>('placeProfileGet', { place })
        if (r?.profile) {
          shown = { ...shown,
            ...(r.profile.display_name ? { name: r.profile.display_name } : {}),
            ...(r.profile.title ? { title: r.profile.title } : {}),
            ...(r.profile.avatar ? { avatar: r.profile.avatar } : {}) }
        }
      } catch { /* the home identity shows through */ }
    }
    const { record, config } = buildProfilePanel({
      user: shown,
      installedCount,
      overview: master,
      onEdit: () => openProfileSheet(true),
      // OWNER ONLY ON YOUR OWN GROUND (sweep): this stamped the lavender OWNER badge whenever ANY world was open…
      place: { label: standingLabel, owner: worldActive && !visitingChip },
    })
    openDetail({ record, config })
  }

  // ONE PERSON KEEPS THE ORDINARY LAYOUT: with a single user, the common default, the LAYOUT GOES BACK TO NORMAL…
  const memberCount = useMembersRoster((s) => s.rows)?.length ?? 0
  // THE RAIL WAITS FOR THIS ACCOUNT'S OWN ANSWER — seen twice, as a client whose My world card drew as a bare…
  const rosterVersion = useMembersRoster((s) => s.version)
  const railOn = rosterVersion > 0 && memberCount >= 2
  /** circles ⇄ names, and zero when there is no rail at all. */
  const railW = railOn ? (railExpanded ? 216 : 60) : 0
  // The places' own compact state: the rail's while railed, the app column's otherwise — reading the app column's…
  const placesCollapsed = railOn ? (!railExpanded && railW <= 76) : collapsed

  /** The stack itself, rendered in whichever of the two shapes applies. */
  const placesStack = (
    <>
        {/* THE SLOT (USER WORLDS): the two worlds side by side where the mono
            TENANT caption sat — company | mine, active one lit. Roles without
            worlds keep the old caption. */}
        {/* placesCollapsed, NOT !railExpanded — reported four times over:
            the My world icon with NO NAME AT ALL in front of it and NO
            BADGE either.
            `railExpanded` is false by default, so `!railExpanded` was TRUE
            for everybody — rail or no rail, 60px column or 264px one — and
            every places stack on the platform has been drawing its compact
            form since the rail landed. `placesCollapsed` was computed three
            times over and never wired here, so every new guard only moved
            a value the component does not read. The bug was the wire. */}
        {placesEligible ? (
          <WorldTiles collapsed={placesCollapsed} onProfile={() => void openProfilePanel()} />
        ) : (
          !placesCollapsed && (
            <p className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-sidebar-text/60">
              TENANT: {tenantId}
            </p>
          )
        )}
        {/* THE HOME ROW OBEYS THE CARDS' OWN LAW — clicking Headquarters
            used not to load the tenant at all: standing
            away - in Akron or in a world - clicking it CROSSES home; at
            home (dot lit) it opens the account menu as always. */}
        {user && (atHome ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'relative flex w-full items-center gap-2.5 rounded-[12px] p-2 text-left transition-colors hover:bg-white/[.06]',
                  placesCollapsed && 'justify-center',
                )}
              >
                {/* the same ring the place tiles wear — one grammar for
                    "you are here", on every row of the stack */}
                <span
                  className={cn('rounded-full', placesEligible && atHome && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-sidebar')}
                  aria-label={atHome ? 'You are here' : undefined}
                >
                  <Avatar src={user.avatar} name={user.name} size="sm" />
                </span>
                {!placesCollapsed && (
                  <span className="min-w-0">
                    {/**
                      * `leading-5`, not `leading-4`: a 10px chip with its own
                      * vertical padding is TALLER than a 16px line box, so on
                      * `leading-4` it overflowed downward and printed on top
                      * of the line beneath it — the overlap over "admin".
                      * The name still clamps; only the
                      * row it lives in was too short to hold the chip.
                      */}
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="clamp-1 text-[13px] font-semibold leading-5 text-white">{user.name}</span>
                      {/* the chip is the HOME row - the MASTER badge is
                          what you ARE on company ground; the world card
                          above wears OWNER */}
                      <HighestBadge user={user} size="xs" />
                    </span>
                    {/* THE TITLE ALONE — "Administration" on its own is
                        enough. "Admin · Administration"
                        was the access role and the job title glued together —
                        the same word twice in two vocabularies, and the badge
                        beside the name already says the access half. The role
                        only appears when there is no title to show. */}
                    {/* THE PLACE, not the job title:
                        "Asa Lifecare Ohio" at home, the franchise's name in
                        Akron, the world's name inside it - the MASTER chip
                        above already says who you are. */}
                    <span className="clamp-1 block text-[12px] leading-4 text-sidebar-text">
                      {placeLabel}
                    </span>
                  </span>
                )}
              </button>
            
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-48">
              {/* THE TRAINEE'S DROP-UP IS ONE LINE (chapter 24): the drop-up
                  on the left side carries log out and nothing else */}
              {user.role !== 'onboarding' && (
                <>
                  <DropdownMenuItem onClick={() => void openProfilePanel()}>
                    <User size={14} /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings size={14} /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={signOut}>
                <LogOut size={14} /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
              <button
                onClick={goHomeFromChip}
                title="Back to Headquarters"
                className={cn(
                  'relative flex w-full items-center gap-2.5 rounded-[12px] p-2 text-left transition-colors hover:bg-white/[.06]',
                  placesCollapsed && 'justify-center',
                )}
              >
                {/* the same ring the place tiles wear — one grammar for
                    "you are here", on every row of the stack */}
                <span
                  className={cn('rounded-full', placesEligible && atHome && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-sidebar')}
                  aria-label={atHome ? 'You are here' : undefined}
                >
                  <Avatar src={user.avatar} name={user.name} size="sm" />
                </span>
                {!placesCollapsed && (
                  <span className="min-w-0">
                    {/**
                      * `leading-5`, not `leading-4`: a 10px chip with its own
                      * vertical padding is TALLER than a 16px line box, so on
                      * `leading-4` it overflowed downward and printed on top
                      * of the line beneath it — the overlap over "admin".
                      * The name still clamps; only the
                      * row it lives in was too short to hold the chip.
                      */}
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="clamp-1 text-[13px] font-semibold leading-5 text-white">{user.name}</span>
                      {/* the chip is the HOME row - the MASTER badge is
                          what you ARE on company ground; the world card
                          above wears OWNER */}
                      <HighestBadge user={user} size="xs" />
                    </span>
                    {/* THE TITLE ALONE — "Administration" on its own is
                        enough. "Admin · Administration"
                        was the access role and the job title glued together —
                        the same word twice in two vocabularies, and the badge
                        beside the name already says the access half. The role
                        only appears when there is no title to show. */}
                    {/* THE PLACE, not the job title:
                        "Asa Lifecare Ohio" at home, the franchise's name in
                        Akron, the world's name inside it - the MASTER chip
                        above already says who you are. */}
                    <span className="clamp-1 block text-[12px] leading-4 text-sidebar-text">
                      {placeLabel}
                    </span>
                  </span>
                )}
              </button>
            
        ))}
    </>
  )

  return (
    <motion.aside
      initial={false}
      animate={mobile ? undefined : { width: railW + (collapsed ? 76 : 264) }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={
        mobile
          ? 'flex h-full w-[340px] flex-row bg-sidebar'
          : 'fixed inset-y-0 left-0 z-20 hidden flex-row border-r border-border bg-sidebar lg:flex'
      }
      // below the strip at the top (shell/HubStrip) while it is up
      style={mobile ? undefined : { top: 'var(--hub-strip-h, 0px)' }}
      aria-label="App launcher"
    >
      {railOn && (
      <div
        className="flex h-full shrink-0 flex-col border-r border-white/10"
        style={{ width: railW }}
      >
        {/* THE MARK RIDES THE RAIL — the asa. lockup belongs over the
            users. With two columns the brand sat over the APPS, so the
            column of people opened with nothing — the platform's own name
            belongs above the people standing on it. */}
        <div className={cn('flex h-[60px] shrink-0 items-center', railExpanded ? 'px-3' : 'justify-center')}>
          {/* the full lockup needs room; at 60px the wordmark clipped, so the
              pulse stands for it — the same mark the collapsed app column
              has always used */}
          {railExpanded
            ? <AsaLogo size="sm" onDark />
            : <Activity size={20} strokeWidth={2.25} className="shrink-0 text-primary" aria-hidden />}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2">
          {placesStack}
        </div>
        {/* the rail's own toggle: circles ⇄ names */}
        <button
          onClick={toggleRail}
          aria-label={railExpanded ? 'Show places as icons' : 'Show place names'}
          title={railExpanded ? 'Icons only' : 'Show names'}
          className="m-2 grid h-8 shrink-0 place-items-center rounded-[10px] text-sidebar-text transition-colors hover:bg-white/[.06] hover:text-white"
        >
          {railExpanded ? <ChevronsLeft size={15} /> : <ChevronsRight size={15} />}
        </button>
      </div>
      )}

      {/* THE APP COLUMN — everything that was here before, minus the places */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* brand lockup ⇄ person focus chip (drop target for person drags) */}
      <BrandSlot collapsed={collapsed} railOn={railOn} />

      {/* search field → ⌘K */}
      <div className="px-4 pb-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-[12px] bg-white/[.06] px-3 text-[13px] text-sidebar-text transition-colors hover:bg-white/[.09]',
            collapsed && 'justify-center px-0',
          )}
        >
          <Search size={15} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded-[6px] bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* nav groups (dynamic from registry categories, collapsible) */}
      <nav className="scroll-thin flex-1 overflow-y-auto px-4" aria-label="Apps">
        {groups.map((group) => {
          return (
            <NavGroup
              key={group.def.id}
              def={group.def}
              apps={group.apps}
              collapsed={collapsed}
              role={role}
              checker={checker}
              activeAppId={location.pathname.split('/')[1] === 'app' ? (location.pathname.split('/')[2] ?? null) : null}
              activePageId={location.pathname.split('/')[3] ?? null}
            />
          )
        })}

        {/* bookmarks + "Add apps": shell extras a restricted role has no
            business with (their workspace is one app, by config). Hidden in
            a WORLD too: bookmarks point at company pages, and a door that
            bounces you back to the hub reads as an error. */}
        {!isRestrictedRole(role) && !useWorldStore.getState().currentWorldId && bookmarksOffered && <NavLink
          to="/bookmarks"
          title={collapsed ? 'Bookmarks' : undefined}
          className={({ isActive }) =>
            cn(
              'group relative mb-2 flex h-10 items-center gap-3 rounded-[12px] px-3 text-[14px] font-medium transition-colors duration-150',
              isActive ? 'bg-primary-soft text-primary' : 'text-sidebar-text hover:bg-white/[.06] hover:text-white',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[8px] bg-primary" />}
              <Bookmark size={18} className="shrink-0" />
              {!collapsed && <span className="clamp-1">Bookmarks</span>}
            </>
          )}
        </NavLink>}

        {/* add apps */}
        {!isRestrictedRole(role) && !shellHides.add_apps && <button
          onClick={() => navigate('/apps')}
          className={cn(
            'flex h-10 w-full items-center gap-3 rounded-[12px] border border-dashed border-white/20 px-3 text-[13px] font-medium text-sidebar-text transition-colors hover:border-white/40 hover:text-white',
            collapsed && 'justify-center px-0',
            location.pathname === '/apps' && 'border-primary/60 text-primary',
          )}
        >
          <Plus size={16} className="shrink-0" />
          {!collapsed && 'Add apps'}
        </button>}
      </nav>

      {/* footer */}
      <div className="shrink-0 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={mobile ? () => setDrawerOpen(false) : toggleSidebar}
          aria-label={mobile ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'mb-2 flex h-9 w-full items-center gap-3 rounded-[12px] px-3 text-[13px] text-sidebar-text transition-colors hover:bg-white/[.06] hover:text-white',
            collapsed && 'justify-center px-0',
          )}
        >
          {mobile ? <ChevronsLeft size={16} /> : collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {mobile ? 'Close menu' : !collapsed && 'Collapse'}
        </button>
        {/* ONE PERSON: the places stay where they always were — but a LONG
            stack (the rail's fallback when the roster read has not answered
            yet) scrolls inside its own bounds instead of crushing the nav
            above it. */}
        {!railOn && (
          <div className="scroll-thin max-h-[38vh] overflow-y-auto">{placesStack}</div>
        )}
      </div>
      </div>
    </motion.aside>
  )
}
