// Settings → Organization (anchor #organization).
// The REAL tenant directory: on mount `loadTenants()` pulls `tenantsList` from the Hub backend into useTenantStore…
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Lock, MoreHorizontal, Plus } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import SiteFooter from '@/components/shared/SiteFooter'
import { gasAction } from '@/features/hiring/shared'
import { api } from '@/lib/api'
import { cachedUsers, fetchUsers } from '@/lib/usersDirectory'
import { useAuthStore } from '@/auth/useAuthStore'
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
import { crossToTenant } from '@/lib/crossPlace'
import { useTenantStore, visibleTenants } from '@/stores/useTenantStore'
import { toast } from '@/stores/useToastStore'
import { tenantTypeLabel, type Tenant, type TenantType } from '@/lib/tenancy'
import { cn } from '@/lib/utils'
import { EASE_OUT_EXPO } from '@/engine/motion'

const TYPE_CHIP: Record<TenantType, string> = {
  hq: 'bg-tint-primary text-tint-fg-primary',
  branch: 'bg-tint-info text-tint-fg-info',
  franchise: 'bg-tint-lavender text-tint-fg-lavender',
}

const STATUS_CHIP: Record<Tenant['status'], string> = {
  active: 'bg-tint-primary text-tint-fg-primary',
  onboarding: 'bg-tint-warning text-tint-fg-warning',
  archived: 'bg-tint-slate text-tint-fg-slate',
}

const INPUT_CLS =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const PRIMARY_BTN =
  'flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40'

const GHOST_BTN =
  'h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1'

function TenantTypeChip({ type }: { type: TenantType }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', TYPE_CHIP[type])}>
      {tenantTypeLabel(type)}
    </span>
  )
}

type DialogState = { kind: 'form'; tenant?: Tenant } | { kind: 'archive'; tenant: Tenant } | { kind: 'workbook'; tenant: Tenant } | null

