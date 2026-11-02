// THE PERSONAL PRODUCT SHELL — these are PRODUCTS, not tables.
// A world app from the personal suite is not a table with a form on top — it is a product page: a hero that says…
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Loader2, Plus, Settings, Sparkles, X } from 'lucide-react'
import Card from '@/components/shared/Card'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import { api } from '@/lib/api'
import { ohioToday } from '@/lib/ohio'
import { gasAction } from '@/features/hiring/shared'
import { EASE_OUT_EXPO } from '@/engine/motion'
import type { TintName } from '@/engine/types'

// One field of the quick-add form (the CreateField grammar, plus the product shell's own date default).
export type ProductField = {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'select' | 'date' | 'number'
  required?: boolean
  options?: string[]
  /** Options that depend on live data (Weight's members) resolve here. */
  optionsFrom?: (ctx: ProductCtx) => string[]
  tints?: Record<string, string>
  placeholder?: string
  /** 'today' stamps the day on open — most logs are about today. */
  def?: string
}

export type ProductStat = { label: string; value: string | number; icon: string; tint: TintName }

export type ProductLibraryItem = {
  id: string
  title: string
  subtitle?: string
  level?: string
  place?: string
  minutes?: string
  bullets?: string   // JSON array string from the sheet cell
  body?: string
}

export type ProductLibrary = {
  resource: string
  title: string
  sub: string
  // What a card offers beyond reading: - 'log' — one tap writes the row into the main tab (Move's plans).
  mode?: 'log' | 'prefill' | 'read'
  cta?: string
  /** 'log' only — the row one tap writes into the main tab. */
  write?: (item: ProductLibraryItem) => Record<string, unknown>
  /** 'prefill' only — the quick-add opens with these values. */
  prefill?: (item: ProductLibraryItem) => Record<string, string>
}

// Everything a spec's moving parts can reach: the (filtered) rows, the reload, the quick-add door, the hub profile…
export type ProductCtx = {
  /** The main tab's rows after the spec's own filterRows (member-aware). */
  rows: any[]
  /** The same rows, unfiltered. */
  allRows: any[]
  reload: () => void
  openQuickAdd: (initial?: Record<string, string>) => void
  /** The signed-in person's own hub record, when the spec asked for it. */
  hubProfile: Record<string, unknown> | null
  [key: string]: unknown
}

export type ProductSpec = {
  appId: string
  resource: string
  hero: string
  heroSub: string
  cta: string
  fields: ProductField[]
  stats: (rows: any[]) => ProductStat[]
  /** Narrow the rows before stats/recent (Weight's member filter). */
  filterRows?: (rows: any[], ctx: ProductCtx) => any[]
  /** Shape a shelf's cards — filter (Move by profile) or reorder (Plate by age). */
  shapeLibrary?: (resource: string, items: ProductLibraryItem[], ctx: ProductCtx) => ProductLibraryItem[]
  // Spec-owned state, merged into the ctx (each app mounts its own page component, so a per-spec hook set is…
  useExtras?: () => Record<string, unknown>
  /** Values the quick-add opens with (Weight's current member). */
  quickAddDefaults?: (ctx: ProductCtx) => Record<string, string>
  /** Read the hub profile once — powers the "picked for you" hint. */
  nudge?: boolean
  /** Ready-made content shelves. */
  libraries?: ProductLibrary[]
  /** Slot under the hero (Weight's member switcher). */
  belowHero?: (ctx: ProductCtx) => React.ReactNode
  /** Apps with a signature card (Weight's BMI) render it here, after the stats. */
  custom?: (ctx: ProductCtx) => React.ReactNode
  /** Slot above the shelves (Move's profile card, Money's bills). */
  aboveShelves?: (ctx: ProductCtx) => React.ReactNode
}

