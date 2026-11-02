// COLUMNS BUILDER — the sheet template's `columns` list as rows of key / label / kind, with the extras each kind…
// Above the list: the entity name pair and the sheet behavior switches; below: page size.
import type { TintName } from '@/engine/types'
import {
  AddRow,
  Field,
  RowMoves,
  SubHead,
  SwitchLine,
  TintByEditor,
} from './shared'
import { asArr, asBool, asNum, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'

/** The nine cell kinds the sheet engine renders (sheet/types.ts Column). */
const COLUMN_KINDS = ['text', 'avatar+text', 'chip', 'chips', 'date', 'number', 'progress', 'image', 'doc'] as const

type ColRow = {
  key: string
  label: string
  kind: string
  subKey?: string
  tintBy?: Record<string, TintName>
  width?: number
  sortable?: boolean
  max?: number
}

const readCols = (config: Record<string, unknown>): ColRow[] =>
  asArr<Record<string, unknown>>(config.columns).map((c) => ({ ...asObj(c), key: asStr(c.key), label: asStr(c.label), kind: asStr(c.kind, 'text') }) as ColRow)

export default function ColumnsBuilder({ config, onChange }: BuilderProps) {
  const cols = readCols(config)
  const entity = Array.isArray(config.entity) ? config.entity : ['record', 'records']
  const write = (columns: ColRow[]) => onChange({ ...config, columns })

  const patchCol = (i: number, patch: Partial<ColRow>) => {
    const next = cols.map((c, j) => {
      if (j !== i) return c
      const merged = { ...c, ...patch }
      // drop the extras that do not belong to the newly selected kind, so the written JSON never carries dead…
      if (merged.kind !== 'avatar+text') delete merged.subKey
      if (merged.kind !== 'chip' && merged.kind !== 'chips') delete merged.tintBy
      if (merged.kind !== 'chips') delete merged.max
      return merged
    })
    write(next)
  }

  return (
    <div className="space-y-4">
      {/* entity naming — the sheet template indexes this as [singular, plural] */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity (singular)">
          <input
            value={asStr(entity[0], 'record')}
            onChange={(e) => onChange({ ...config, entity: [e.target.value, asStr(entity[1], 'records')] })}
            placeholder="record"
            className={inputCls}
          />
        </Field>
        <Field label="Entity (plural)">
          <input
            value={asStr(entity[1], 'records')}
            onChange={(e) => onChange({ ...config, entity: [asStr(entity[0], 'record'), e.target.value] })}
            placeholder="records"
            className={inputCls}
          />
        </Field>
      </div>

      <div className="space-y-2.5">
        <SubHead>Columns</SubHead>
        {cols.map((c, i) => (
          <div key={i} className="rounded-md border border-border bg-bg p-2.5">
            <div className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Key">
                  <input value={c.key} onChange={(e) => patchCol(i, { key: e.target.value })} placeholder="status" className={inputCls} />
                </Field>
                <Field label="Label">
                  <input value={c.label} onChange={(e) => patchCol(i, { label: e.target.value })} placeholder="Status" className={inputCls} />
                </Field>
                <Field label="Kind">
                  <select value={c.kind} onChange={(e) => patchCol(i, { kind: e.target.value })} className={inputCls}>
                    {COLUMN_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="pt-5">
                <RowMoves index={i} count={cols.length} onMove={(d) => write(moveItem(cols, i, d))} onRemove={() => write(cols.filter((_, j) => j !== i))} />
              </div>
            </div>

            {/* kind-specific extras — only the keys the engine reads for it */}
            {(c.kind === 'avatar+text' || c.kind === 'chips' || c.kind === 'text') && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {c.kind === 'avatar+text' && (
                  <Field label="Subtitle key (subKey)">
                    <input value={c.subKey ?? ''} onChange={(e) => patchCol(i, { subKey: e.target.value })} placeholder="role" className={inputCls} />
                  </Field>
                )}
                {c.kind === 'chips' && (
                  <Field label="Max chips before +N">
                    <input
                      type="number"
                      min={1}
                      value={c.max ?? ''}
                      onChange={(e) => patchCol(i, { max: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="3"
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>
            )}
            {(c.kind === 'chip' || c.kind === 'chips') && (
              <div className="mt-2">
                <SubHead>Value → tint</SubHead>
                <div className="mt-1.5">
                  <TintByEditor map={c.tintBy ?? {}} onChange={(tintBy) => patchCol(i, { tintBy })} />
                </div>
              </div>
            )}

            <div className="mt-2 flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-2">
                <input
                  type="checkbox"
                  checked={c.sortable ?? false}
                  onChange={(e) => patchCol(i, { sortable: e.target.checked ? true : undefined })}
                  className="h-3.5 w-3.5 accent-primary"
                />
                Sortable
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-text-2">
                Width
                <input
                  type="number"
                  min={40}
                  value={c.width ?? ''}
                  onChange={(e) => patchCol(i, { width: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="auto"
                  className="h-7 w-20 rounded-sm border border-border bg-surface px-2 text-[12px] text-text-1 outline-none focus:border-primary"
                />
              </label>
            </div>
          </div>
        ))}
        <AddRow
          label="Add column"
          onClick={() => write([...cols, { key: `field${cols.length + 1}`, label: `Field ${cols.length + 1}`, kind: 'text' }])}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-bg p-2.5">
          <SubHead>Behavior</SubHead>
          <SwitchLine label="Searchable" checked={asBool(config.searchable, true)} onChange={(v) => onChange({ ...config, searchable: v })} />
          <SwitchLine label="Selectable rows" checked={asBool(config.selectable)} onChange={(v) => onChange({ ...config, selectable: v })} />
          <SwitchLine label="Table/cards view toggle" checked={asBool(config.viewToggle)} onChange={(v) => onChange({ ...config, viewToggle: v })} />
          <SwitchLine label="Density toggle" checked={asBool(config.densityToggle)} onChange={(v) => onChange({ ...config, densityToggle: v })} />
        </div>
        <div className="rounded-md border border-border bg-bg p-2.5">
          <SubHead>Pagination</SubHead>
          <Field label="Rows per page">
            <input
              type="number"
              min={5}
              value={asNum(asObj(config.pagination).pageSize, 0) || ''}
              onChange={(e) =>
                onChange({
                  ...config,
                  pagination: { ...asObj(config.pagination), pageSize: e.target.value ? Number(e.target.value) : undefined },
                })
              }
              placeholder="25"
              className={inputCls}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}
