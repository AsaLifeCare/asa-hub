// App Hub (route /apps) — the registry made visible (apps.md).
// Browse / enable / inspect apps, grouped by category, plus the live-schema App Builder.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, Check, FileSpreadsheet, FlaskConical, FolderPlus, MoreVertical, Pencil, Pin, Plus } from 'lucide-react'
import Card from '@/components/shared/Card'
import { appIsNew } from '@/lib/appNew'
import EmptyState from '@/components/shared/EmptyState'
import FilterChips, { type ActiveFilter } from '@/components/shared/FilterChips'
import SchemaPreview from '@/components/shared/SchemaPreview'
import SearchInput from '@/components/shared/SearchInput'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import TintTile from '@/components/shared/TintTile'
import { Badge, Dot } from '@/components/shared/Badge'
import AppBuilderModal, { typeIcon } from '@/components/pages/AppBuilderModal'
import ManageCategoriesModal from '@/components/pages/ManageCategoriesModal'
import ImportSheetModal from '@/features/studio/ImportSheetModal'
import EditAppModal from '@/features/studio/EditAppModal'
import { appManifests } from '@/registry/apps'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useCan } from '@/auth/permissions'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { ensurePlaygroundAppsRegistered } from '@/stores/usePlaygroundStore'
import { visibleManifests } from '@/lib/audience'
import { selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { useAppsCutForMaster } from '@/lib/appsCut'
import { useEffectiveIsMaster, useEffectiveRole } from '@/lib/effectiveUser'
import { toast } from '@/stores/useToastStore'
import { staggerContainer, staggerItem } from '@/engine/motion'
import { AppIcon } from '@/lib/icons'
import { effectiveCategoryId, mergedCategoryDefs } from '@/lib/categories'
import { cn } from '@/lib/utils'
import type { AppManifest } from '@/engine/types'

const TAGLINES: Record<string, string> = {
  overview: 'A calm dashboard of everything happening today.',
  people: 'The long-list sheet for everyone in your org.',
  hiring: 'Map every hiring process as a flowing, downward pipeline.',
  knowledge: 'Documents, policies and guides — beautifully readable.',
  academy: 'Video lessons with progress that remembers you.',
  schedule: "Your team's week, in soft pastel blocks.",
  expenses: 'File and approve expenses in minutes. (Beta)',
  inventory: 'Track equipment and swag across offices.',
}

// Pristine code-manifest taglines: an App Studio override must show through, so the marketing copy above only…
const PRISTINE_TAGLINES = new Map(appManifests.map((m) => [m.id, m.tagline]))
const displayTagline = (a: AppManifest) =>
  TAGLINES[a.id] && a.tagline === PRISTINE_TAGLINES.get(a.id) ? TAGLINES[a.id] : a.tagline

export default function AppsPage() {
  const allApps = useRegistryStore((s) => s.apps)
  const toggleEnabled = useRegistryStore((s) => s.toggleEnabled)
  // audience filter by role: onboarding trainees only see their allow-listed apps here too; caregivers don't see…
  const role = useEffectiveRole()
  const badgeVersion = useBadgeRulesVersion()
  // THE CATALOG MUST SHOW PUT-AWAY APPS — they are the very thing the Available tab installs — they were not…
  const apps = useMemo(
    () => {
      const pretend = allApps.map((a) =>
        (a.enabled && !a.unlisted ? a : { ...a, enabled: true, unlisted: false }))
      const ids = new Set(
        visibleManifests(pretend, { role }, selectAccessChecker(pretend, role)).map((a) => a.id),
      )
      return allApps.filter((a) => ids.has(a.id))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- badgeVersion re-runs this when the badge matrix changes
    [allApps, role, badgeVersion],
  )
  const navigate = useNavigate()

  const [tab, setTab] = useState('all')
  const [catFilters, setCatFilters] = useState<ActiveFilter[]>([])
  const [q, setQ] = useState('')
  const [pinned, setPinned] = useState<string[]>([])
  const [aboutApp, setAboutApp] = useState<AppManifest | null>(null)
  const [howOpen, setHowOpen] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [manageCatOpen, setManageCatOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editApp, setEditApp] = useState<AppManifest | null>(null)
  // THE SECTIONS ARE THE MASTER'S.
  const isMaster = useEffectiveIsMaster()
  const shelfStatus = useCategoryStore((s) => s.status)
  const canManageCategories = useCan('apps.manage') && isMaster && shelfStatus === 'ready'

  // playground: re-register persisted playground-published apps into the live registry store (it isn't persisted)…
  useEffect(() => { ensurePlaygroundAppsRegistered() }, [])

  const installed = apps.filter((a) => a.enabled).length
  const available = apps.length - installed

  // user-created categories + assignment overrides: the hub groups apps by their EFFECTIVE category (same…
  const customCategories = useCategoryStore((s) => s.customCategories)
  const labelOverrides = useCategoryStore((s) => s.labelOverrides)
  const categoryOrder = useCategoryStore((s) => s.categoryOrder)
  const appCategory = useCategoryStore((s) => s.appCategory)
  const appOrder = useCategoryStore((s) => s.appOrder)
  const catDefs = useMemo(() => mergedCategoryDefs(customCategories, labelOverrides, categoryOrder), [customCategories, labelOverrides, categoryOrder])
  const effLabel = useMemo(() => {
    const labelById = new Map(catDefs.map((d) => [d.id, d.label]))
    return (a: AppManifest) => labelById.get(effectiveCategoryId(a, appCategory, catDefs)) ?? a.category
  }, [catDefs, appCategory])

  // admin drag-reorder (Manage categories modal): rank per app within its effective category — unlisted apps sort…
  const orderRank = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of apps) {
      const stored = appOrder[effectiveCategoryId(a, appCategory, catDefs)]
      const idx = stored ? stored.indexOf(a.id) : -1
      map.set(a.id, idx === -1 ? Number.MAX_SAFE_INTEGER : idx)
    }
    return map
  }, [apps, appCategory, catDefs, appOrder])

  // categories present across apps — default defs in canonical order first, custom defs after, unknown manifest…
  const categories = useMemo(() => {
    const present = new Set(apps.map(effLabel))
    const ordered = catDefs.filter((d) => present.has(d.label)).map((d) => d.label)
    const knownIds = new Set(catDefs.map((d) => d.id))
    for (const a of apps) {
      const cid = effectiveCategoryId(a, appCategory, catDefs)
      if (!knownIds.has(cid) && !ordered.includes(a.category)) ordered.push(a.category)
    }
    return ordered
  }, [apps, appCategory, catDefs, effLabel])

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    const cats = catFilters.map((f) => f.value)
    return apps
      .filter((a) => (tab === 'installed' ? a.enabled : tab === 'available' ? !a.enabled : true))
      .filter((a) => (cats.length ? cats.includes(effLabel(a)) : true))
      .filter((a) =>
        query
          ? `${a.name} ${a.tagline} ${effLabel(a)} ${a.pages.map((p) => p.type).join(' ')}`.toLowerCase().includes(query)
          : true,
      )
      .sort((a, b) => {
        const pa = pinned.indexOf(a.id)
        const pb = pinned.indexOf(b.id)
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
        return (orderRank.get(a.id) ?? 0) - (orderRank.get(b.id) ?? 0)
      })
  }, [apps, tab, catFilters, q, pinned, effLabel, orderRank])

  const togglePin = (id: string) =>
    setPinned((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const addCustomApp = (manifest: AppManifest) => {
    useRegistryStore.setState((s) => ({ apps: [...s.apps, manifest] }))
    toast({
      type: 'success',
      title: `'${manifest.name}' added to your workspace`,
      body: 'It is in your sidebar with a NEW pill. Publish it from the studio to give it a table of its own.',
      action: { label: 'Open app', href: `/app/${manifest.id}/${manifest.pages[0]?.id ?? ''}` },
    })
  }

  return (
    <div className="w-full">
      {/* ---------- hero band ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32 }}
        className="relative mb-6 overflow-hidden rounded-xl border border-border p-6 shadow-1 sm:p-8"
        style={{
          background:
            'radial-gradient(120% 150% at 6% 0%, var(--tint-mint) 0%, transparent 55%), radial-gradient(110% 140% at 96% 12%, var(--tint-blue) 0%, transparent 55%), var(--surface)',
        }}
      >
        <div className="flex items-center gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-strong">App Hub</p>
            <h1 className="mt-2 font-display text-[28px] font-extrabold leading-9 tracking-[-0.015em] text-text-1">
              Your workspace, one app at a time.
            </h1>
            <p className="mt-2 max-w-[460px] text-[13px] leading-5 text-text-2">
              Apps are modular bundles of pages built from reusable templates. Enable what you need — new ones
              arrive over time, no redeploy required.
            </p>
            <div className="mt-5 flex divide-x divide-border">
              {[
                { n: installed, label: 'installed' },
                { n: available, label: 'available' },
                { n: 7, label: 'page templates' },
              ].map((s, i) => (
                <div key={s.label} className={cn('flex items-baseline gap-1.5', i === 0 ? 'pr-5' : 'px-5')}>
                  <span className="font-display text-[22px] font-bold tabular-nums text-text-1">{s.n}</span>
                  <span className="text-[12px] text-text-3">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          <motion.img
            src="/assets/app-hero.svg"
            alt=""
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0, y: [0, -4, 0] }}
            transition={{
              opacity: { duration: 0.3, delay: 0.3 },
              x: { duration: 0.3, delay: 0.3 },
              y: { duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.6 },
            }}
            className="hidden h-[200px] w-[320px] shrink-0 md:block"
          />
        </div>
      </motion.div>

      {/* ---------- toolbar (sticky) ---------- */}
      <div className="sticky top-0 z-10 -mx-2 mb-5 flex flex-wrap items-center gap-2 bg-bg/85 px-2 py-3 backdrop-blur">
        <SegmentedTabs
          tabs={[
            { id: 'all', label: `All apps · ${apps.length}` },
            { id: 'installed', label: `Installed · ${installed}` },
            { id: 'available', label: `Available · ${available}` },
          ]}
          value={tab}
          onChange={setTab}
        />
        <FilterChips
          filters={[{ key: 'category', label: 'Category', options: categories }]}
          active={catFilters}
          onAdd={(f) => setCatFilters([f])}
          onRemove={(key) => setCatFilters((cur) => cur.filter((c) => c.key !== key))}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Search apps…" className="w-[200px]" />
        <div className="ml-auto flex items-center gap-1">
          {canManageCategories && (
            <button
              onClick={() => setImportOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <FileSpreadsheet size={14} /> Import Sheet
            </button>
          )}
          {/* THE DOOR MUST OBEY THE SAME LAW AS THE ROOM — pressing "open
              playground" answered with "no access to this module".
              Being master says you MAY manage apps; it does not say
              the Playground is installed HERE — a franchise starts from
              scratch and does not have it. The button now asks the same
              checker the sidebar and the route guard ask. */}
          {canManageCategories && apps.some((a) => a.id === 'playground') && (
            <button
              onClick={() => navigate('/app/playground/studio')}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <FlaskConical size={14} /> Open Playground
            </button>
          )}
          {canManageCategories && (
            <button
              onClick={() => setManageCatOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <FolderPlus size={14} /> Categories
            </button>
          )}
          <button
            onClick={() => setHowOpen(true)}
            className="h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            How apps work
          </button>
        </div>
      </div>

      {/* ---------- category sections ---------- */}
      {visible.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title="No apps match your search"
            body="Try 'pipeline' — or clear the filters to see everything in the registry."
            action={{ label: 'Clear search', onClick: () => { setQ(''); setCatFilters([]) } }}
          />
        </Card>
      ) : (
        categories.map((cat) => {
          const catApps = visible.filter((a) => effLabel(a) === cat)
          if (catApps.length === 0) return null
          return (
            <section key={cat} className="mb-7">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                {cat} <span className="ml-1 font-medium normal-case tracking-normal">· {catApps.length}</span>
              </h2>
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                {catApps.map((app, i) => (
                  <motion.div key={app.id} variants={i < 8 ? staggerItem : undefined} layout="position">
                    <AppCard
                      app={app}
                      categoryLabel={effLabel(app)}
                      pinned={pinned.includes(app.id)}
                      onTogglePin={() => togglePin(app.id)}
                      onViewSchema={() => setAboutApp(app)}
                      onToggle={() => toggleEnabled(app.id)}
                      onOpen={() => app.pages[0] && navigate(`/app/${app.id}/${app.pages[0].id}`)}
                      onEdit={canManageCategories ? () => setEditApp(app) : undefined}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </section>
          )
        })
      )}

      {/* ---------- build your own app ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15%' }}
        transition={{ duration: 0.32 }}
        className="flex flex-col items-center rounded-lg border-2 border-dashed border-border-strong px-6 py-10 text-center"
      >
        <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-dashed border-border-strong text-text-3">
          <Plus size={20} />
        </div>
        <h2 className="mt-4 font-display text-[17px] font-bold text-text-1">Build an app from a schema</h2>
        <p className="mt-1 max-w-[360px] text-[13px] leading-5 text-text-2">
          One JSON manifest. Pick your page types. Ship it.
        </p>
        <button
          onClick={() => setBuilderOpen(true)}
          className="mt-5 h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98]"
        >
          Start from a template
        </button>
      </motion.div>

      <AppBuilderModal open={builderOpen} onOpenChange={setBuilderOpen} onFinish={addCustomApp} />
      <ManageCategoriesModal open={manageCatOpen} onOpenChange={setManageCatOpen} />
      <ImportSheetModal open={importOpen} onOpenChange={setImportOpen} />
      <EditAppModal app={editApp} onClose={() => setEditApp(null)} />
      <AboutDrawer app={aboutApp} howOpen={howOpen} onClose={() => { setAboutApp(null); setHowOpen(false) }} />
    </div>
  )
}

/* ================= app card ================= */

function AppCard({
  app,
  categoryLabel,
  pinned,
  onTogglePin,
  onViewSchema,
  onToggle,
  onOpen,
  onEdit,
}: {
  app: AppManifest
  /** effective category (user assignment override applied) */
  categoryLabel: string
  pinned: boolean
  onTogglePin: () => void
  onViewSchema: () => void
  onToggle: () => void
  onOpen: () => void
  /** admin only — opens the App Studio edit modal */
  onEdit?: () => void
}) {
  // hidden pages route (candidate profile) but are not doors — the card counts and types only what the detail sheet…
  const shownPages = app.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden)
  const types = [...new Set(shownPages.map((p) => p.type))]
  // the master's own list (lib/appsCut); empty for every other session
  const keptToMaster = useAppsCutForMaster().includes(app.id)
  return (
    <Card hover className="group flex h-full flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="transition-transform duration-150 group-hover:-rotate-3">
          <TintTile icon={app.icon} tint={app.accent} size="lg" />
        </div>
        <div className="flex items-center gap-1.5">
          {pinned && <Pin size={13} className="text-primary" />}
          <Switch checked={app.enabled} onCheckedChange={onToggle} aria-label={`Enable ${app.name}`} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="App actions"
                className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <MoreVertical size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={onViewSchema}>
                <AppIcon name="braces" size={14} className="mr-2 text-text-3" /> View schema
              </DropdownMenuItem>
              {onEdit && (
                <DropdownMenuItem onClick={onEdit} aria-label="Edit app" title="Edit app">
                  <Pencil size={14} className="text-text-3" />
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onToggle}>
                <AppIcon name={app.enabled ? 'power-off' : 'power'} size={14} className="mr-2 text-text-3" />
                {app.enabled ? 'Disable' : 'Enable'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onTogglePin}>
                <Pin size={14} className="mr-2 text-text-3" /> {pinned ? 'Unpin' : 'Pin to top'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-bold leading-6 text-text-1">{app.name}</h3>
          {appIsNew(app.id) && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.2 }}
              className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-strong"
            >
              <Dot className="animate-pulse" /> New
            </motion.span>
          )}
          <span className="font-mono text-[11px] text-text-3">v{app.version}</span>
          {keptToMaster && (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-3" data-app-kept>
              Hidden from everyone else
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-text-2">
          {displayTagline(app)}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-2"
          >
            <AppIcon name={typeIcon(t)} size={11} className="text-text-3" />
            {t}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <span className="text-[12px] text-text-3">
          {categoryLabel} · {shownPages.length} {shownPages.length === 1 ? 'page' : 'pages'}
        </span>
        {app.enabled ? (
          <button
            onClick={onOpen}
            className="group/link flex items-center gap-1 text-[13px] font-semibold text-primary-strong transition-colors hover:text-primary"
          >
            Open
            <ArrowRight size={14} className="transition-transform duration-150 group-hover/link:translate-x-[3px]" />
          </button>
        ) : (
          <button
            onClick={onToggle}
            className="h-8 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Install
          </button>
        )}
      </div>
    </Card>
  )
}

/* ================= about-this-app drawer ================= */

function AboutDrawer({
  app,
  howOpen,
  onClose,
}: {
  app: AppManifest | null
  howOpen: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState('overview')
  const navigate = useNavigate()
  const open = app !== null || howOpen
  const sample = useRegistryStore((s) => s.apps)[0]

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface p-6 sm:max-w-[384px]">
        {app ? (
          <>
            <SheetHeader className="mb-4">
              <div className="flex items-center gap-3">
                <TintTile icon={app.icon} tint={app.accent} size="lg" />
                <div>
                  <SheetTitle className="font-display text-[17px] font-bold text-text-1">{app.name}</SheetTitle>
                  {/* The date and the author here were literal ("Added Feb 3,
                      2025 · by Platform team") on every app in the library,
                      invented and identical — a fact the platform does not
                      have, printed as though it did. What it DOES know is the
                      version, the shelf it sits on and where it came from. */}
                  <SheetDescription className="text-[12px] text-text-3">
                    v{app.version} · {app.category} · {app.source === 'sheet' ? 'Built in the studio' : 'Built into the platform'}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <SegmentedTabs
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'schema', label: 'Schema' },
              ]}
              value={tab}
              onChange={setTab}
              className="mb-4"
            />
            {tab === 'overview' ? (
              <div className="space-y-5">
                <p className="text-[13px] leading-5 text-text-2">{displayTagline(app)}</p>
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Pages</h4>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {/* hidden pages route (candidate profile), they are not doors to list */}
                    {app.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden).map((p) => (
                      <div key={p.id} className="flex items-center gap-2.5 px-3 py-2.5">
                        <AppIcon name={p.icon ?? typeIcon(p.type)} size={15} className="shrink-0 text-text-3" />
                        <span className="flex-1 text-[13px] font-medium text-text-1">{p.title}</span>
                        <Badge label={p.type} tint={app.accent} />
                        {app.enabled && (
                          <button
                            onClick={() => { onClose(); navigate(`/app/${app.id}/${p.id}`) }}
                            className="flex items-center gap-0.5 text-[12px] font-semibold text-primary-strong hover:text-primary"
                          >
                            Open <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {app.notifications && app.notifications.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                      Emits notifications
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {app.notifications.map((n) => (
                        <Badge key={n} label={n} tint={app.accent} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div className="rounded-md bg-surface-2 px-3 py-2">
                    <div className="text-[11px] text-text-3">Category</div>
                    <div className="font-medium text-text-1">{app.category}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 px-3 py-2">
                    <div className="text-[11px] text-text-3">Accent</div>
                    <div className="font-medium capitalize text-text-1">{app.accent}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <SchemaPreview schema={app} />
                {/* The studio is REAL and publishes for real (appBuilderUpsert
                    → the app_builder tab → every browser). This button used to
                    toast that it was a demo, which stopped being true long
                    before today. It opens the studio for the apps the studio
                    owns; an app built into the platform is edited in its
                    registry file, and says so instead of offering a door that
                    leads nowhere. */}
                {app.source === 'sheet' || app.id.startsWith('custom-') ? (
                  <button
                    onClick={() => navigate('/app/playground/studio')}
                    className="mt-3 h-9 rounded-md px-3 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                  >
                    Edit in the studio
                  </button>
                ) : (
                  <p className="mt-3 text-[12px] leading-5 text-text-3">
                    Built into the platform — this schema lives in the registry and changes with a release.
                    The studio designs new apps of your own.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <SheetHeader className="mb-4">
              <SheetTitle className="font-display text-[17px] font-bold text-text-1">How apps work</SheetTitle>
              <SheetDescription className="text-[13px] leading-5 text-text-2">
                An app is a single typed manifest — name, icon, accent and a list of page schemas. The shell renders
                the sidebar, routes, command palette and this App Hub from that one list. Adding an app later means
                appending one object, exactly like this:
              </SheetDescription>
            </SheetHeader>
            {sample && <SchemaPreview schema={sample} />}
            <button
              onClick={onClose}
              className="mt-4 flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              <Check size={14} /> Got it
            </button>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
