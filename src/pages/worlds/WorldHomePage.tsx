// WORLD HOME — the front door of the user's own world (USER WORLDS, every user has two worlds: asalifecare's and…
// Rendered by the static /app/world-home/home route in App.tsx (declared inside the world exemption, so it beats…
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, Building2, Check, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react'
import Card from '@/components/shared/Card'
import SiteFooter from '@/components/shared/SiteFooter'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/auth/useAuthStore'
import { useStanding } from '@/lib/standing'
import { crossHome } from '@/lib/crossPlace'
import { loadWorldApps, useRegistryStore } from '@/stores/useRegistryStore'
import { useWorldStore } from '@/stores/useWorldStore'
import { toast } from '@/stores/useToastStore'
import { gasAction } from '@/features/hiring/shared'
import { EASE_OUT_EXPO } from '@/engine/motion'
import MyWorldIntro from './MyWorldIntro'

/** The world's own two doors — everything else on the shelf is the owner's. */
const WORLD_CHROME_IDS = new Set(['world-home', 'playground'])

export default function WorldHomePage() {
  const user = useAuthStore((s) => s.user)
  const worldName = useWorldStore((s) => s.worldName)
  const apps = useRegistryStore((s) => s.apps)
  const worldDefaults = useRegistryStore((s) => s.worldDefaults)
  const navigate = useNavigate()
  const [installing, setInstalling] = useState<string | null>(null)

  // The gallery's Install button: the server seeds the one app (explicit owner intent — the automatic seed's…
  const [seeding, setSeeding] = useState(false)

  // Runs the same seed a sign-in runs, on demand.
  const refreshApps = async () => {
    setSeeding(true)
    try {
      const r = await gasAction<{ seeded?: string[]; upgraded?: string[]; skipped?: string[] }>(
        'worldAppsSeedDefaults', {},
      )
      const added = r?.seeded?.length ?? 0
      const moved = r?.upgraded?.length ?? 0
      const left = r?.skipped?.length ?? 0
      await loadWorldApps(true)
      toast({
        type: added || moved ? 'success' : 'info',
        title: added || moved ? 'Apps updated' : 'Already up to date',
        body: added || moved
          ? `${added} added, ${moved} brought up to the current version` +
            (left ? `, ${left} left alone — yours, or deleted on purpose.` : '.')
          : 'This world already has the current set of catalogue apps.',
      })
    } catch (err) {
      toast({
        type: 'warning',
        title: 'Could not update the apps',
        body: err instanceof Error ? err.message : 'The server did not answer — try again in a moment.',
      })
    } finally {
      setSeeding(false)
    }
  }

  const install = async (id: string) => {
    setInstalling(id)
    try {
      await gasAction('worldAppInstallDefault', { app_id: id })
      await loadWorldApps(true)
      toast({ type: 'success', title: 'Added to your world.' })
    } catch (err) {
      toast({ type: 'warning', title: 'Could not add the app', body: err instanceof Error ? err.message : undefined })
    } finally {
      setInstalling(null)
    }
  }

  // WHOSE WORLD IS OPEN — opening somebody else's world was drawing the reader's own.
  const standing = useStanding()
  const firstName = standing.mine
    ? ((user?.name ?? '').trim().split(/\s+/)[0] || 'you')
    : (standing.ownerFirst || 'they')
  const title = worldName.trim() || `${firstName}'s world`
  const myApps = useMemo(
    () => apps.filter((a) => !WORLD_CHROME_IDS.has(a.id) && a.enabled),
    [apps],
  )

  return (
    // A WORLD USES THE WINDOW, like every other screen (check-page-width).
    <div className="w-full">
      {/* hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
        className="relative overflow-hidden rounded-lg border border-border bg-tint-lavender p-7 shadow-1 sm:p-9"
      >
        <span className="absolute -right-8 -top-8 grid h-36 w-36 place-items-center rounded-full bg-white/20">
          <Sparkles size={44} className="text-tint-fg-lavender/60" />
        </span>
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-tint-fg-lavender/80">
          {standing.mine ? 'Your world' : `${standing.ownerFirst}'s world — you are visiting`}
        </p>
        <h1 className="mt-1 font-display text-[26px] font-bold leading-8 tracking-[-0.015em] text-tint-fg-lavender">
          {standing.mine ? `Your world, ${title}` : title}
        </h1>
        <p className="mt-3 max-w-[520px] text-[13.5px] leading-6 text-tint-fg-lavender/90">
          {standing.mine ? (
            <>
              This is the same platform wearing your name: a private workspace with
              its own data behind it, kept entirely apart from ASA LifeCare's
              data. Build apps here for anything that is yours alone — lists,
              trackers, little tools — and cross back to the company world any time
              from the tiles at the bottom of the sidebar.
            </>
          ) : (
            <>
              You are standing in {standing.owner}&rsquo;s own world, opened because
              they left that door open to you — their data, their apps, and only
              what they may see. Nothing you do here is written in your name, and
              your own world is untouched: leave from the chip above, or from the
              tiles at the bottom of the sidebar.
            </>
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate('/app/playground/studio')}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            <Plus size={15} /> Create an app
          </button>
          {/**
            * THE CATALOGUE, ON DEMAND — a world seeded before the catalogue
            * moved sits on an older set of apps.
            *
            * It lives HERE and not in "Platforms you are on", the first place
            * proposed for it: that section is fed by platformMemberMine,
            * which is caller-own, so inside a visit it answers for the VISITOR
            * and would have shown the wrong person's platforms. Here it serves
            * both readers with one control — the owner in their own world, and
            * a visitor standing in theirs.
            *
            * worldAppsSeedDefaults matches on owner_user_id === user.id and is
            * NOT caller-own, so during a visit it upgrades the world you are
            * STANDING IN. That is "a visit writes in that environment" doing
            * exactly what it says, with no new law.
            *
            * The seed never resurrects: an app the owner deleted stays gone,
            * an app they authored is untouched, and only the catalogue's own
            * rows are swapped. Their data tabs are merge-only by construction.
            */}
          <button
            onClick={() => void refreshApps()}
            disabled={seeding}
            title="Bring this world's catalogue apps up to the current set"
            className="flex h-9 items-center gap-1.5 rounded-md bg-white/40 px-4 text-[13px] font-semibold text-tint-fg-lavender transition-colors duration-150 hover:bg-white/60 active:scale-[0.98] disabled:opacity-50"
          >
            {seeding ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Update apps
          </button>
          {/* THE PAGE'S OWN WAY OUT, and it left the visit standing:
              pressed from inside somebody else's world it raised
              a curtain saying "Coming back to ASA LifeCare" and rebooted with
              the person still open. It offers this button INSIDE the visiting
              branch, so it has to be the crossing that leaves everything. */}
          <button
            onClick={() => crossHome()}
            className="flex h-9 items-center gap-1.5 rounded-md bg-white/40 px-4 text-[13px] font-semibold text-tint-fg-lavender transition-colors duration-150 hover:bg-white/60 active:scale-[0.98]"
          >
            <Building2 size={14} /> Back to ASA LifeCare
          </button>
        </div>
      </motion.div>

      {/* the apps of this world */}
      <div className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">Your apps</h2>
            <p className="mt-0.5 text-[13px] text-text-2">
              Everything published from your World Studio lives here — and only here.
            </p>
          </div>
          {myApps.length > 0 && (
            <Link
              to="/app/playground/studio"
              className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
            >
              Open the studio <ArrowRight size={13} />
            </Link>
          )}
        </div>

        {myApps.length === 0 ? (
          <Card className="border-dashed">
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-tint-mint text-tint-fg-mint">
                <AppIcon name="flask-conical" size={20} />
              </span>
              <h3 className="mt-3 font-display text-[15px] font-semibold text-text-1">
                Nothing lives here yet
              </h3>
              <p className="mt-1 max-w-[380px] text-[13px] leading-5 text-text-2">
                Your first app is a few minutes away: pick a template in the
                studio, feed it a few rows, publish — it lands right on this
                page and in your sidebar.
              </p>
              <button
                onClick={() => navigate('/app/playground/studio')}
                className="mt-4 flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.98]"
              >
                <Plus size={15} /> Create your first app
              </button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {myApps.map((app, i) => {
              const first = app.pages[0]
              return (
                <motion.div
                  key={app.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.22, ease: EASE_OUT_EXPO }}
                >
                  <Card hover padded={false} className="h-full">
                    <Link
                      to={`/app/${app.id}/${first?.id ?? ''}`}
                      className="flex h-full items-start gap-3 p-4"
                    >
                      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-md', TINT_BG[app.accent] ?? 'bg-tint-lavender', TINT_FG[app.accent] ?? 'text-tint-fg-lavender')}>
                        <AppIcon name={app.icon} size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="clamp-1 block text-[14px] font-semibold text-text-1">{app.name}</span>
                        <span className="clamp-2 mt-0.5 block text-[12.5px] leading-4 text-text-2">{app.tagline}</span>
                        <span className="mt-1.5 block text-[11px] text-text-3">
                          {app.pages.length} page{app.pages.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    </Link>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* THE GALLERY — an uninstalled app stays in My world's gallery; it
          must never simply vanish.
          Every default app is always here — installed ones wear the check,
          uninstalled ones wait with an Add button. Uninstalling removes the
          app from your shelf, never from this gallery. */}
      {worldDefaults.length > 0 && (
        <div className="mt-8">
          <div className="mb-3">
            <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">App gallery</h2>
            <p className="mt-0.5 text-[13px] text-text-2">
              The platform's personal suite — install any of them, and they never leave this list.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {worldDefaults.map((d) => (
              <Card key={d.id} padded={false} className="h-full">
                <div className="flex h-full items-start gap-3 p-4">
                  <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-md', TINT_BG[d.accent] ?? 'bg-tint-lavender', TINT_FG[d.accent] ?? 'text-tint-fg-lavender')}>
                    <AppIcon name={d.icon} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[14px] font-semibold text-text-1">{d.name}</span>
                    <span className="clamp-2 mt-0.5 block text-[12.5px] leading-4 text-text-2">{d.tagline}</span>
                    <span className="mt-2 block">
                      {d.installed ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-tint-fg-mint">
                          <Check size={12} /> In your world
                        </span>
                      ) : (
                        <button
                          onClick={() => void install(d.id)}
                          disabled={installing !== null}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                        >
                          {installing === d.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                          Add
                        </button>
                      )}
                    </span>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* the world's own first visit: four things, shown once, owner only */}
      <MyWorldIntro />
    </div>
  )
}

// THE BIG LOADING for a world switch — the traveler overlay, worn by worlds.
export function WorldSwitchOverlay() {
  const switching = useWorldStore((s) => s.switching)
  const worldName = useWorldStore((s) => s.worldName)
  const user = useAuthStore((s) => s.user)
  const standing = useStanding()
  if (!switching) return null
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0]
  const toWorld = switching.to === 'world'
  const name = worldName.trim() || (firstName ? `${firstName}'s world` : 'your world')
  // the two auto margins centre the message in the room above the footer
  return (
    <div className="fixed inset-0 z-[120] flex flex-col items-center gap-4 bg-surface">
      <span className="mt-auto font-display text-[22px] font-bold tracking-tight text-text-1">
        asa<span className="text-primary">.</span>
      </span>
      <Loader2 size={30} className="animate-spin text-primary" />
      <div className="text-center">
        <p className="text-[15px] font-semibold text-text-1">
          {toWorld ? `Crossing into ${name}` : 'Coming back to ASA LifeCare'}
        </p>
        <p className="mt-1 max-w-[360px] text-[12.5px] leading-5 text-text-3">
          {toWorld
            ? (standing.mine
                ? 'Same platform, your own data — the workspace reboots with only what is yours.'
                : `Same platform, ${standing.owner}'s own data — the workspace reboots with only what is theirs.`)
            : 'The company workspace comes back exactly as you left it.'}
        </p>
      </div>
      <SiteFooter className="mt-auto" />
    </div>
  )
}
