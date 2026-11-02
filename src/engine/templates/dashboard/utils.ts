// Layout persistence, widget-palette metadata and data-resolution helpers (moved verbatim from…
import { format } from 'date-fns'
import { ohioWall } from '@/lib/ohio'
import type { TintName } from '@/engine/types'
import type { DashLayout, WhereClause } from './types'

/* ---------- persisted layout (asa-dash-layout:<pageId>) ---------- */

export const EMPTY_LAYOUT: DashLayout = { order: [], overrides: {}, added: [], catalog: [] }

export function loadLayout(key: string): DashLayout {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return EMPTY_LAYOUT
    const p = JSON.parse(raw)
    return {
      order: Array.isArray(p?.order) ? p.order.filter((x: any) => typeof x === 'string') : [],
      overrides: p?.overrides && typeof p.overrides === 'object' ? p.overrides : {},
      added: Array.isArray(p?.added)
        ? p.added.filter((a: any) => a && typeof a.id === 'string' && typeof a.kind === 'string')
        : [],
      catalog: Array.isArray(p?.catalog) ? p.catalog.filter((x: any) => typeof x === 'string') : [],
    }
  } catch {
    return EMPTY_LAYOUT
  }
}

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** Stable id for a schema widget (explicit id, else derived from kind + title/label). */
export const schemaWidgetId = (w: any, i: number) =>
  String(w.id ?? `${w.kind}-${slug(String(w.title ?? w.label ?? `widget-${i}`))}`)

/* ---------- widget palette metadata + defaults (Add-widget modal) ---------- */

export const KIND_META: Record<string, { label: string; blurb: string; icon: string }> = {
  stat: { label: 'Stat', blurb: 'KPI number with sparkline', icon: 'trending-up' },
  area: { label: 'Area chart', blurb: 'Trend lines over time', icon: 'chart-spline' },
  donut: { label: 'Donut', blurb: 'Share-of-total slices', icon: 'chart-pie' },
  bars: { label: 'Ranked bars', blurb: 'Categories by count, biggest first', icon: 'chart-bar-big' },
  list: { label: 'List', blurb: 'Titled rows with meta', icon: 'list' },
  feed: { label: 'Feed', blurb: 'Activity timeline', icon: 'activity' },
  ring: { label: 'Goal ring', blurb: 'Progress toward a goal', icon: 'loader-pinwheel' },
  actions: { label: 'Actions', blurb: 'Tinted shortcut buttons', icon: 'zap' },
  weather: { label: 'Weather', blurb: 'Canton, OH forecast (mock)', icon: 'cloud-sun' },
  clock: { label: 'Clock', blurb: 'Live time and date', icon: 'clock' },
  note: { label: 'Sticky note', blurb: 'Persistent scratch pad', icon: 'notebook' },
  links: { label: 'Quick links', blurb: 'Icon rows to anywhere', icon: 'link-2' },
}

export const KIND_DEFAULTS: Record<string, { title?: string; span?: 1 | 2; config?: Record<string, any> }> = {
  stat: { title: 'New metric', config: { label: 'New metric', value: 42, delta: 3.1, tint: 'blue', spark: [4, 6, 5, 8, 7, 9, 11, 10, 12] } },
  area: {
    title: 'Trend', span: 2,
    config: { series: [{ name: 'Series A', color: 'mint', points: [4, 8, 6, 10, 9, 13, 12, 16] }, { name: 'Series B', color: 'blue', points: [3, 5, 7, 6, 9, 8, 11, 12] }] },
  },
  donut: { title: 'Breakdown', config: { centerLabel: 'total', slices: [{ label: 'Group A', value: 8, tint: 'mint' }, { label: 'Group B', value: 5, tint: 'lavender' }, { label: 'Group C', value: 3, tint: 'peach' }] } },
  bars: {
    title: 'Ranked bars',
    config: { bars: [{ label: 'First category', value: 12 }, { label: 'Second category', value: 7 }, { label: 'Third category', value: 3 }] },
  },
  list: { title: 'Pinned items', config: { items: [{ icon: 'star', tint: 'mint', title: 'First item', meta: 'Added just now' }, { icon: 'flag', tint: 'peach', title: 'Second item', meta: 'Tap ⋯ to rename this widget' }] } },
  feed: { title: 'Activity' },
  ring: { title: 'Goal', config: { percent: 50, tint: 'mint', caption: 'Half way there' } },
  actions: { title: 'Quick actions', config: { actions: [{ icon: 'layout-grid', label: 'App Hub', tint: 'mint', href: '/apps' }, { icon: 'users', label: 'Directory', tint: 'blue', href: '/app/people/directory' }] } },
  weather: { title: 'Weather', config: { city: 'Canton, OH' } },
  clock: { title: 'Clock' },
  note: { title: 'Sticky note', config: { tint: 'amber' } },
  links: { title: 'Quick links', config: { links: [{ icon: 'layout-grid', label: 'App Hub', href: '/apps' }, { icon: 'calendar-days', label: 'Schedule', href: '/app/schedule/week' }, { icon: 'book-open', label: 'Documents', href: '/app/knowledge/docs' }] } },
}

export const WIDGET_TINTS: TintName[] = ['mint', 'peach', 'lavender', 'pink', 'blue', 'amber']

// ---------- data-computed widgets (additive, schema-driven) ---------- Any widget may carry a `from` spec to…

function matchWhere(row: any, where: WhereClause[] = []) {
  return where.every((c) => {
    const v = String(row[c.field] ?? '')
    if (c.eq != null) return v === c.eq
    if (c.in) return c.in.includes(v)
    return true
  })
}

// Anything date-shaped a widget hands over, printed on OHIO's clock.
function fmtVal(v: any) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = ohioWall(v)
    if (d) return format(d, 'MMM d, yyyy')
  }
  return String(v ?? '')
}

export function resolveWidget(w: any, data: any[]) {
  const f = w.from
  if (!f) return w
  if (w.kind === 'stat') return { ...w, value: data.filter((r) => matchWhere(r, f.where)).length }
  if (w.kind === 'donut' && f.groupBy) {
    const counts = new Map<string, number>()
    for (const r of data.filter((x) => matchWhere(x, f.where))) {
      const k = String(r[f.groupBy] ?? 'other')
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const keys = (f.order as string[] | undefined) ?? [...counts.keys()]
    const slices = keys
      .filter((k) => counts.has(k))
      .map((k) => ({ label: f.labels?.[k] ?? k, value: counts.get(k)!, tint: f.tintBy?.[k] ?? 'blue' }))
    return { ...w, slices }
  }
  if (w.kind === 'list') {
    let rows = data.filter((r) => matchWhere(r, f.where))
    if (f.sortBy)
      rows = [...rows].sort(
        (a, b) => String(a[f.sortBy] ?? '').localeCompare(String(b[f.sortBy] ?? '')) * (f.desc ? -1 : 1),
      )
    if (f.limit) rows = rows.slice(0, f.limit)
    const items = rows.map((r) => ({
      avatar: f.avatarField ? { src: r[f.avatarField], name: String(r[f.titleField ?? ''] ?? '') } : undefined,
      icon: f.icon,
      tint: f.tintField ? (f.tintBy?.[String(r[f.tintField])] ?? 'blue') : (f.tint ?? 'blue'),
      title: String(r[f.titleField ?? 'title'] ?? ''),
      meta: (f.metaFields ?? []).map((k: string) => fmtVal(r[k])).filter(Boolean).join(' · '),
      href: f.href,
    }))
    return { ...w, items }
  }
  return w
}