const TINT_GRADIENT: Record<string, string> = {
  mint: 'from-emerald-500/15 to-transparent',
  peach: 'from-orange-400/15 to-transparent',
  lavender: 'from-violet-400/15 to-transparent',
  pink: 'from-rose-400/15 to-transparent',
  blue: 'from-sky-400/15 to-transparent',
  amber: 'from-amber-400/20 to-transparent',
  green: 'from-green-500/15 to-transparent',
}

// The per-app settings toggles, persisted in worldSettings as `${appId}:${key}` rows (value 'true' = hidden; absent…
const SETTINGS_TOGGLES = [
  { key: 'hideStats', label: 'Live stats', hint: 'The numbers under the hero' },
  { key: 'hideLibraries', label: 'Content shelves', hint: 'Guides, plans and reference cards' },
  { key: 'hideRecent', label: 'Latest entries', hint: 'The five freshest rows' },
]

const num0 = (v: unknown) => Number(v) || 0

function parseBullets(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

// The quick-add modal — big fields, tinted selects, today's date pre-set.
function QuickAdd({ spec, ctx, initial, onClose, onSaved }: {
  spec: ProductSpec
  ctx: ProductCtx
  initial?: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of spec.fields) if (f.def === 'today') out[f.key] = ohioToday()
    return { ...out, ...(spec.quickAddDefaults?.(ctx) ?? {}), ...(initial ?? {}) }
  })
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const missing: Record<string, boolean> = {}
    for (const f of spec.fields) if (f.required && !(values[f.key] ?? '').trim()) missing[f.key] = true
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }
    setSaving(true)
    try {
      await api.create(spec.resource, { ...values })
      toast({ type: 'success', title: 'Saved.' })
      onSaved()
      onClose()
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        className="relative w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-[16px] font-bold text-text-1">{spec.cta}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3">
          {spec.fields.map((f) => (
            <label key={f.key} className="block">
              <span className={cn('mb-1 block text-[12px] font-semibold', errors[f.key] ? 'text-tint-fg-pink' : 'text-text-2')}>
                {f.label}{f.required ? ' *' : ''}
              </span>
              {f.type === 'select' ? (
                <div className="flex flex-wrap gap-1.5">
                  {(f.optionsFrom?.(ctx) ?? f.options ?? []).map((opt) => {
                    const on = values[f.key] === opt
                    const tint = (f.tints?.[opt] ?? 'blue') as TintName
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, [f.key]: opt }))}
                        className={cn(
                          'h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-all',
                          on
                            ? cn('border-transparent', TINT_BG[tint] ?? 'bg-tint-blue', TINT_FG[tint] ?? 'text-tint-fg-blue')
                            : 'border-border bg-surface text-text-3 hover:border-border-strong hover:text-text-1',
                        )}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              ) : f.type === 'textarea' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  rows={2}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
                />
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
                />
              )}
            </label>
          ))}
        </div>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Save
        </button>
      </motion.div>
    </div>
  )
}

