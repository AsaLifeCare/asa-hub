// Settings → Routes (the master only — MASTER_ONLY_SECTIONS, anchor #routes): every HTTP route the app answers or
// carries to the relay, on or off. No route is ever deleted; one turned off is refused before it is routed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Loader2, Lock, Search, X } from 'lucide-react'
import Card, { CardHeader } from '@/components/shared/Card'
import { Switch } from '@/components/ui/switch'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { keepLane, keptLane, laneGeneration, onLaneRing } from '@/lib/laneKeep'
import { relayLane } from '@/lib/noticesApi'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export const ROUTES_PATH = '/hub-lanes/route-switches'
export const ROUTES_RING = 'route-switches'

export type AnsweredBy = 'app' | 'relay' | 'both' | 'none'

export type RouteRow = {
  key: string
  method: string
  path: string
  area: string
  answeredBy: AnsweredBy
  handler: string
  module: string
  enabled: boolean
  defaultEnabled: boolean
  locked: boolean
  setBy: string
  setAt: string
}

export type RoutesView = {
  routes: RouteRow[]
  storeWhy: string
  relayWhy: string
  readAt: string
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const ANSWERED: AnsweredBy[] = ['app', 'relay', 'both', 'none']

/** The lane's answer as this screen draws it; null when it is not the list. */
export function routesViewFrom(raw: unknown): RoutesView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (!Array.isArray(d.routes)) return null
  const routes: RouteRow[] = []
  for (const x of d.routes) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const key = text(r.key)
    if (!key) continue
    const by = text(r.answered_by) as AnsweredBy
    routes.push({
      key,
      method: text(r.method),
      path: text(r.path),
      area: text(r.area) || '/',
      answeredBy: ANSWERED.includes(by) ? by : 'none',
      handler: text(r.handler),
      module: text(r.module),
      enabled: r.enabled !== false,
      defaultEnabled: r.default_enabled !== false,
      locked: r.locked === true,
      setBy: text(r.set_by),
      setAt: text(r.set_at),
    })
  }
  return { routes, storeWhy: text(d.store_why), relayWhy: text(d.relay_why), readAt: text(d.read_at) }
}

export const ANSWERED_WORDS: Record<AnsweredBy, string> = {
  app: 'App',
  relay: 'Relay, carried',
  both: 'App (the relay has it too)',
  none: 'No longer answered',
}

/** What a row says about its state beyond the switch. */
export function stateWords(r: RouteRow): string {
  if (r.locked) return 'Always on: it keeps the switches, the health checks and the sign-in reachable.'
  if (!r.setAt || r.setBy === 'default') return r.enabled ? '' : 'Off by default: no caller is left.'
  const at = new Date(r.setAt)
  const when = Number.isNaN(at.getTime()) ? r.setAt : at.toLocaleString()
  return `Turned ${r.enabled ? 'on' : 'off'} ${when}${r.setBy ? ` by ${r.setBy}` : ''}.`
}

