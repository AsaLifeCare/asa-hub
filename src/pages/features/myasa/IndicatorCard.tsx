// A widget: a live reading this person wanted on their own page.
// FIVE STYLES, ONE LAW — widgets in a range of styles, tables and pie drawings among them: the spec stays a RECIPE…
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import Card from '@/components/shared/Card'
import { AppIcon } from '@/lib/icons'
import { api } from '@/lib/api'
import { readerSentence } from '@/lib/readerError'
import { keptForecast, loadForecast, type Forecast } from '@/lib/weather'
import WeatherGlyph, { weatherLabel } from '@/components/shared/WeatherGlyph'
import { TINT_PAIR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { ResourceName } from '@/engine/types'
import type { IndicatorSpec } from './layout'

// 'weather' is a pseudo-resource: it reads the relay's /weather door, not a sheet — the ONE widget whose rows are…
export const WEATHER_RESOURCE = 'weather'

function weekdayShort(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

/** the ring/bars palette — lucide-free, theme-aware via currentColor */
const SLICE_TEXT = [
  'text-tint-fg-blue', 'text-tint-fg-mint', 'text-tint-fg-amber',
  'text-tint-fg-pink', 'text-tint-fg-lavender', 'text-tint-fg-peach',
]
const SLICE_BG = [
  'bg-tint-fg-blue', 'bg-tint-fg-mint', 'bg-tint-fg-amber',
  'bg-tint-fg-pink', 'bg-tint-fg-lavender', 'bg-tint-fg-peach',
]

type AnyRow = Record<string, unknown>

/** rows grouped by the spec's field — top 5 named groups + "other" */
function groupRows(rows: AnyRow[], field: string): { name: string; count: number }[] {
  const m = new Map<string, number>()
  rows.forEach((r) => {
    const v = String(r?.[field] ?? '').trim() || '(blank)'
    m.set(v, (m.get(v) ?? 0) + 1)
  })
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, 5).map(([name, count]) => ({ name, count }))
  const rest = sorted.slice(5).reduce((a, [, c]) => a + c, 0)
  if (rest > 0) top.push({ name: 'other', count: rest })
  return top
}

/** the row's best human label — name-ish fields first, any string after */
function rowLabel(r: AnyRow): string {
  for (const k of ['name', 'title', 'label', 'client', 'person', 'employee_name', 'display_name', 'destination', 'subject']) {
    const v = String(r?.[k] ?? '').trim()
    if (v) return v
  }
  for (const k of Object.keys(r ?? {})) {
    if (k === 'id') continue
    const v = String(r?.[k] ?? '').trim()
    if (v && v.length <= 60) return v
  }
  return '—'
}

export default function IndicatorCard({ spec }: { spec: IndicatorSpec }) {
  const [rows, setRows] = useState<AnyRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  /** a refusal that explains itself (lib/readerError), said under the dash */
  const [why, setWhy] = useState('')
  const [wx, setWx] = useState<Forecast | null>(() => keptForecast())
  const chart = spec.chart ?? 'number'
  const isWeather = spec.resource === WEATHER_RESOURCE

  useEffect(() => {
    let alive = true
    setFailed(false)
    setWhy('')
    if (isWeather) {
      // the sky comes from the relay's cached door, never from a sheet
      loadForecast().then((f) => {
        if (!alive) return
        if (f) { setWx(f); setRows([]) } else setFailed(true)
      })
      return () => { alive = false }
    }
    api
      .list(spec.resource as ResourceName)
      .then((r: AnyRow[]) => { if (alive) setRows(Array.isArray(r) ? r : []) })
      .catch((e) => { if (alive) { setWhy(readerSentence(e)); setFailed(true) } })
    return () => { alive = false }
  }, [spec.resource, isWeather])

  const matched = useMemo(() => {
    const list = rows ?? []
    return spec.field && spec.value
      ? list.filter((r) => String(r?.[spec.field as string] ?? '').trim().toLowerCase() === spec.value!.trim().toLowerCase())
      : list
  }, [rows, spec.field, spec.value])

  const groups = useMemo(
    () => (rows && spec.field && (chart === 'donut' || chart === 'bars') ? groupRows(rows, spec.field) : []),
    [rows, spec.field, chart],
  )

  const source = failed
    ? why || 'Could not read this right now'
    : isWeather
      ? `${wx?.place ?? 'Columbus, OH'} · live forecast`
      : chart === 'donut' || chart === 'bars'
      ? `${spec.resource} by ${spec.field ?? '?'}`
      : chart === 'progress'
        ? `${spec.resource} where ${spec.field} is ${spec.value}, over all`
        : chart === 'table'
          ? `newest rows in ${spec.resource}`
          : spec.field && spec.value
            ? `${spec.resource} where ${spec.field} is ${spec.value}`
            : `all rows in ${spec.resource}`

  const head = (
    <div className="flex items-start justify-between gap-3">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', TINT_PAIR(spec.tint ?? 'blue'))}>
        <AppIcon name={spec.icon ?? 'activity'} size={17} />
      </span>
      {spec.href && <AppIcon name="arrow-up-right" size={14} className="text-text-3" />}
    </div>
  )

  const foot = (
    <>
      <p className="mt-1 text-[13px] font-semibold text-text-1">{spec.label}</p>
      <p className="mt-0.5 text-[11px] text-text-3">{source}</p>
    </>
  )

  let middle: React.ReactNode = null
  if (failed) {
    middle = <p className="mt-3 font-stat text-[30px] font-bold leading-none text-text-1">—</p>
  } else if (isWeather) {
    // THE SKY, in the bank's own styles: number = right now; table = the next days listed; bars = the highs…
    if (!wx) {
      middle = <p className="mt-3 font-stat text-[30px] font-bold leading-none text-text-1">&nbsp;</p>
    } else if (chart === 'table') {
      middle = (
        <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-md border border-border">
          {wx.days.slice(0, 5).map((d) => (
            <div key={d.date} className="flex items-center gap-2 px-2 py-1.5 text-[11.5px] leading-4">
              <span className="w-9 shrink-0 font-semibold text-text-2">{weekdayShort(d.date)}</span>
              <WeatherGlyph icon={d.icon} className="h-3.5 w-3.5 shrink-0" />
              <span className="clamp-1 min-w-0 flex-1 text-text-2">{weatherLabel(d.icon)}</span>
              <span className="shrink-0 tabular-nums text-text-1">{d.tmax ?? '—'}°</span>
              <span className="shrink-0 tabular-nums text-text-3">{d.tmin ?? '—'}°</span>
            </div>
          ))}
        </div>
      )
    } else if (chart === 'bars') {
      const days = wx.days.slice(0, 7)
      const max = Math.max(...days.map((d) => d.tmax ?? 0), 1)
      middle = (
        <div className="mt-3 space-y-1.5">
          {days.map((d, i) => (
            <div key={d.date} className="flex items-center gap-2 text-[11px] leading-4">
              <span className="w-9 shrink-0 text-text-2">{weekdayShort(d.date)}</span>
              <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div className={cn('h-full rounded-full', SLICE_BG[i % SLICE_BG.length])} style={{ width: `${((d.tmax ?? 0) / max) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right tabular-nums text-text-3">{d.tmax ?? '—'}°</span>
            </div>
          ))}
        </div>
      )
    } else if (chart === 'forecast') {
      middle = (
        <div className="mt-3 grid grid-cols-7 gap-1">
          {wx.days.slice(0, 7).map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1 rounded-md bg-surface-2/60 px-0.5 py-2" title={`${weatherLabel(d.icon)} · ${d.tmax ?? '—'}°/${d.tmin ?? '—'}°`}>
              <span className="text-[9.5px] font-bold uppercase text-text-3">{weekdayShort(d.date)}</span>
              <WeatherGlyph icon={d.icon} className="h-4 w-4" />
              <span className="text-[10.5px] font-semibold tabular-nums text-text-1">{d.tmax ?? '—'}°</span>
              <span className="text-[9.5px] tabular-nums text-text-3">{d.tmin ?? '—'}°</span>
            </div>
          ))}
        </div>
      )
    } else {
      middle = (
        <div className="mt-3 flex items-center gap-3">
          <WeatherGlyph icon={wx.now.icon} className="h-9 w-9" />
          <div>
            <p className="font-stat text-[30px] font-bold leading-none text-text-1">{wx.now.temp ?? '—'}°</p>
            <p className="mt-0.5 text-[11.5px] text-text-3">
              {weatherLabel(wx.now.icon)}
              {wx.days[0] ? ` · ${wx.days[0].tmax ?? '—'}°/${wx.days[0].tmin ?? '—'}°` : ''}
              {wx.now.wind != null ? ` · wind ${wx.now.wind} mph` : ''}
            </p>
          </div>
        </div>
      )
    }
  } else if (rows === null) {
    middle = <p className="mt-3 font-stat text-[30px] font-bold leading-none text-text-1">&nbsp;</p>
  } else if (chart === 'donut' && groups.length > 0) {
    const total = groups.reduce((a, g) => a + g.count, 0)
    let acc = 0
    const C = 2 * Math.PI * 15.9
    middle = (
      <div className="mt-3 flex items-center gap-3">
        <svg viewBox="0 0 42 42" className="h-[76px] w-[76px] shrink-0 -rotate-90">
          {groups.map((g, i) => {
            const frac = g.count / total
            const el = (
              <circle
                key={g.name}
                cx="21" cy="21" r="15.9" fill="none" strokeWidth="6"
                className={cn(SLICE_TEXT[i % SLICE_TEXT.length], 'stroke-current')}
                strokeDasharray={`${frac * C} ${C}`}
                strokeDashoffset={-acc * C}
              />
            )
            acc += frac
            return el
          })}
        </svg>
        <div className="min-w-0 flex-1 space-y-0.5">
          {groups.map((g, i) => (
            <div key={g.name} className="flex items-center gap-1.5 text-[11px] leading-4">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', SLICE_BG[i % SLICE_BG.length])} />
              <span className="clamp-1 min-w-0 flex-1 text-text-2">{g.name}</span>
              <span className="shrink-0 tabular-nums text-text-3">{g.count}</span>
            </div>
          ))}
        </div>
      </div>
    )
  } else if (chart === 'bars' && groups.length > 0) {
    const max = Math.max(...groups.map((g) => g.count), 1)
    middle = (
      <div className="mt-3 space-y-1.5">
        {groups.map((g, i) => (
          <div key={g.name} className="flex items-center gap-2 text-[11px] leading-4">
            <span className="clamp-1 w-[88px] shrink-0 text-text-2" title={g.name}>{g.name}</span>
            <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className={cn('h-full rounded-full', SLICE_BG[i % SLICE_BG.length])} style={{ width: `${(g.count / max) * 100}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right tabular-nums text-text-3">{g.count}</span>
          </div>
        ))}
      </div>
    )
  } else if (chart === 'progress') {
    const total = (rows ?? []).length
    const pct = total > 0 ? Math.round((matched.length / total) * 100) : 0
    middle = (
      <div className="mt-4">
        <div className="flex items-baseline gap-2">
          <span className="font-stat text-[26px] font-bold leading-none text-text-1">{matched.length}</span>
          <span className="text-[12px] text-text-3">of {total} · {pct}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div className={cn('h-full rounded-full', SLICE_BG[0])} style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  } else if (chart === 'table') {
    const newest = [...(rows ?? [])].slice(-5).reverse()
    middle = newest.length === 0 ? (
      <p className="mt-3 text-[12px] italic text-text-3">Nothing in this table yet.</p>
    ) : (
      <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-md border border-border">
        {newest.map((r, i) => (
          <div key={String(r.id ?? i)} className="flex items-center gap-2 px-2 py-1.5 text-[11.5px] leading-4">
            <span className="clamp-1 min-w-0 flex-1 text-text-1">{rowLabel(r)}</span>
            {spec.field && (
              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-text-3">
                {String(r?.[spec.field] ?? '') || '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  } else {
    middle = (
      <p className="mt-3 font-stat text-[30px] font-bold leading-none text-text-1">
        {matched.length.toLocaleString()}
      </p>
    )
  }

  const body = (
    <>
      {head}
      {middle}
      {foot}
    </>
  )

  return (
    <Card className={spec.href ? 'transition-colors hover:bg-surface-2' : undefined}>
      {spec.href ? (
        <Link to={spec.href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  )
}
