// Welcome (route /) — public entry page, outside the app Layout.
// Calm, token-only landing in the platform's soft aesthetic: warm-gray canvas, rounded-20px surface cards…
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { motion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import { ArrowRight, Loader2 } from 'lucide-react'
import AsaLogo from '@/components/shared/AsaLogo'
import SiteFooter from '@/components/shared/SiteFooter'
import { useAuthStore } from '@/auth/useAuthStore'
import { homeRouteFor } from '@/lib/homeRoute'
import { useMatrixLanded } from '@/lib/matrixLanded'
import { appManifests } from '@/registry/apps'
import type { AppManifest } from '@/engine/types'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

/** Recognizable modules showcased from the registry. */
const MODULE_IDS = ['overview', 'people', 'clients', 'schedule', 'hiring', 'academy']

const MODULES = MODULE_IDS.map((id) => appManifests.find((a) => a.id === id)).filter(
  (a): a is AppManifest => !!a,
)

const STATS: { value: string; label: string }[] = [
  { value: `${Math.floor(appManifests.length / 10) * 10}+`, label: 'MODULES' },
  { value: '48', label: 'CAREGIVERS' },
  { value: '12', label: 'CLIENTS' },
  { value: '24/7', label: 'ALWAYS ON' },
]

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.075 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT_EXPO } },
}

/** Small pulsing accent status dot (opacity pulse, calm 2.4s cycle). */
function PulseDot({ className }: { className?: string }) {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary', className)}
    />
  )
}

function Overline({ children, onBand = false }: { children: ReactNode; onBand?: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-2.5 font-mono text-xs tracking-[0.3em]',
        onBand ? 'text-on-band-muted' : 'text-text-3',
      )}
    >
      <PulseDot />
      {children}
    </span>
  )
}

function ModuleCard({ app }: { app: AppManifest }) {
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
      className="flex flex-col rounded-[20px] border border-border bg-surface p-6 shadow-1 transition-colors duration-200 hover:border-primary/40"
    >
      <span className={cn('grid h-11 w-11 place-items-center rounded-[14px]', TINT_BG[app.accent], TINT_FG[app.accent])}>
        <AppIcon name={app.icon} size={20} />
      </span>
      <h3 className="mt-4 font-display text-base font-bold tracking-tight text-text-1">{app.name}</h3>
      <p className="clamp-2 mt-1 text-sm leading-5 text-text-2">{app.tagline}</p>
      <div className="mt-5 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-tint-mint px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-tint-fg-mint">
          <span className="h-1 w-1 rounded-full bg-tint-fg-mint" />
          ONLINE
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-1 font-mono text-[10px] tracking-wider text-text-3">
          {app.category.toUpperCase()}
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-1 font-mono text-[10px] tracking-wider text-text-3">
          v{app.version}
        </span>
      </div>
    </motion.div>
  )
}

