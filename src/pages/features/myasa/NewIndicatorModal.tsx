// Add an indicator to your own page.
// The resource list is whatever the platform actually serves, read from the app registry — so a resource added next…
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useRegistryStore } from '@/stores/useRegistryStore'
import { ICON_GROUPS } from '@/lib/icons'
import { useDraftGuard } from '@/lib/useDraftGuard'
import type { ResourceName, TintName } from '@/engine/types'
import type { IndicatorSpec } from './layout'

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

const TINTS: TintName[] = ['blue', 'mint', 'lavender', 'peach', 'amber', 'pink']

export default function NewIndicatorModal({
  open,
  onOpenChange,
  onAdd,
  initial,
  title,
  submitLabel,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdd: (spec: IndicatorSpec) => void
  // Prefill — the edit path (a widget stays editable after it is created) and "start from this example" both open…
  initial?: Partial<IndicatorSpec>
  title?: string
  submitLabel?: string
}) {
  const apps = useRegistryStore((s) => s.apps)
  const [label, setLabel] = useState('')
  const [resource, setResource] = useState('')
  const [field, setField] = useState('')
  const [value, setValue] = useState('')
  const [tint, setTint] = useState<TintName>('blue')
  const [icon, setIcon] = useState('activity')
  const [chart, setChart] = useState<NonNullable<IndicatorSpec['chart']>>('number')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Unsaved-work reminder: the dialog counts as unfinished once label or resource were TOUCHED (differ from the…
  useDraftGuard({
    id: 'myasa-indicator',
    label: 'An unsaved dashboard indicator',
    dirty:
      open &&
      (label.trim() !== String(initial?.label ?? '').trim() ||
        resource !== String(initial?.resource ?? '')),
  })

  // Hydrate from the prefill each time the dialog OPENS — a dialog that kept the last edit's fields would quietly…
  useEffect(() => {
    if (!open) return
    setLabel(String(initial?.label ?? ''))
    setResource(String(initial?.resource ?? ''))
    setField(String(initial?.field ?? ''))
    setValue(String(initial?.value ?? ''))
    setTint((initial?.tint as TintName) || 'blue')
    setIcon(String(initial?.icon ?? 'activity'))
    setChart(initial?.chart ?? 'number')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill is read on open, not tracked
  }, [open])

  /** Every resource the platform serves, each with where it can be opened. */
  const resources = useMemo(() => {
    const map = new Map<string, string>()
    for (const app of apps) {
      for (const p of app.pages) {
        const r = p.dataSource?.resource as string | undefined
        if (r && !map.has(r)) map.set(r, `/app/${app.id}/${p.id}`)
      }
    }
    // the sky is servable too — a pseudo-resource the relay's /weather door answers (Columbus, OH), no sheet behind…
    if (!map.has('weather')) map.set('weather', '')
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [apps])

  const isWeather = resource === 'weather'
  // a chart that groups rows means nothing against the sky
  useEffect(() => {
    if (isWeather && (chart === 'donut' || chart === 'progress')) setChart('number')
  }, [isWeather, chart])

  useEffect(() => {
    if (!resource || resource === 'weather') {
      setRows([])
      return
    }
    let alive = true
    setLoading(true)
    api
      .list(resource as ResourceName)
      .then((r: any[]) => alive && setRows(Array.isArray(r) ? r : []))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [resource])

  /** Fields worth filtering on: few distinct short values, i.e. a status. */
  const fields = useMemo(() => {
    const sample = rows.slice(0, 80)
    const keys = new Set<string>()
    sample.forEach((r) => Object.keys(r ?? {}).forEach((k) => keys.add(k)))
    return [...keys].filter((k) => {
      const vals = new Set(
        sample.map((r) => String(r?.[k] ?? '').trim()).filter((v) => v && v.length <= 32),
      )
      return vals.size >= 2 && vals.size <= 12
    })
  }, [rows])

  const values = useMemo(() => {
    if (!field) return []
    return [...new Set(rows.map((r) => String(r?.[field] ?? '').trim()).filter(Boolean))].sort().slice(0, 30)
  }, [rows, field])

  const preview = useMemo(() => {
    if (!resource) return null
    if (!field || !value) return rows.length
    return rows.filter((r) => String(r?.[field] ?? '').trim().toLowerCase() === value.toLowerCase()).length
  }, [rows, resource, field, value])

  const submit = () => {
    if (!resource) return
    if (!isWeather && (chart === 'donut' || chart === 'bars') && !field) return
    if (!isWeather && chart === 'progress' && (!field || !value)) return
    onAdd({
      id: `ind-${Date.now().toString(36)}`,
      kind: 'indicator',
      label: label.trim() || (isWeather ? 'The weather' : resource),
      resource,
      field: isWeather ? undefined : field || undefined,
      value: isWeather ? undefined : field ? value || undefined : undefined,
      chart,
      tint,
      icon: isWeather && icon === 'activity' ? 'sun' : icon,
      href: resources.find(([r]) => r === resource)?.[1] || undefined,
    })
    setLabel('')
    setResource('')
    setField('')
    setValue('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title ?? 'Add an indicator'}</DialogTitle>
          <DialogDescription>A number on your page, counted live. Narrow it if you only care about part of it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Count what</span>
            <select className={inputCls} value={resource} onChange={(e) => { setResource(e.target.value); setField(''); setValue('') }}>
              <option value="">Choose…</option>
              {resources.map(([r]) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>

          {resource && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-text-2">Drawn as</span>
              <div className={isWeather ? 'grid grid-cols-4 gap-1' : 'grid grid-cols-5 gap-1'}>
                {(isWeather
                  ? ([
                      ['number', 'Now'], ['forecast', 'Week'], ['table', 'Days'], ['bars', 'Highs'],
                    ] as const)
                  : ([
                      ['number', 'Number'], ['donut', 'Donut'], ['bars', 'Bars'],
                      ['progress', 'Progress'], ['table', 'Table'],
                    ] as const)).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChart(id)}
                    className={
                      'h-8 rounded-md border text-[11.5px] font-semibold transition-colors ' +
                      (chart === id
                        ? 'border-primary bg-primary-soft text-primary-strong'
                        : 'border-border bg-surface text-text-2 hover:bg-surface-2')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!isWeather && (chart === 'donut' || chart === 'bars') && !field && (
                <span className="mt-1 block text-[11px] text-tint-fg-amber">Pick a "only where" field below — that is what the {chart === 'donut' ? 'ring' : 'bars'} group by.</span>
              )}
              {!isWeather && chart === 'progress' && (!field || !value) && (
                <span className="mt-1 block text-[11px] text-tint-fg-amber">Progress needs both a field and a value — the filled part of the bar.</span>
              )}
            </label>
          )}

          {!isWeather && resource && fields.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-text-2">Only where</span>
                <select className={inputCls} value={field} onChange={(e) => { setField(e.target.value); setValue('') }}>
                  <option value="">everything</option>
                  {fields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-text-2">is</span>
                <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} disabled={!field}>
                  <option value="">any</option>
                  {values.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Call it</span>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Referrals worth a call" />
          </label>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-[12px] font-semibold text-text-2">
              Colour
              <span className="flex gap-1">
                {TINTS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-label={t}
                    onClick={() => setTint(t)}
                    className={`h-6 w-6 rounded-full border-2 bg-tint-${t} ${tint === t ? 'border-primary' : 'border-transparent'}`}
                  />
                ))}
              </span>
            </label>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-text-2">
              Icon
              <select className="h-9 rounded-sm border border-border bg-surface px-2 text-[13px]" value={icon} onChange={(e) => setIcon(e.target.value)}>
                {(ICON_GROUPS[0]?.icons ?? ['activity']).slice(0, 24).map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </label>
          </div>

          {resource && (
            <p className="rounded-sm bg-surface-2 px-3 py-2 text-[12px] text-text-2">
              {isWeather
                ? 'A live forecast for Columbus, OH — refreshed every half hour.'
                : loading ? 'Counting…' : <>Right now that is <span className="font-bold text-text-1">{preview}</span>.</>}
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!resource}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitLabel ?? 'Add to my page'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
