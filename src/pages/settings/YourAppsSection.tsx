// SETTINGS -> YOUR APPS — the configuration screen for everybody who is not the platform's owner.
// WHY THIS EXISTS, and the wall it came from.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ChevronDown, Check, Minus } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import DragPerson from '@/components/shared/DragPerson'
import RoleBadge from '@/components/shared/RoleBadge'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { visibleManifests } from '@/lib/audience'
import { selectAccessChecker, useBadgeRulesVersion } from '@/lib/appAccess'
import { groupedApps, mergedCategoryDefs } from '@/lib/categories'
import { useCategoryStore } from '@/stores/useCategoryStore'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { useEffectiveUser } from '@/lib/effectiveUser'
import { SETTINGS_NAV, SECTION_APP, MASTER_ONLY_SECTIONS, type SettingsNavEntry } from '@/lib/settingsNav'
import { APP_FEATURES, featureAllowsWith, featureIsGated } from '@/lib/featureAccess'
import { useBadgeAccessStore } from '@/lib/badgeAccess'
import { ROLE_WORDS, reachForSection } from '@/lib/badgeReach'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import type { AppManifest } from '@/engine/types'

// The sections that are a PERSON's rather than the platform's.
const PERSONAL_SECTIONS = ['appearance', 'notifications', 'worldaccess', 'profile']

/** One app's settings sections, resolved from the pairing the nav is built on. */
type AppSection = { entry: SettingsNavEntry; reachable: boolean }

function sectionsForApp(appId: string, nav: SettingsNavEntry[]): AppSection[] {
  return Object.entries(SECTION_APP)
    .filter(([, id]) => id === appId)
    .map(([sectionId]) => SETTINGS_NAV.find((n) => n.id === sectionId))
    .filter((e): e is SettingsNavEntry => Boolean(e))
    .map((entry) => ({ entry, reachable: nav.some((n) => n.id === entry.id) }))
}

// WHY THIS SECTION IS NOT YOURS, in the person's own terms — and the whole value is in telling three refusals…
function refusalFor(entry: SettingsNavEntry, role: string | undefined): string {
  if (MASTER_ONLY_SECTIONS.includes(entry.id)) {
    return 'The platform’s owner alone — it is not granted by badge, so there is nothing to ask for here.'
  }
  const word = String(role ?? '').toUpperCase()
  const never = reachForSection(ROLE_WORDS, entry.adminOnly === true).dropped.includes(word)
  if (never) {
    return entry.adminOnly
      ? 'Admins only — and a badge rule can only narrow a section, never hand one over, so this one cannot be given to you.'
      : 'Your role does not carry a Settings page, so this section has nowhere to appear.'
  }
  return 'Your badge is not named on it. The platform’s owner can add it in Access control.'
}