/** The gear's modal — three switches over worldSettings, shown = on. */
function ProductSettings({ hidden, onToggle, onClose }: {
  hidden: (key: string) => boolean
  onToggle: (key: string, hide: boolean) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-[16px] font-bold text-text-1">This page, your way</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={15} />
          </button>
        </div>
        <div className="divide-y divide-border">
          {SETTINGS_TOGGLES.map((t) => {
            const shown = !hidden(t.key)
            return (
              <div key={t.key} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-text-1">{t.label}</p>
                  <p className="mt-0.5 text-[12px] text-text-3">{t.hint}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={shown}
                  aria-label={t.label}
                  onClick={() => onToggle(t.key, shown)}
                  className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', shown ? 'bg-tint-mint' : 'bg-surface-3')}
                >
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-1 transition-all', shown ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

export default function PersonalProductPage({ spec, icon, accent }: { spec: ProductSpec; icon: string; accent: TintName }) {
  const [rows, setRows] = useState<any[]>([])
  const [libraries, setLibraries] = useState<Record<string, ProductLibraryItem[]>>({})
  const [loaded, setLoaded] = useState(false)
  const [quickAdd, setQuickAdd] = useState<{ initial?: Record<string, string> } | null>(null)
  const [taken, setTaken] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [settingsRows, setSettingsRows] = useState<any[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hubProfile, setHubProfile] = useState<Record<string, unknown> | null>(null)
  const extras = spec.useExtras?.() ?? {}

  const load = async () => {
    try {
      const [main, ...libs] = await Promise.all([
        api.list<any>(spec.resource as never),
        ...(spec.libraries ?? []).map((l) => api.list<any>(l.resource as never)),
      ])
      setRows(Array.isArray(main) ? main : [])
      const libRows: Record<string, ProductLibraryItem[]> = {}
      ;(spec.libraries ?? []).forEach((l, i) => {
        libRows[l.resource] = (Array.isArray(libs[i]) ? libs[i] : []) as ProductLibraryItem[]
      })
      setLibraries(libRows)
    } catch { /* an unreachable tab is an empty product, never a broken page */ }
    setLoaded(true)
  }

  const loadSettings = async () => {
    try {
      const s = await api.list<any>('worldSettings' as never)
      setSettingsRows((Array.isArray(s) ? s : []).filter((r) => String(r.app ?? '') === spec.appId))
    } catch { /* no settings tab yet — everything shows, nothing breaks */ }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); void loadSettings() }, [spec.appId])

  // THE HUB PROFILE, ONCE (nudge specs only).
  useEffect(() => {
    if (!spec.nudge) return
    let alive = true
    gasAction<Record<string, unknown>>('userProfileDeep', {})
      .then((p) => { if (alive && p && typeof p === 'object') setHubProfile(p) })
      .catch(() => { /* silence by design */ })
    return () => { alive = false }
  }, [spec.appId, spec.nudge])

  const ctx: ProductCtx = {
    rows: [],           // filled below, after the spec's own filter
    allRows: rows,
    reload: () => void load(),
    openQuickAdd: (initial) => setQuickAdd({ initial }),
    hubProfile,
    ...extras,
  }
  const viewRows = useMemo(() => (spec.filterRows ? spec.filterRows(rows, ctx) : rows), [spec, rows, extras.weightMember])
  ctx.rows = viewRows

  const stats = useMemo(() => spec.stats(viewRows), [spec, viewRows])
  const recent = useMemo(() => [...viewRows].reverse().slice(0, 5), [viewRows])

  // The hint chip: only when the profile actually says something about the person (a sex/gender or a birth year).
  const profSex = String(hubProfile?.sex ?? hubProfile?.gender ?? '').trim()
  const profYear = Number(hubProfile?.birthYear ?? hubProfile?.birth_year) || 0
  const nudge = spec.nudge && (profSex || profYear > 1900) ? 'Guides picked for you' : null

  const hidden = (key: string) =>
    settingsRows.some((r) => String(r.id) === `${spec.appId}:${key}` && String(r.value) === 'true')

  const toggleSetting = async (key: string, hide: boolean) => {
    const id = `${spec.appId}:${key}`
    const exists = settingsRows.some((r) => String(r.id) === id)
    const value = String(hide)
    // optimistic — the sheet confirms in the background
    setSettingsRows((rs) => (exists
      ? rs.map((r) => (String(r.id) === id ? { ...r, value } : r))
      : [...rs, { id, app: spec.appId, key, value }]))
    try {
      if (exists) await api.update('worldSettings' as never, id, { value } as never)
      else await api.create('worldSettings' as never, { id, app: spec.appId, key, value } as never)
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save the setting', body: err instanceof Error ? err.message : String(err) })
      void loadSettings()
    }
  }

  const useLibraryItem = async (lib: ProductLibrary, item: ProductLibraryItem) => {
    if (!lib.write) return
    const key = `${lib.resource}:${item.id}`
    try {
      await api.create(spec.resource as never, lib.write(item) as never)
      setTaken((t) => new Set(t).add(key))
      toast({ type: 'success', title: `${item.title} — in your log.` })
      void load()
    } catch (err) {
      toast({ type: 'danger', title: 'Could not add it', body: err instanceof Error ? err.message : String(err) })
    }
  }

  const toggleExpanded = (key: string) =>
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="w-full pb-10">
      {/* THE HERO — what this product is, and the one-tap door into it */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
        className={cn('relative overflow-hidden rounded-xl border border-border bg-gradient-to-br p-7 sm:p-8', TINT_GRADIENT[accent] ?? TINT_GRADIENT.blue)}
      >
        <span className={cn('absolute -right-6 -top-6 grid h-28 w-28 place-items-center rounded-full', TINT_BG[accent] ?? 'bg-tint-blue')}>
          <AppIcon name={icon} size={40} className="opacity-60" />
        </span>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Page settings"
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-md border border-border bg-surface/80 text-text-3 transition-colors hover:text-text-1"
        >
          <Settings size={14} />
        </button>
        <h1 className="font-display text-[24px] font-bold leading-7 tracking-[-0.015em] text-text-1">{spec.hero}</h1>
        <p className="mt-2 max-w-[480px] text-[13.5px] leading-6 text-text-2">{spec.heroSub}</p>
        <button
          onClick={() => setQuickAdd({})}
          className="mt-5 flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-[14px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus size={16} /> {spec.cta}
        </button>
      </motion.div>

      {/* the profile hint — only when the hub profile knows the person */}
      {nudge && (
        <div className="mt-3 flex">
          <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold', TINT_BG[accent] ?? 'bg-tint-blue', TINT_FG[accent] ?? 'text-tint-fg-blue')}>
            <Sparkles size={12} /> {nudge}
          </span>
        </div>
      )}

      {/* the spec's under-hero slot (Weight's member switcher) */}
      {spec.belowHero?.(ctx)}

      {/* LIVE STATS — the person's own numbers, computed here */}
      {!hidden('hideStats') && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.05, duration: 0.22, ease: EASE_OUT_EXPO }}>
              <Card padded={false} className="p-4">
                <span className={cn('grid h-8 w-8 place-items-center rounded-md', TINT_BG[s.tint] ?? 'bg-tint-blue', TINT_FG[s.tint] ?? 'text-tint-fg-blue')}>
                  <AppIcon name={s.icon} size={15} />
                </span>
                <p className="mt-2.5 font-stat text-[22px] font-semibold leading-6 text-text-1">{loaded ? s.value : '—'}</p>
                <p className="mt-0.5 text-[11.5px] font-medium text-text-3">{s.label}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* the signature card (Weight's BMI lives here) */}
      {spec.custom?.(ctx)}

      {/* the spec's above-shelves slot (Move's profile, Money's bills) */}
      {spec.aboveShelves?.(ctx)}

      {/* READY-MADE CONTENT — cards that expand; what a tap writes depends
       *  on the shelf's mode (log / prefill / read) */}
      {!hidden('hideLibraries') && (spec.libraries ?? []).map((lib) => {
        const mode = lib.mode ?? 'read'
        const raw = libraries[lib.resource] ?? []
        if (!raw.length) return null
        const items = spec.shapeLibrary ? spec.shapeLibrary(lib.resource, raw, ctx) : raw
        return (
        <div className="mt-8" key={lib.resource}>
          <div className="mb-3">
            <h2 className="font-display text-[17px] font-bold text-text-1">{lib.title}</h2>
            <p className="mt-0.5 text-[13px] text-text-2">{lib.sub}</p>
          </div>
          {items.length === 0 ? (
            <Card padded={false} className="p-4">
              <p className="text-[12.5px] text-text-3">Nothing matches right now — adjust the filters above.</p>
            </Card>
          ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item, i) => {
              const bullets = parseBullets(item.bullets)
              const key = `${lib.resource}:${item.id}`
              const open = expanded.has(key)
              const done = taken.has(key)
              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.22, ease: EASE_OUT_EXPO }}>
                  <Card padded={false} className="h-full transition-colors hover:border-border-strong">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleExpanded(key)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(key) } }}
                      className="flex h-full cursor-pointer flex-col p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[14px] font-semibold leading-5 text-text-1">{item.title}</p>
                        {(item.level || item.minutes || item.place) && (
                          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', TINT_BG[accent] ?? 'bg-tint-blue', TINT_FG[accent] ?? 'text-tint-fg-blue')}>
                            {[item.level, item.place, item.minutes && `${item.minutes} min`].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      {item.subtitle && <p className="mt-1 text-[12.5px] leading-5 text-text-2">{item.subtitle}</p>}
                      {bullets.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {(open ? bullets : bullets.slice(0, 4)).map((b) => (
                            <li key={b} className="flex items-start gap-1.5 text-[12px] leading-4.5 text-text-3">
                              <Check size={11} className="mt-0.5 shrink-0 text-tint-fg-mint" /> {b}
                            </li>
                          ))}
                        </ul>
                      )}
                      {!open && bullets.length > 4 && (
                        <p className="mt-1 text-[11px] font-semibold text-text-3">+{bullets.length - 4} more — tap to open</p>
                      )}
                      {open && item.body && <p className="mt-2 text-[12.5px] leading-5 text-text-2">{item.body}</p>}
                      {mode === 'log' && lib.write && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void useLibraryItem(lib, item) }}
                          disabled={done}
                          className={cn(
                            'mt-3 flex h-8 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-semibold transition-all',
                            done ? 'bg-tint-mint text-tint-fg-mint' : 'bg-surface-2 text-text-1 hover:bg-surface-3 active:scale-[0.98]',
                          )}
                        >
                          {done ? <><Check size={13} /> In your log</> : <>{lib.cta} <ArrowRight size={13} /></>}
                        </button>
                      )}
                      {mode === 'prefill' && lib.prefill && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setQuickAdd({ initial: lib.prefill!(item) }) }}
                          className="mt-3 flex h-8 items-center justify-center gap-1.5 rounded-md bg-surface-2 text-[12.5px] font-semibold text-text-1 transition-all hover:bg-surface-3 active:scale-[0.98]"
                        >
                          {lib.cta} <ArrowRight size={13} />
                        </button>
                      )}
                    </div>
                  </Card>
                </motion.div>
              )
            })}
          </div>
          )}
        </div>
        )
      })}

      {/* LATEST — the five freshest entries, and the full table one tap away */}
      {!hidden('hideRecent') && (
        <div className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-[17px] font-bold text-text-1">Latest entries</h2>
            <Link to={`/app/${spec.appId}/data`} className="flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
              All entries <ArrowRight size={13} />
            </Link>
          </div>
          <Card padded={false}>
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[13.5px] font-semibold text-text-1">Nothing logged yet</p>
                <p className="mt-1 text-[12.5px] text-text-3">Your first entry is one tap on the button above.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((r) => (
                  <li key={String(r.id)} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="clamp-1 text-[13px] font-medium text-text-1">
                      {String(r.habit ?? r.item ?? r.product ?? r.description ?? r.name ?? r.title ?? r.activity ?? r.task ?? r.doctor ?? r.goal ?? r.kind ?? r.pet ?? r.meal ?? (num0(r.weightKg) > 0 ? `${r.weightKg} kg${r.member ? ` · ${r.member}` : ''}` : null) ?? 'Entry')}
                    </span>
                    <span className="shrink-0 text-[12px] text-text-3">{String(r.day ?? r.since ?? r.checked ?? '')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {quickAdd && <QuickAdd spec={spec} ctx={ctx} initial={quickAdd.initial} onClose={() => setQuickAdd(null)} onSaved={() => void load()} />}
      {settingsOpen && <ProductSettings hidden={hidden} onToggle={(k, h) => void toggleSetting(k, h)} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
