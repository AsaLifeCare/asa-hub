// SCHEDULE BUILDER — the schedule template's config: who the columns are (`resources`: id/name/avatar/role), what…
// Rows then reference resources via `personId` and types via `type` — Generate rows wires those ids up for you.
import {
  AddRow,
  Field,
  RowMoves,
  SubHead,
  SwitchLine,
  TintDots,
} from './shared'
import { asArr, asBool, asNum, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'
import type { TintName } from '@/engine/types'
import { animalPhoto } from '@/lib/animals'

const VIEWS = ['week', 'month', 'day'] as const
const SLOT_MINUTES = [15, 20, 30, 60] as const

type ResourceRow = { id: string; name: string; avatar?: string; role?: string }

export default function ScheduleBuilder({ config, onChange }: BuilderProps) {
  const resources: ResourceRow[] = asArr<Record<string, unknown>>(config.resources).map((r) => ({
    ...asObj(r),
    id: asStr(r.id),
    name: asStr(r.name),
  })) as ResourceRow[]
  const eventTypes = Object.entries(asObj(config.eventTypes)) as [string, Record<string, unknown>][]
  const range = Array.isArray(config.timeRange) ? (config.timeRange as unknown[]) : [8, 19]
  const allowViews = asArr<string>(config.allowViews)

  const writeRes = (next: ResourceRow[]) => onChange({ ...config, resources: next })
  const patchRes = (i: number, p: Partial<ResourceRow>) => writeRes(resources.map((r, j) => (j === i ? { ...r, ...p } : r)))

  const writeTypes = (entries: [string, Record<string, unknown>][]) =>
    onChange({ ...config, eventTypes: Object.fromEntries(entries) })

  const toggleView = (v: string, on: boolean) => {
    const next = on ? [...new Set([...allowViews, v])] : allowViews.filter((x) => x !== v)
    onChange({ ...config, allowViews: next.length ? next : [v] })
  }

  return (
    <div className="space-y-4">
      {/* resources = the people/rooms the grid renders as columns */}
      <div className="space-y-2.5">
        <SubHead>Resources</SubHead>
        {resources.map((r, i) => (
          <div key={i} className="rounded-md border border-border bg-bg p-2.5">
            <div className="flex items-center gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <input value={r.id} onChange={(e) => patchRes(i, { id: e.target.value })} placeholder="r-1" className={`${inputCls} h-8 text-[12px]`} />
                <input value={r.name} onChange={(e) => patchRes(i, { name: e.target.value })} placeholder="Alex Rivera" className={`${inputCls} h-8 text-[12px]`} />
              </div>
              <RowMoves index={i} count={resources.length} onMove={(d) => writeRes(moveItem(resources, i, d))} onRemove={() => writeRes(resources.filter((_, j) => j !== i))} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={r.role ?? ''} onChange={(e) => patchRes(i, { role: e.target.value || undefined })} placeholder="Role (optional)" className={`${inputCls} h-8 text-[12px]`} />
              <input value={r.avatar ?? ''} onChange={(e) => patchRes(i, { avatar: e.target.value || undefined })} placeholder="Avatar URL (optional)" className={`${inputCls} h-8 text-[12px]`} />
            </div>
          </div>
        ))}
        <AddRow
          label="Add resource"
          onClick={() => writeRes([...resources, { id: `r-${resources.length + 1}`, name: `Person ${resources.length + 1}`, avatar: animalPhoto(resources.length) }])}
        />
      </div>

      {/* event types: key → {label, tint} */}
      <div className="space-y-2.5">
        <SubHead>Event types</SubHead>
        {eventTypes.map(([key, val], i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-bg p-2">
            <input
              value={key}
              onChange={(e) => writeTypes(eventTypes.map(([k, v], j) => [j === i ? e.target.value : k, v]))}
              placeholder="shift"
              className={`${inputCls} h-8 w-28 text-[12px]`}
            />
            <input
              value={asStr(val.label)}
              onChange={(e) => writeTypes(eventTypes.map(([k, v], j) => (j === i ? [k, { ...v, label: e.target.value }] : [k, v])))}
              placeholder="Shift"
              className={`${inputCls} h-8 flex-1 text-[12px]`}
            />
            <TintDots
              value={asStr(val.tint, 'blue') as TintName}
              onChange={(t) => writeTypes(eventTypes.map(([k, v], j) => (j === i ? [k, { ...v, tint: t }] : [k, v])))}
            />
            <RowMoves index={i} count={eventTypes.length} onMove={(d) => writeTypes(moveItem(eventTypes, i, d))} onRemove={() => writeTypes(eventTypes.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddRow
          label="Add event type"
          onClick={() => writeTypes([...eventTypes, [`type-${eventTypes.length + 1}`, { label: `Type ${eventTypes.length + 1}`, tint: 'blue' }]])}
        />
      </div>

      {/* grid chrome */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-bg p-2.5">
          <SubHead>Time grid</SubHead>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Field label="Start hour">
              <input type="number" min={0} max={23} value={asNum(range[0], 8)} onChange={(e) => onChange({ ...config, timeRange: [Number(e.target.value) || 0, asNum(range[1], 19)] })} className={inputCls} />
            </Field>
            <Field label="End hour">
              <input type="number" min={1} max={24} value={asNum(range[1], 19)} onChange={(e) => onChange({ ...config, timeRange: [asNum(range[0], 8), Number(e.target.value) || 24] })} className={inputCls} />
            </Field>
            <Field label="Slot minutes">
              <select value={asNum(config.slotMinutes, 30)} onChange={(e) => onChange({ ...config, slotMinutes: Number(e.target.value) })} className={inputCls}>
                {SLOT_MINUTES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="rounded-md border border-border bg-bg p-2.5">
          <SubHead>Views</SubHead>
          <div className="mt-2">
            <Field label="Default view">
              <select value={asStr(config.view, 'week')} onChange={(e) => onChange({ ...config, view: e.target.value })} className={inputCls}>
                {VIEWS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </Field>
            <div className="mt-2 flex flex-wrap gap-3">
              {VIEWS.map((v) => (
                <label key={v} className="flex cursor-pointer items-center gap-1.5 text-[12px] capitalize text-text-2">
                  <input
                    type="checkbox"
                    checked={allowViews.includes(v)}
                    onChange={(e) => toggleView(v, e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {v}
                </label>
              ))}
            </div>
            <div className="mt-2">
              <SwitchLine label="Mini month" checked={asBool(config.showMiniMonth, true)} onChange={(v) => onChange({ ...config, showMiniMonth: v })} />
              <SwitchLine label="Now line" checked={asBool(config.showNowLine, true)} onChange={(v) => onChange({ ...config, showNowLine: v })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
