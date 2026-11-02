// WIDGETS BUILDER — the dashboard template's `widgets` array plus the `greeting` header.
// Each widget kind gets the mini form for exactly the keys the engine renders (dashboard/index.tsx renderWidget)…
import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { TintName } from '@/engine/types'
import {
  AddRow,
  Field,
  IconSelect,
  RowMoves,
  SubHead,
  TintDots,
} from './shared'
import { asArr, asNum, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'

/** Widget kinds the dashboard engine renders, in gallery order. */
const WIDGET_KINDS: { id: string; label: string }[] = [
  { id: 'stat', label: 'Stat' },
  { id: 'ring', label: 'Goal ring' },
  { id: 'donut', label: 'Donut' },
  { id: 'bars', label: 'Ranked bars' },
  { id: 'area', label: 'Area chart' },
  { id: 'list', label: 'List' },
  { id: 'feed', label: 'Feed' },
  { id: 'note', label: 'Sticky note' },
  { id: 'links', label: 'Quick links' },
  { id: 'actions', label: 'Quick actions' },
  { id: 'weather', label: 'Weather' },
  { id: 'clock', label: 'Clock' },
]

/** What "Add widget" seeds per kind — mirrors the engine's KIND_DEFAULTS. */
function blankWidget(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'stat':
      return { kind, label: 'New metric', value: 42, delta: '+3', deltaLabel: 'this week', tint: 'blue', spark: [4, 6, 5, 8, 7, 9, 11] }
    case 'ring':
      return { kind, title: 'Goal', percent: 50, tint: 'mint', caption: 'Half way there' }
    case 'donut':
      return { kind, title: 'Breakdown', centerLabel: 'total', slices: [{ label: 'Group A', value: 8, tint: 'mint' }, { label: 'Group B', value: 5, tint: 'lavender' }] }
    case 'bars':
      return { kind, title: 'Ranked bars', bars: [{ label: 'First', value: 12, tint: 'mint' }, { label: 'Second', value: 7, tint: 'blue' }] }
    case 'area':
      return { kind, title: 'Trend', series: [{ name: 'Series A', color: 'mint', points: [4, 8, 6, 10, 9, 13] }] }
    case 'list':
      return { kind, title: 'Pinned items', items: [{ icon: 'star', tint: 'mint', title: 'First item', meta: 'Added just now' }] }
    case 'note':
      return { kind, title: 'Remember', tint: 'amber', text: 'A sticky note for the team.' }
    case 'links':
      return { kind, title: 'Quick links', links: [{ icon: 'layout-grid', label: 'App Hub', href: '/apps' }] }
    case 'actions':
      return { kind, title: 'Quick actions', actions: [{ icon: 'zap', label: 'Do the thing', tint: 'mint', href: '/apps' }] }
    case 'weather':
      return { kind, title: 'Weather', city: 'Canton, OH' }
    default:
      return { kind, title: kind === 'feed' ? 'Activity' : 'Clock' }
  }
}

/* -------- small repeated editors -------- */