/** The rows a filter keeps: every word must be found in the route's method, path, area, handler or state. */
export function filterRoutes(rows: RouteRow[], query: string): RouteRow[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  return rows.filter((r) => {
    const hay = [r.key, r.area, r.handler, r.module, ANSWERED_WORDS[r.answeredBy], r.enabled ? 'on' : 'off',
      r.locked ? 'locked' : ''].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The rows by area, areas in order. */
export function groupRoutes(rows: RouteRow[]): { area: string; rows: RouteRow[] }[] {
  const by = new Map<string, RouteRow[]>()
  for (const r of rows) {
    const list = by.get(r.area)
    if (list) list.push(r)
    else by.set(r.area, [r])
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, list]) => ({ area, rows: list }))
}

export default function RoutesSection() {
  const [view, setView] = useState<RoutesView | null>(() => routesViewFrom(keptLane<unknown>(ROUTES_PATH)))
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState('')
  const [find, setFind] = useState('')

  const load = useCallback(async () => {
    const generation = laneGeneration()
    try {
      const raw = await relayLane<unknown>(ROUTES_PATH)
      const got = routesViewFrom(raw)
      if (!got) {
        setFailed('the read came back without the list')
        return
      }
      keepLane(ROUTES_PATH, raw, generation)
      setFailed('')
      setView(got)
    } catch (e) {
      setFailed((e instanceof Error ? e.message : String(e)) || 'the read did not come back')
    }
  }, [])
  useEffect(() => {
    void load()
    return onLaneRing(ROUTES_RING, () => void load())
  }, [load])

  /** One route on or off; only what the lane answered is adopted. */
  const flip = async (r: RouteRow, enabled: boolean) => {
    setBusy(r.key)
    const generation = laneGeneration()
    try {
      const raw = await relayLane<unknown>(ROUTES_PATH, {
        method: 'POST', body: JSON.stringify({ key: r.key, enabled }),
      })
      const got = routesViewFrom(raw)
      if (got) {
        keepLane(ROUTES_PATH, raw, generation)
        setView(got)
      }
      toast({
        type: 'success',
        title: `${r.key}: ${enabled ? 'on' : 'off'}`,
        body: enabled ? 'It is answered again from its next request.'
          : 'From its next request it is refused before it is routed. Nothing was deleted.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Not switched', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  return (
    <motion.section
      id="routes"
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-20"
    >
      <Card>
        <CardHeader
          title="Routes — every HTTP route, on or off"
          sub="Each route the app answers, and each the relay answers through it. A route turned off is refused before it is routed, so nothing answers it and nothing is carried; no route is ever deleted."
        />
        {view === null ? (
          failed ? (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1"
              data-routes-failed>
              <p>The routes could not be read — {failed}. Nothing is shown, so nothing is switched blind.</p>
              <button type="button" onClick={() => { setFailed(''); void load() }}
                className="mt-2 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
                Try again
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-text-3">
              <Loader2 size={14} className="animate-spin" /> Reading the routes…
            </p>
          )
        ) : (
          <RoutesList view={view} failed={failed} busy={busy} find={find} onFind={setFind}
            onFlip={(r, on) => void flip(r, on)} />
        )}
      </Card>
    </motion.section>
  )
}

/** The list once read: a filter, the routes by area, each with its switch. */
export function RoutesList({ view, failed, busy, find, onFind, onFlip }: {
  view: RoutesView
  failed: string
  busy: string
  find: string
  onFind: (v: string) => void
  onFlip: (r: RouteRow, enabled: boolean) => void
}) {
  const shown = useMemo(() => filterRoutes(view.routes, find), [view.routes, find])
  const groups = useMemo(() => groupRoutes(shown), [shown])
  const off = view.routes.filter((r) => !r.enabled).length
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const filtering = find.trim() !== ''
  const toggle = (area: string) => setOpen((s) => {
    const next = new Set(s)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    return next
  })

  return (
    <div className="space-y-3" data-routes>
      {failed && (
        <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2" data-routes-stale>
          The last read did not come back ({failed}); this is the list as it was last read.
        </p>
      )}
      {view.storeWhy && (
        <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] text-text-1" data-routes-store>
          The switches could not be read just now ({view.storeWhy}).
        </p>
      )}
      {view.relayWhy && (
        <p className="rounded-md border border-border bg-tint-amber px-3 py-2 text-[12.5px] text-text-2" data-routes-relay>
          The relay's routes are not listed: {view.relayWhy}.
        </p>
      )}
      <label className="relative flex items-center">
        <Search size={14} className="absolute left-2.5 shrink-0 text-text-3" />
        <input value={find} onChange={(e) => onFind(e.target.value)} data-routes-find
          placeholder="Filter — a path, a method, an area, relay, off, locked…"
          className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-8 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
        {find ? (
          <button type="button" onClick={() => onFind('')} aria-label="Clear the filter"
            className="absolute right-2 text-text-3 hover:text-text-2">
            <X size={14} />
          </button>
        ) : null}
      </label>
      <p className="text-[12px] text-text-3" data-routes-count>
        {view.routes.length} route{view.routes.length === 1 ? '' : 's'}, {off} off
        {filtering ? ` · ${shown.length} match${shown.length === 1 ? 'es' : ''} the filter` : ''}
      </p>
      {groups.map((g) => {
        const offHere = g.rows.filter((r) => !r.enabled).length
        const expanded = filtering || open.has(g.area)
        return (
          <div key={g.area} className="rounded-md border border-border" data-routes-area={g.area}>
            <button type="button" onClick={() => toggle(g.area)} aria-expanded={expanded}
              className="flex w-full items-center gap-2 px-3 py-2 text-left">
              <ChevronDown size={14} className={cn('shrink-0 text-text-3 transition-transform', !expanded && '-rotate-90')} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold text-text-1">{g.area}</span>
              <span className="shrink-0 text-[11.5px] text-text-3">
                {g.rows.length}{offHere ? ` · ${offHere} off` : ''}
              </span>
            </button>
            {expanded && (
              <div className="divide-y divide-border border-t border-border">
                {g.rows.map((r) => <RouteLine key={r.key} r={r} busy={busy === r.key} onFlip={onFlip} />)}
              </div>
            )}
          </div>
        )
      })}
      {!shown.length && <p className="text-[13px] text-text-3">No route matches the filter.</p>}
    </div>
  )
}

function RouteLine({ r, busy, onFlip }: { r: RouteRow; busy: boolean; onFlip: (r: RouteRow, enabled: boolean) => void }) {
  const said = stateWords(r)
  return (
    <div className="flex items-start gap-3 px-3 py-2" data-route={r.key} data-route-on={r.enabled ? '1' : '0'}>
      <span className={cn('mt-0.5 w-12 shrink-0 font-mono text-[11px] font-semibold',
        r.enabled ? 'text-primary' : 'text-text-3')}>{r.method}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('break-all font-mono text-[12.5px]', r.enabled ? 'text-text-1' : 'text-text-3 line-through')}>
          {r.path}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-[16px] text-text-3">
          {ANSWERED_WORDS[r.answeredBy]}
          {r.handler ? ` · ${r.module ? `${r.module}.` : ''}${r.handler}` : ''}
        </p>
        {said && <p className="mt-0.5 text-[11.5px] leading-[16px] text-text-2">{said}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        {busy && <Loader2 size={13} className="animate-spin text-text-3" />}
        {r.locked && <Lock size={13} className="text-text-3" aria-label="Locked on" />}
        <Switch checked={r.enabled} disabled={r.locked || busy} onCheckedChange={(on) => onFlip(r, on)}
          aria-label={`${r.key}: ${r.enabled ? 'on' : 'off'}`} data-route-switch={r.key} />
      </div>
    </div>
  )
}
