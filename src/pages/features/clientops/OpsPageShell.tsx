// Shared layout shell for the client-ops suite pages (call-offs, dr appointments, UI reports, house repair)…
// Also ships the small building blocks every page reuses: TintChip (extended tints), StatStrip, OrderingSelect and…
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpDown } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import ContextBanner from '@/components/shared/ContextBanner'
import { useContextStore, type FocusType } from '@/stores/useContextStore'
import { TINT_BG, TINT_FG, type ExtendedTintName } from '@/lib/tints'
import { AppIcon } from '@/lib/icons'
import { staggerItem } from '@/engine/motion'
import { cn } from '@/lib/utils'

/* ---------- atoms ---------- */

/** Tint chip accepting the extended tint vocabulary (warning/danger/info…). */
export function TintChip({ label, tint, className }: { label: string; tint: ExtendedTintName; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize leading-4',
        TINT_BG[tint],
        TINT_FG[tint],
        className,
      )}
    >
      {label}
    </span>
  )
}

// `value` is a ReactNode, not just string|number: some tiles state a PERSON — "Top caller-offer" is a staff…
export type OpsStat = { label: string; value: ReactNode; icon: string; tint: ExtendedTintName }

/** Compact stats strip rendered between the action bar and the list. */
export function StatStrip({ stats }: { stats: OpsStat[] }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-3">
      {stats.map((s) => (
        <motion.div key={s.label} variants={staggerItem}>
          <Card className="flex items-center gap-3 !p-3.5">
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', TINT_BG[s.tint])}>
              <AppIcon name={s.icon} size={16} className={TINT_FG[s.tint]} />
            </span>
            <div className="min-w-0">
              <div className="font-stat text-[18px] font-bold leading-6 text-text-1">{s.value}</div>
              <div className="clamp-1 text-[11px] text-text-3">{s.label}</div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  )
}

export type OrderOption = { id: string; label: string }

/** ORDERING dropdown — compact select with a sort icon. */
export function OrderingSelect({
  options,
  value,
  onChange,
}: {
  options: OrderOption[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
      <ArrowUpDown size={13} className="text-text-3" />
      Ordering
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-[12px] font-medium normal-case tracking-normal text-text-1 outline-none transition-colors focus:border-primary"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ---------- form atoms (mirrors the ops-flows modal styling) ---------- */

export const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12px] font-medium text-text-2">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

/** Single-select chip row used for reasons / priorities / categories. */
export function ChipPicker<T extends string>({
  options,
  value,
  onChange,
  tint = 'primary',
}: {
  options: readonly T[]
  value: T | ''
  onChange: (v: T) => void
  tint?: ExtendedTintName
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => {
        const active = value === o
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o)}
            className={cn(
              'h-7 rounded-full border px-3 text-[12px] font-medium transition-all duration-150 active:scale-[0.97]',
              active
                ? cn('border-transparent', TINT_BG[tint], TINT_FG[tint])
                : 'border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1',
            )}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- shell ---------- */

export default function OpsPageShell({
  title,
  subtitle,
  actions,
  toolbar,
  hero,
  stats,
  focusType,
  filtered,
  children,
}: {
  title: string
  subtitle?: string
  /** Top action bar content (left side): the prominent primary + outline actions. */
  actions: ReactNode
  /** Top action bar content (right side): e.g. the ORDERING dropdown. */
  toolbar?: ReactNode
  /** The black header, under the title. */
  hero?: ReactNode
  stats?: OpsStat[]
  /** When a focus of this type is active the page filters + the banner shows. */
  focusType?: FocusType
  /** Whether the current focus actually filtered rows (drives banner copy). */
  filtered?: boolean
  children: ReactNode
}) {
  const focus = useContextStore((s) => s.focus)
  const bannerForThisPage = focus && (!focusType || focus.type === focusType)
  return (
    <div className="w-full">
      <PageHeader title={title} subtitle={subtitle} />
      {hero}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {actions}
        {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
      </div>
      {bannerForThisPage && <ContextBanner filtered={filtered ?? true} />}
      {stats && stats.length > 0 && (
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
          <StatStrip stats={stats} />
        </motion.div>
      )}
      {children}
    </div>
  )
}

/* ---------- shared button styles ---------- */

export const primaryBtnCls =
  'flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'

export const outlineBtnCls =
  'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 active:scale-[0.98]'

export const ghostBtnCls =
  'flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-primary transition-colors hover:bg-primary-soft'