/** label/value/tint rows — donut slices and ranked bars share this shape. */
function SliceList({ items, onChange }: { items: Record<string, unknown>[]; onChange: (next: Record<string, unknown>[]) => void }) {
  const patch = (i: number, p: Record<string, unknown>) => onChange(items.map((s, j) => (j === i ? { ...s, ...p } : s)))
  return (
    <div className="space-y-1.5">
      {items.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={asStr(s.label)} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Label" className={`${inputCls} h-8 flex-1 text-[12px]`} />
          <input
            type="number"
            value={asNum(s.value)}
            onChange={(e) => patch(i, { value: Number(e.target.value) || 0 })}
            className={`${inputCls} h-8 w-20 text-[12px]`}
          />
          <TintDots value={asStr(s.tint, 'blue') as TintName} onChange={(t) => patch(i, { tint: t })} />
          <RowMoves index={i} count={items.length} onMove={(d) => onChange(moveItem(items, i, d))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddRow small label="Add slice" onClick={() => onChange([...items, { label: `Group ${items.length + 1}`, value: 1, tint: 'blue' }])} />
    </div>
  )
}

/** icon/tint + two text fields rows — list items, links and actions. */
function IconRowList({
  items,
  onChange,
  firstKey,
  secondKey,
  addLabel,
}: {
  items: Record<string, unknown>[]
  onChange: (next: Record<string, unknown>[]) => void
  firstKey: string
  secondKey: string
  addLabel: string
}) {
  const patch = (i: number, p: Record<string, unknown>) => onChange(items.map((s, j) => (j === i ? { ...s, ...p } : s)))
  return (
    <div className="space-y-1.5">
      {items.map((s, i) => (
        <div key={i} className="rounded-md border border-border bg-surface p-2">
          <div className="flex items-center gap-2">
            <div className="w-[150px] shrink-0">
              <IconSelect value={asStr(s.icon)} onChange={(n) => patch(i, { icon: n })} />
            </div>
            <TintDots value={asStr(s.tint, 'blue') as TintName} onChange={(t) => patch(i, { tint: t })} />
            <div className="ml-auto">
              <RowMoves index={i} count={items.length} onMove={(d) => onChange(moveItem(items, i, d))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <input value={asStr(s[firstKey])} onChange={(e) => patch(i, { [firstKey]: e.target.value })} placeholder={firstKey} className={`${inputCls} h-8 text-[12px]`} />
            <input value={asStr(s[secondKey])} onChange={(e) => patch(i, { [secondKey]: e.target.value })} placeholder={secondKey} className={`${inputCls} h-8 text-[12px]`} />
          </div>
        </div>
      ))}
      <AddRow small label={addLabel} onClick={() => onChange([...items, { icon: 'star', tint: 'blue', [firstKey]: '', [secondKey]: '' }])} />
    </div>
  )
}

// Comma-separated number list, uncontrolled on purpose: a controlled input would re-format on every keystroke and…
function NumList({ value, onChange, placeholder }: { value: number[]; onChange: (next: number[]) => void; placeholder?: string }) {
  return (
    <input
      key={value.join(',')}
      defaultValue={value.join(', ')}
      onBlur={(e) => onChange(e.target.value.split(',').map((s) => Number(s.trim())).filter((n) => isFinite(n)))}
      placeholder={placeholder ?? '4, 6, 5, 8'}
      className={inputCls}
    />
  )
}

function WidgetFields({ w, patch }: { w: Record<string, unknown>; patch: (p: Record<string, unknown>) => void }) {
  const kind = asStr(w.kind)
  const tint = asStr(w.tint, 'blue') as TintName
  switch (kind) {
    case 'stat':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Label"><input value={asStr(w.label)} onChange={(e) => patch({ label: e.target.value })} className={inputCls} /></Field>
            <Field label="Value"><input value={asStr(w.value)} onChange={(e) => patch({ value: e.target.value })} className={inputCls} /></Field>
            <Field label="Delta"><input value={asStr(w.delta)} onChange={(e) => patch({ delta: e.target.value || undefined })} placeholder="+2" className={inputCls} /></Field>
            <Field label="Delta label"><input value={asStr(w.deltaLabel)} onChange={(e) => patch({ deltaLabel: e.target.value || undefined })} placeholder="this week" className={inputCls} /></Field>
          </div>
          <Field label="Sparkline (numbers)" className="mt-2"><NumList value={asArr<number>(w.spark)} onChange={(spark) => patch({ spark })} /></Field>
          <div className="mt-2"><TintDots value={tint} onChange={(t) => patch({ tint: t })} /></div>
        </>
      )
    case 'ring':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
            <Field label="Percent"><input type="number" min={0} max={100} value={asNum(w.percent)} onChange={(e) => patch({ percent: Number(e.target.value) || 0 })} className={inputCls} /></Field>
          </div>
          <Field label="Caption" className="mt-2"><input value={asStr(w.caption)} onChange={(e) => patch({ caption: e.target.value || undefined })} placeholder="of target" className={inputCls} /></Field>
          <div className="mt-2"><TintDots value={tint} onChange={(t) => patch({ tint: t })} /></div>
        </>
      )
    case 'donut':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
            <Field label="Center label"><input value={asStr(w.centerLabel)} onChange={(e) => patch({ centerLabel: e.target.value || undefined })} className={inputCls} /></Field>
          </div>
          <div className="mt-2"><SubHead>Slices</SubHead><div className="mt-1.5"><SliceList items={asArr(w.slices)} onChange={(slices) => patch({ slices })} /></div></div>
        </>
      )
    case 'bars':
      return (
        <>
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <div className="mt-2"><SubHead>Bars</SubHead><div className="mt-1.5"><SliceList items={asArr(w.bars)} onChange={(bars) => patch({ bars })} /></div></div>
        </>
      )
    case 'area':
      return (
        <>
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <div className="mt-2 space-y-2">
            <SubHead>Series</SubHead>
            {asArr<Record<string, unknown>>(w.series).map((s, i, all) => (
              <div key={i} className="flex items-center gap-2">
                <input value={asStr(s.name)} onChange={(e) => patch({ series: all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Name" className={`${inputCls} h-8 w-28 text-[12px]`} />
                <div className="min-w-0 flex-1">
                  <NumList value={asArr<number>(s.points)} onChange={(points) => patch({ series: all.map((x, j) => (j === i ? { ...x, points } : x)) })} />
                </div>
                <TintDots value={asStr(s.color, 'mint') as TintName} onChange={(t) => patch({ series: all.map((x, j) => (j === i ? { ...x, color: t } : x)) })} />
                <RowMoves index={i} count={all.length} onMove={(d) => patch({ series: moveItem(all, i, d) })} onRemove={() => patch({ series: all.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <AddRow small label="Add series" onClick={() => patch({ series: [...asArr(w.series), { name: `Series ${asArr(w.series).length + 1}`, color: 'blue', points: [2, 4, 3, 6] }] })} />
          </div>
        </>
      )
    case 'list':
      return (
        <>
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <div className="mt-2"><SubHead>Items</SubHead><div className="mt-1.5"><IconRowList items={asArr(w.items)} onChange={(items) => patch({ items })} firstKey="title" secondKey="meta" addLabel="Add item" /></div></div>
        </>
      )
    case 'note':
      return (
        <>
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <Field label="Text" className="mt-2"><input value={asStr(w.text)} onChange={(e) => patch({ text: e.target.value })} className={inputCls} /></Field>
          <div className="mt-2"><TintDots value={tint} onChange={(t) => patch({ tint: t })} /></div>
        </>
      )
    case 'links':
      return (
        <>
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <div className="mt-2"><SubHead>Links</SubHead><div className="mt-1.5"><IconRowList items={asArr(w.links)} onChange={(links) => patch({ links })} firstKey="label" secondKey="href" addLabel="Add link" /></div></div>
        </>
      )
    case 'actions':
      return (
        <>
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <div className="mt-2"><SubHead>Actions</SubHead><div className="mt-1.5"><IconRowList items={asArr(w.actions)} onChange={(actions) => patch({ actions })} firstKey="label" secondKey="href" addLabel="Add action" /></div></div>
        </>
      )
    case 'weather':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
          <Field label="City"><input value={asStr(w.city)} onChange={(e) => patch({ city: e.target.value })} className={inputCls} /></Field>
        </div>
      )
    case 'feed':
      return <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value })} className={inputCls} /></Field>
    default:
      return <Field label="Title"><input value={asStr(w.title)} onChange={(e) => patch({ title: e.target.value || undefined })} className={inputCls} /></Field>
  }
}

export default function WidgetsBuilder({ config, onChange }: BuilderProps) {
  const widgets = asArr<Record<string, unknown>>(config.widgets).map((w) => asObj(w))
  const greeting = asObj(config.greeting)
  const [addKind, setAddKind] = useState('stat')
  const patch = (i: number, p: Record<string, unknown>) =>
    onChange({ ...config, widgets: widgets.map((w, j) => (j === i ? { ...w, ...p } : w)) })

  return (
    <div className="space-y-4">
      {/* greeting — the dashboard either greets or falls back to PageHeader */}
      <div className="rounded-md border border-border bg-bg p-2.5">
        <SubHead>Greeting</SubHead>
        {config.greeting ? (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Name"><input value={asStr(greeting.name)} onChange={(e) => onChange({ ...config, greeting: { ...greeting, name: e.target.value } })} placeholder="Alex" className={inputCls} /></Field>
            <Field label="Subtitle"><input value={asStr(greeting.subtitle)} onChange={(e) => onChange({ ...config, greeting: { ...greeting, subtitle: e.target.value } })} placeholder="Here is today." className={inputCls} /></Field>
          </div>
        ) : (
          <div className="mt-1.5">
            <AddRow small label="Add greeting" onClick={() => onChange({ ...config, greeting: { name: 'there', subtitle: 'A first look at your new app.' } })} />
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <SubHead>Widgets</SubHead>
        {widgets.map((w, i) => (
          <div key={i} className="rounded-md border border-border bg-bg p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-2">{asStr(w.kind, '?')}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-1">{asStr(w.title) || asStr(w.label) || 'Widget'}</span>
              <RowMoves index={i} count={widgets.length} onMove={(d) => onChange({ ...config, widgets: moveItem(widgets, i, d) })} onRemove={() => onChange({ ...config, widgets: widgets.filter((_, j) => j !== i) })} />
            </div>
            <WidgetFields w={w} patch={(p) => patch(i, p)} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select value={addKind} onChange={(e) => setAddKind(e.target.value)} className={`${inputCls} h-8 flex-1 text-[12px]`}>
            {WIDGET_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange({ ...config, widgets: [...widgets, blankWidget(addKind)] })}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
          >
            <Plus size={12} /> Add widget
          </button>
        </div>
      </div>
    </div>
  )
}