export default function YourAppsSection({
  nav,
  onJump,
}: {
  // The sections THIS person has — computed once by the page, shared here so the two can never disagree about what…
  nav: SettingsNavEntry[]
  // The page's own measured scroll (SettingsPage `jump`), not `scrollIntoView`: this scroller has an ancestor with…
  onJump: (id: string) => void
}) {
  const navigate = useNavigate()
  const me = useEffectiveUser()
  const allApps = useRegistryStore((s) => s.apps)
  const rules = useBadgeAccessStore((s) => s.rules)
  const badgeVersion = useBadgeRulesVersion()
  const [open, setOpen] = useState<string | null>(null)

  // THE SAME DERIVATION AS THE SIDEBAR, deliberately: an app listed here that the sidebar does not draw (or the…
  const apps = useMemo(
    () =>
      visibleManifests(allApps, { role: me?.role ?? null }, selectAccessChecker(allApps, me?.role ?? null))
        .filter((a) => a.enabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- badgeVersion re-runs this when the badge matrix changes
    [allApps, me?.role, badgeVersion],
  )

  const customCategories = useCategoryStore((s) => s.customCategories)
  const labelOverrides = useCategoryStore((s) => s.labelOverrides)
  const categoryOrder = useCategoryStore((s) => s.categoryOrder)
  const appCategory = useCategoryStore((s) => s.appCategory)
  const appOrder = useCategoryStore((s) => s.appOrder)
  const groups = useMemo(
    () => groupedApps(apps, appCategory, mergedCategoryDefs(customCategories, labelOverrides, categoryOrder), appOrder),
    [apps, appCategory, customCategories, labelOverrides, categoryOrder, appOrder],
  )

  const personal = PERSONAL_SECTIONS.map((id) => nav.find((n) => n.id === id)).filter(
    (n): n is SettingsNavEntry => Boolean(n),
  )

  // the master's access is governed at its own desks — this section only points there
  if (me?.isMaster) {
    const accessSection = nav.find((n) => n.id === 'access')
    return (
      <motion.section
        id="yourapps"
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-10% 0px' }}
        transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
        className="scroll-mt-[84px]"
      >
        <Card padded={false} className="p-6">
          <CardHeader
            title="Your apps"
            sub="This screen answers for the people you grant apps to — your own desks are the matrices."
          />
          <p className="text-[13px] leading-5 text-text-2">
            For everybody else this page lists the apps that reach them and the settings they may touch.
            You already hold every app and every matrix, so there is nothing of yours to list — what a
            client, a manager or a staff member sees here is exactly what their badge reaches.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {accessSection && (
              <button
                onClick={() => onJump(accessSection.id)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                <AppIcon name={accessSection.icon} size={13} className="text-text-3" />
                Open {accessSection.label}
              </button>
            )}
            <button
              onClick={() => navigate('/app/app-control/board')}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <AppIcon name="layout-grid" size={13} className="text-text-3" />
              App Control — place every app
            </button>
            <button
              onClick={() => navigate('/apps')}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <AppIcon name="sparkles" size={13} className="text-text-3" />
              App Hub — add or put away apps
            </button>
          </div>
        </Card>
      </motion.section>
    )
  }

  return (
    <motion.section
      id="yourapps"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]"
    >
      <Card padded={false} className="p-6">
        <CardHeader
          title="Your apps"
          sub="What you have here, what you may do inside it, and where each app's settings live."
          extra={
            me ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {/* the role the SERVER will answer for, never a guessed one:
                    an undefined role draws no chip rather than a plausible
                    wrong word */}
                {me.role && <RoleBadge user={{ role: me.role, isMaster: me.isMaster }} size="xs" />}
                {me.types.map((t) => (
                  <RoleBadge key={t} label={t} size="xs" />
                ))}
              </div>
            ) : undefined
          }
        />

        {/* WHOSE SCREEN THIS IS. Every count and every verdict below belongs to
            the person whose workspace is open, which during a visit is not the
            person reading it — so it says so rather than letting somebody read
            their own reach into somebody else's row. */}
        {me?.visiting && (
          <p className="mb-4 rounded-[12px] border border-tint-lavender bg-tint-lavender/40 px-3 py-2 text-[12.5px] text-text-2">
            You are standing in{' '}
            <DragPerson name={me.name} subtitle={me.role || undefined}>
              <span className="font-semibold text-text-1">{me.name}</span>
            </DragPerson>&rsquo;s workspace, so this
            describes what <span className="font-semibold text-text-1">they</span> reach — not what you do.
          </p>
        )}

        {/* ---- the settings that are the person's own ---- */}
        {personal.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Yours to set</h3>
            <div className="flex flex-wrap gap-1.5">
              {personal.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onJump(n.id)}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-text-1 transition-colors hover:bg-surface-2"
                >
                  <AppIcon name={n.icon} size={13} className="text-text-3" />
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---- the apps ---- */}
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
          Apps that reach you here <span className="ml-1 font-medium normal-case tracking-normal">· {apps.length}</span>
        </h3>

        {apps.length === 0 && (
          <p className="text-[13px] text-text-3">
            No app reaches this account here yet. That is a decision somebody made, not a screen that failed to load —
            the platform&rsquo;s owner grants apps by badge in Access control.
          </p>
        )}

        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.def.id}>
              <p className="mb-1.5 text-[11.5px] font-semibold text-text-2">{g.def.label}</p>
              <div className="overflow-hidden rounded-[12px] border border-border">
                {g.apps.map((app, i) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    first={i === 0}
                    sections={sectionsForApp(app.id, nav)}
                    role={me?.role}
                    open={open === app.id}
                    onToggle={() => setOpen((o) => (o === app.id ? null : app.id))}
                    onJump={onJump}
                    allows={(featureId) => featureAllowsWith(featureId, me, rules)}
                    gated={(featureId) => featureIsGated(featureId, rules)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* WHAT IS NOT HERE, AND WHY — said once, in the place a person looks
            for it. This is the sentence that answers the two afternoons the
            two afternoons spent granting Access control to somebody who
            could never receive it. */}
        <p className="mt-5 border-t border-border pt-4 text-[12px] leading-[18px] text-text-3">
          Anything that governs the whole platform — who may open which app, which settings sections exist, which
          company each person stands in — stays with the platform&rsquo;s owner. Those matrices decide every access on
          the platform, so they cannot be handed out by the rules they themselves hold: a badge named there could name
          itself. Adding or putting away apps is in the{' '}
          {/* NAVIGATE, never an <a href>: a plain link reloads the shell, and a
              reload on this platform costs a whole boot on a backend where one
              round-trip is five seconds. */}
          <button onClick={() => navigate('/apps')} className="font-medium text-primary-strong hover:underline">
            App Hub
          </button>
          .
        </p>
      </Card>
    </motion.section>
  )
}

/* ---------------- one app ---------------- */

function AppRow({
  app,
  first,
  sections,
  role,
  open,
  onToggle,
  onJump,
  allows,
  gated,
}: {
  app: AppManifest
  first: boolean
  sections: AppSection[]
  role: string | undefined
  open: boolean
  onToggle: () => void
  onJump: (id: string) => void
  allows: (featureId: string) => boolean
  gated: (featureId: string) => boolean
}) {
  const navigate = useNavigate()
  const features = APP_FEATURES[app.id] ?? []
  const reachable = sections.filter((s) => s.reachable)
  // What the closed row is allowed to promise.
  const chip =
    reachable.length > 0
      ? 'Settings'
      : sections.length > 0
        ? 'Owner’s'
        : features.length > 0
          ? `${features.length} control${features.length > 1 ? 's' : ''}`
          : ''

  return (
    <div className={cn(!first && 'border-t border-border')}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/60"
      >
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', TINT_BG[app.accent])}>
          <AppIcon name={app.icon} size={15} className={TINT_FG[app.accent]} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="clamp-1 block text-[13.5px] font-semibold text-text-1">{app.name}</span>
          <span className="clamp-1 block text-[12px] text-text-3">{app.tagline}</span>
        </span>
        {chip && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">
            {chip}
          </span>
        )}
        <ChevronDown size={15} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border bg-surface-2/40 px-3 py-3">
          {/* the pages this person actually opens inside it, and the way in.
              A client's shell is thin by design, so for them this section is
              often the only written list of what they have. */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                Pages <span className="ml-1 font-medium normal-case tracking-normal">· v{app.version}</span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-text-2">
                {/* hidden pages route (candidate profile) — not doors to name here */}
                {(() => {
                  const shown = app.pages.filter((p) => !(p.config as { hidden?: boolean } | undefined)?.hidden)
                  return shown.length ? shown.map((p) => p.title).join(' · ') : 'One screen.'
                })()}
              </p>
            </div>
            {app.pages[0] && (
              <button
                onClick={() => navigate(`/app/${app.id}/${app.pages[0].id}`)}
                className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
              >
                Open {app.name}
              </button>
            )}
          </div>

          {/* where its settings live, and — when they are not yours — whether
              that is "not yet" or "never" */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Settings</p>
            {sections.length === 0 ? (
              <p className="mt-0.5 text-[12.5px] text-text-2">
                This app has no settings of its own — it works the same for everybody who opens it.
              </p>
            ) : (
              <div className="mt-1 space-y-1.5">
                {sections.map(({ entry, reachable: ok }) => (
                  <div key={entry.id} className="flex flex-wrap items-center gap-2">
                    {ok ? (
                      <button
                        onClick={() => onJump(entry.id)}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
                      >
                        <AppIcon name={entry.icon} size={13} className="text-text-3" />
                        Open {entry.label}
                      </button>
                    ) : (
                      <p className="text-[12.5px] text-text-2">
                        <span className="font-semibold text-text-1">{entry.label}</span> — {refusalFor(entry, role)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* the controls inside the app that a badge decides */}
          {features.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Inside the app</p>
              <div className="mt-1 space-y-1.5">
                {features.map((f) => {
                  const yes = allows(f.id)
                  return (
                    <div key={f.id} className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full',
                          yes ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-3',
                        )}
                      >
                        {yes ? <Check size={11} strokeWidth={3} /> : <Minus size={11} strokeWidth={3} />}
                      </span>
                      <p className="text-[12.5px] leading-[17px] text-text-2">
                        <span className="font-semibold text-text-1">{f.label}</span> — {f.hint}{' '}
                        {yes ? (
                          <span className="text-tint-fg-mint">Yours.</span>
                        ) : (
                          <span className="text-text-3">
                            {gated(f.id)
                              ? 'Not on your badge — the platform’s owner decides this one in Access control.'
                              : 'Not available to you here.'}
                          </span>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