export default function WelcomePage() {
  const user = useAuthStore((s) => s.user)
  const landed = useMatrixLanded()
  // a session opening the domain or the installed app enters where a sign-in lands: My Work, chosen once this
  // session's matrix has landed (a kept copy from before My Work had its row read it as shut)
  if (user && !landed) {
    return (
      <div className="grid h-dvh place-items-center bg-bg" aria-busy="true" data-landing-wait="">
        <Loader2 size={22} className="animate-spin text-primary" />
      </div>
    )
  }
  if (user) return <Navigate to={homeRouteFor(user.role)} replace />
  const workspaceHref = '/login'

  return (
    <div className="scroll-thin h-dvh overflow-y-auto bg-bg text-text-1">
      {/* ---------- top bar ---------- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <AsaLogo size="md" />
          <span className="hidden self-end text-[11px] text-text-3 sm:inline">by ASA Lifecare</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/login"
            className="hidden rounded-full px-4 py-2 text-sm font-semibold text-text-2 transition-colors duration-150 hover:text-text-1 sm:inline-block"
          >
            Sign in
          </Link>
          <Link
            to={workspaceHref}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-colors duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            Enter workspace
          </Link>
        </nav>
      </header>

      {/* ---------- hero ---------- */}
      <motion.section
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto flex max-w-6xl flex-col items-center px-6 py-20 text-center md:py-28"
      >
        <motion.div variants={item}>
          <Overline>HOME HEALTHCARE MANAGEMENT</Overline>
        </motion.div>
        <motion.h1
          variants={item}
          className="mt-6 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-text-1 md:text-7xl"
        >
          We care for
          <br />
          <span className="text-primary">people</span> at home.
        </motion.h1>
        <motion.p variants={item} className="mt-6 max-w-xl text-base leading-7 text-text-2 md:text-lg">
          One calm workspace for your clients, caregivers, schedules, certifications and operations —
          powered by ASA + CORTEX.
        </motion.p>
        <motion.div variants={item} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to={workspaceHref}
            className="flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
          >
            Enter workspace <ArrowRight size={16} />
          </Link>
          <Link
            to="/login"
            className="flex h-12 items-center rounded-full border border-border-strong bg-surface px-7 text-sm font-semibold text-text-1 transition-colors duration-150 hover:border-primary/40 hover:text-primary-strong"
          >
            Sign in
          </Link>
        </motion.div>
      </motion.section>

      {/* ---------- module cards ---------- */}
      <motion.section
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto max-w-6xl px-6 pb-4"
      >
        <motion.div variants={item} className="mb-8 flex items-end justify-between gap-4">
          <Overline>PLATFORM MODULES</Overline>
          <span className="hidden font-mono text-[11px] tracking-widest text-text-3 sm:inline">everything online</span>
        </motion.div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((app) => (
            <ModuleCard key={app.id} app={app} />
          ))}
        </div>
      </motion.section>

      {/* ---------- cortex band (only intentionally-dark surface — .cortex-band) ---------- */}
      <motion.section
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-80px' }}
        className="mx-auto max-w-6xl px-6 py-16 md:py-20"
      >
        <motion.div variants={item} className="cortex-band rounded-[24px] px-8 py-12 md:px-14 md:py-16">
          <Overline onBand>ASA + CORTEX</Overline>
          <h2 className="text-on-band mt-5 max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight md:text-5xl">
            The cognitive engine behind the platform.
          </h2>
          <p className="text-on-band-muted mt-5 max-w-xl text-base leading-7">
            Cortex connects to asa. — surfacing insights across visits, incidents, billing and care.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            {['NEURAL CORTEX — CONNECTED', 'COGNITION ENGINE — ONLINE', '24/7 — LIVE'].map((chip) => (
              <span
                key={chip}
                className="cortex-chip flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[10px] tracking-[0.18em]"
              >
                <span className="h-1 w-1 rounded-full bg-primary" />
                {chip}
              </span>
            ))}
          </div>
        </motion.div>
      </motion.section>

      {/* ---------- stats strip ---------- */}
      <motion.section
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
        className="mx-auto max-w-6xl px-6 pb-20"
      >
        <motion.div
          variants={item}
          className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-border bg-border shadow-1 md:grid-cols-4"
        >
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col items-center bg-surface px-6 py-8 text-center">
              <span className="font-display text-4xl font-extrabold tracking-tight text-text-1">{s.value}</span>
              <span className="mt-2 font-mono text-[10px] tracking-[0.25em] text-text-3">{s.label}</span>
            </div>
          ))}
        </motion.div>
      </motion.section>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-8 sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 font-mono text-xs text-text-3">
            SYSTEM STATUS: <PulseDot /> <span className="text-tint-fg-mint">ONLINE</span>
            <span className="text-text-3">·</span> mylife.asalifecare.com
          </span>
          <span className="font-mono text-xs text-text-3">ASA Lifecare — v0.4.0</span>
        </div>
        <SiteFooter as="p" className="pb-8 pt-0" />
      </footer>
    </div>
  )
}