export default function OrganizationSection() {
  const currentTenantId = useTenantStore((s) => s.currentTenantId)
  const homeTenantId = useTenantStore((s) => s.homeTenantId)
  const tenants = useTenantStore((s) => s.tenants)
  const tenantsLoaded = useTenantStore((s) => s.tenantsLoaded)
  const tenantsLoading = useTenantStore((s) => s.tenantsLoading)
  const loadTenants = useTenantStore((s) => s.loadTenants)
  const role = useAuthStore((s) => s.user?.role)
  // giving a place its own workbook changes where every screen in it reads from, so it is the master's hand — the…
  const isMaster = useAuthStore((s) => s.user?.isMaster === true)
  const homeId = useTenantStore((s) => s.homeTenantId)
  const isAdmin = role === 'admin'
  const [dialog, setDialog] = useState<DialogState>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // LIVE COUNTS for the current tenant — the STAFF and CLIENTS figures were wrong: the tenants tab held hand-typed…
  const [liveCounts, setLiveCounts] = useState<{ staff: number; clients: number } | null>(null)
  useEffect(() => {
    let alive = true
    const usersP = (async () => {
      const rows = cachedUsers() ?? (await fetchUsers())
      return (rows as { role?: string; active?: unknown; armed?: unknown }[]).filter((u) =>
        String(u.active ?? 'true') !== 'false' && u.armed === true && u.role !== 'client').length
    })()
    const clientsP = api.list('clients').then((r) => (r as unknown[]).length)
    void Promise.all([usersP, clientsP])
      .then(([staff, clients]) => { if (alive) setLiveCounts({ staff, clients }) })
      .catch(() => { /* the typed numbers stand until the real ones answer */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    loadTenants().catch((err) => {
      setLoadError(err instanceof Error ? err.message : 'Could not load the tenant directory.')
    })
  }, [loadTenants])

  const current = tenants.find((t) => t.id === currentTenantId)
  // franchises are admin-only; branches/hq admin+manager; staff gets no switch
  const switchable = visibleTenants(role, currentTenantId)
  const canSwitch = switchable.length > 1

  // GIVE A PLACE ITS OWN WORKBOOK (C3).
function GiveWorkbookDialog({ tenant, onClose, onDone }: { tenant: Tenant; onClose: () => void; onDone: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await gasAction<{ tenant_id: string; created: boolean }>('tenantEnsure', { tenant_id: tenant.id })
      toast({
        type: 'success',
        title: res?.created ? `${tenant.name} has its own workbook` : `${tenant.name} already had one`,
        body: res?.created
          ? 'It starts empty. Everything made there from now on lives in it, and nothing else can read it.'
          : undefined,
      })
      onClose()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workbook.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            Give {tenant.name} its own workbook?
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-text-3">
            It stops sharing the company's spreadsheet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5 text-[12.5px] leading-5 text-text-2">
          <p>
            Today this place reads the company's spreadsheet and sees only the rows stamped
            for it. With its own workbook there is nothing to stamp and nothing to compare —
            the other place's rows are not filtered out, they are simply not there.
          </p>
          <p>
            <strong className="font-semibold text-text-1">It starts empty.</strong> Nothing is
            copied, so anything already made here stays on the company's book and stops
            appearing.
          </p>
          <p>
            Accounts, sign-in sessions, the list of places and the access matrices stay where
            they are on purpose — they are what lets anybody sign in and reach this place at all.
          </p>
        </div>
        {error && (
          <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
        )}
        <DialogFooter>
          <button type="button" onClick={onClose} className={GHOST_BTN} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
            {busy && <Loader2 size={13} className="animate-spin" />} Create the workbook
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// THE TENANT TRAVELER — changing tenant in Organization goes through an Apply button and a large loading screen…
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [traveling, setTraveling] = useState<{ name: string; home: boolean } | null>(null)

  const travelTo = (id: string, home: boolean) => {
    const dest = tenants.find((t) => t.id === id)
    setTraveling({ name: dest?.name ?? id, home })
    // THE THIRD COPY OF THE TENANT CROSSING, and the one that cleared nothing (found in a sweep).
    window.setTimeout(() => { crossToTenant(id) }, 1200)
  }

  const home = tenants.find((t) => t.id === homeTenantId)
  const away = Boolean(homeTenantId && currentTenantId && currentTenantId !== homeTenantId)

  const refresh = async () => {
    try {
      await loadTenants()
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reload the tenant directory.')
    }
  }

  return (
    <motion.section
      id="organization"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Organization"
          sub="Tenants, branches and franchises — loaded live from the Hub backend."
          extra={
            isAdmin ? (
              <button type="button" onClick={() => setDialog({ kind: 'form' })} className={PRIMARY_BTN}>
                <Plus size={14} /> Add location
              </button>
            ) : undefined
          }
        />

        {/* current tenant card + switcher */}
        {current && (
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-md border border-border bg-surface-2 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold text-text-1">{current.name}</p>
                <TenantTypeChip type={current.type} />
              </div>
              <p className="mt-1 text-[12px] text-text-3">
                {current.city}, {current.state}
                {current.since ? ` · since ${current.since}` : ''}
              </p>
              <p className="mt-0.5 text-[12px] text-text-3">
                {(current.id === homeTenantId ? liveCounts?.staff ?? current.staffCount : current.staffCount)} staff · {(current.id === homeTenantId ? liveCounts?.clients ?? current.clientCount : current.clientCount)} clients
                {current.id === homeTenantId && liveCounts && <span className="ml-1 text-[10.5px] uppercase tracking-wide text-text-3">· live</span>}
              </p>
            </div>
            {canSwitch ? (
              <div className="w-full sm:w-[280px]">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-text-2">Current tenant</span>
                  <Select value={pendingId ?? current.id} onValueChange={(id) => setPendingId(id === currentTenantId ? null : id)}>
                    <SelectTrigger className="h-9 rounded-sm border-border bg-surface text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {switchable.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {pendingId && (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => travelTo(pendingId, pendingId === homeTenantId)}
                      className={PRIMARY_BTN}
                    >
                      Apply — load {tenants.find((t) => t.id === pendingId)?.name ?? 'tenant'}
                    </button>
                    <button type="button" onClick={() => setPendingId(null)} className={GHOST_BTN}>
                      Cancel
                    </button>
                  </div>
                )}
                {pendingId && pendingId !== homeTenantId && (
                  <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">
                    That workspace loads from scratch: only the basic apps installed,
                    and you are its only user until you install more.
                  </p>
                )}
                {away && !pendingId && home && (
                  <button
                    type="button"
                    onClick={() => travelTo(home.id, true)}
                    className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-primary bg-primary-soft px-3 text-[13px] font-semibold text-primary-strong transition-colors hover:bg-primary-soft/70"
                  >
                    Return to {home.name}
                  </button>
                )}
                {role !== 'admin' && (
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-text-3">
                    <Lock size={11} /> Franchises are admins only
                  </span>
                )}
              </div>
            ) : (
              <div className="w-full sm:w-[240px]">
                <span className="mb-1.5 block text-[12px] font-medium text-text-2">Current tenant</span>
                <p className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-[13px] text-text-2">
                  <Lock size={12} className="shrink-0 text-text-3" />
                  <span className="clamp-1">{current.name}</span>
                </p>
                <span className="mt-1 block text-[11px] text-text-3">Tenant switching is admin/manager only</span>
              </div>
            )}
          </div>
        )}

        {loadError && (
          <div className="mb-4 space-y-2">
            <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{loadError}</p>
            <button type="button" onClick={() => void refresh()} className={GHOST_BTN}>
              Retry
            </button>
          </div>
        )}

        {!tenantsLoaded && tenantsLoading ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-text-3">
            <Loader2 size={14} className="animate-spin" /> Loading tenant directory…
          </p>
        ) : tenants.length === 0 ? (
          !loadError && (
            <EmptyState
              title="No locations yet"
              body={
                isAdmin
                  ? 'Add your headquarters or first franchise with the button above — data scoping follows the directory.'
                  : 'The tenant directory is empty — an admin can add locations here.'
              }
            />
          )
        ) : (
          /* tenant directory — rows outside the role's scope are greyed + locked */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-text-3">
                  <th className="pb-2 pr-3 font-semibold">Tenant</th>
                  <th className="pb-2 pr-3 font-semibold">Type</th>
                  <th className="pb-2 pr-3 font-semibold">Location</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Staff</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Clients</th>
                  <th className="pb-2 pr-3 font-semibold">Since</th>
                  <th className="pb-2 font-semibold">Status</th>
                  {isAdmin && <th className="pb-2 font-semibold" aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const locked = !switchable.some((v) => v.id === t.id)
                  return (
                    <tr
                      key={t.id}
                      className={cn(
                        'border-b border-border last:border-0',
                        t.id === currentTenantId && 'bg-surface-2/60',
                        locked && 'opacity-50',
                      )}
                    >
                      <td className="py-2.5 pr-3 font-medium text-text-1">
                        <span className="flex items-center gap-1.5">
                          {locked && <Lock size={12} className="shrink-0 text-text-3" />}
                          {t.name}
                          {locked && (
                            <span className="inline-flex rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">
                              {t.type === 'franchise' ? 'Admins only' : 'No switch'}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <TenantTypeChip type={t.type} />
                      </td>
                      <td className="py-2.5 pr-3 text-text-2">
                        {t.city}, {t.state}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-text-2">{t.id === homeTenantId && liveCounts ? liveCounts.staff : t.staffCount}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-text-2">{t.id === homeTenantId && liveCounts ? liveCounts.clients : t.clientCount}</td>
                      <td className="py-2.5 pr-3 text-text-2">{t.since || '—'}</td>
                      <td className="py-2.5">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', STATUS_CHIP[t.status])}>
                          {t.status}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`Actions for ${t.name}`}
                                className="grid h-7 w-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                              >
                                <MoreHorizontal size={15} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-surface">
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'form', tenant: t })}>Edit</DropdownMenuItem>
                              {isMaster && t.id !== homeId && t.status !== 'archived' && (
                                <DropdownMenuItem onSelect={() => setDialog({ kind: 'workbook', tenant: t })}>
                                  Give it its own workbook
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => setDialog({ kind: 'archive', tenant: t })}>Archive</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.kind === 'form' && <TenantFormDialog tenant={dialog.tenant} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'archive' && <ArchiveTenantDialog tenant={dialog.tenant} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'workbook' && <GiveWorkbookDialog tenant={dialog.tenant} onClose={() => setDialog(null)} onDone={refresh} />}

      {/* THE BIG LOADING — covers everything while the
          switch commits and the SPA reboots under the destination tenant.
          The two auto margins centre it in the room above the footer. */}
      {traveling && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center gap-4 bg-surface">
          <span className="mt-auto font-display text-[22px] font-bold tracking-tight text-text-1">asa<span className="text-primary">.</span></span>
          <Loader2 size={30} className="animate-spin text-primary" />
          <div className="text-center">
            <p className="text-[15px] font-semibold text-text-1">
              {traveling.home ? `Coming home to ${traveling.name}` : `Loading ${traveling.name} from scratch`}
            </p>
            <p className="mt-1 max-w-[360px] text-[12.5px] leading-5 text-text-3">
              {traveling.home
                ? 'Your whole workspace comes back exactly as you left it.'
                : 'A fresh workspace — the basic apps, and you as its only user. Install more in Settings → Access control.'}
            </p>
          </div>
          <SiteFooter className="mt-auto" />
        </div>
      )}
    </motion.section>
  )
}

/* ---------- admin dialogs ---------- */

function TenantFormDialog({ tenant, onClose, onDone }: { tenant?: Tenant; onClose: () => void; onDone: () => Promise<void> }) {
  const editing = !!tenant
  const [name, setName] = useState(tenant?.name ?? '')
  const [type, setType] = useState<TenantType>(tenant?.type ?? 'franchise')
  const [city, setCity] = useState(tenant?.city ?? '')
  const [state, setState] = useState(tenant?.state ?? '')
  const [since, setSince] = useState(tenant?.since ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) return setError('Name is required.')
    setError(null)
    setBusy(true)
    try {
      await gasAction<{ id: string }>('tenantUpsert', {
        ...(tenant ? { id: tenant.id } : null),
        name: name.trim(),
        type,
        city: city.trim(),
        state: state.trim(),
        since: since.trim(),
        ...(tenant ? null : { status: 'active' as const }),
      })
      toast({
        type: 'success',
        title: editing ? 'Location updated' : 'Location added',
        body: `${name.trim()} — ${tenantTypeLabel(type)}.`,
      })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save the location.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not save location', body: msg })
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            {editing ? 'Edit location' : 'Add location'}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-text-3">
            {editing ? `Update ${tenant?.name} in the tenant directory.` : 'A new HQ, branch or franchise in the tenant directory.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-text-2">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ASA Care Partners Toledo" className={INPUT_CLS} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-text-2">Type</span>
            <Select value={type} onValueChange={(v) => setType(v as TenantType)}>
              <SelectTrigger className="h-9 w-full rounded-sm border-border bg-surface text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['hq', 'branch', 'franchise'] as TenantType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {tenantTypeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-text-2">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Toledo" className={INPUT_CLS} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-text-2">State</span>
              <input value={state} onChange={(e) => setState(e.target.value)} placeholder="OH" className={INPUT_CLS} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-text-2">Since</span>
            <input value={since} onChange={(e) => setSince(e.target.value)} placeholder="2024" className={INPUT_CLS} />
          </label>
          {error && (
            <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
          )}
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className={GHOST_BTN}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
            {busy && <Loader2 size={13} className="animate-spin" />} {editing ? 'Save changes' : 'Add location'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveTenantDialog({ tenant, onClose, onDone }: { tenant: Tenant; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await gasAction('tenantUpsert', { id: tenant.id, status: 'archived' })
      toast({ type: 'success', title: 'Location archived', body: `${tenant.name} was removed from the directory.` })
      onClose()
      await onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not archive the location.'
      setError(msg)
      toast({ type: 'danger', title: 'Could not archive', body: msg })
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Archive {tenant.name}?</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-text-3">
            It disappears from the directory and the tenant switcher. Its data stays on the backend — an admin can restore it there.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="rounded-md bg-tint-danger px-3 py-2 text-[12px] font-medium leading-5 text-tint-fg-danger">{error}</p>
        )}
        <DialogFooter>
          <button type="button" onClick={onClose} className={GHOST_BTN}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy} className={PRIMARY_BTN}>
            {busy && <Loader2 size={13} className="animate-spin" />} Archive
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
