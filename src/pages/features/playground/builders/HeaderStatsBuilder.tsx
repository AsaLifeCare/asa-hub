// HEADER + STATS + SECTIONS BUILDER — the detail template's three config blocks.
// The header maps record keys into the hero (`title`, `subtitle`, `avatar` — a photo key or the literal "initials"…
import type { TintName } from '@/engine/types'
import {
  AddRow,
  Field,
  IconSelect,
  RowMoves,
  SubHead,
  TintByEditor,
  TintDots,
} from './shared'
import { asArr, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'

const SECTION_KINDS = [
  { id: 'fields', label: 'Fields (label → record key)' },
  { id: 'chips', label: 'Chips (record key with an array)' },
  { id: 'list', label: 'List (record key with an array)' },
  { id: 'timeline', label: 'Timeline (record key with entries)' },
] as const

export default function HeaderStatsBuilder({ config, onChange }: BuilderProps) {
  const header = asObj(config.header)
  const chip = asObj(header.statusChip)
  const stats = asArr<Record<string, unknown>>(config.stats).map((s) => asObj(s))
  const sections = asArr<Record<string, unknown>>(config.sections).map((s) => asObj(s))

  const patchHeader = (p: Record<string, unknown>) => onChange({ ...config, header: { ...header, ...p } })

  return (
    <div className="space-y-4">
      {/* hero header */}
      <div className="rounded-md border border-border bg-bg p-2.5">
        <SubHead>Header (record key mappings)</SubHead>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="Title key"><input value={asStr(header.title)} onChange={(e) => patchHeader({ title: e.target.value })} placeholder="name" className={inputCls} /></Field>
          <Field label="Subtitle key"><input value={asStr(header.subtitle)} onChange={(e) => patchHeader({ subtitle: e.target.value || undefined })} placeholder="role" className={inputCls} /></Field>
          <Field label="Avatar key (or “initials”)"><input value={asStr(header.avatar)} onChange={(e) => patchHeader({ avatar: e.target.value || undefined })} placeholder="avatar" className={inputCls} /></Field>
        </div>
        <div className="mt-2">
          <Field label="Status chip field">
            <input
              value={asStr(chip.field)}
              onChange={(e) => patchHeader({ statusChip: { ...chip, field: e.target.value } })}
              placeholder="status"
              className={inputCls}
            />
          </Field>
          <div className="mt-2">
            <SubHead>Chip value → tint</SubHead>
            <div className="mt-1.5">
              <TintByEditor
                map={(chip.tintBy as Record<string, TintName>) ?? {}}
                onChange={(tintBy) => patchHeader({ statusChip: { ...chip, tintBy } })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* stat tiles */}
      <div className="space-y-2.5">
        <SubHead>Stats</SubHead>
        {stats.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-bg p-2">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={asStr(s.label)} onChange={(e) => onChange({ ...config, stats: stats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className={`${inputCls} h-8 text-[12px]`} />
              <input value={asStr(s.value)} onChange={(e) => onChange({ ...config, stats: stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder="record key" className={`${inputCls} h-8 text-[12px]`} />
            </div>
            <div className="w-[150px] shrink-0">
              <IconSelect value={asStr(s.icon)} onChange={(n) => onChange({ ...config, stats: stats.map((x, j) => (j === i ? { ...x, icon: n } : x)) })} />
            </div>
            <TintDots value={asStr(s.tint, 'blue') as TintName} onChange={(t) => onChange({ ...config, stats: stats.map((x, j) => (j === i ? { ...x, tint: t } : x)) })} />
            <RowMoves index={i} count={stats.length} onMove={(d) => onChange({ ...config, stats: moveItem(stats, i, d) })} onRemove={() => onChange({ ...config, stats: stats.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <AddRow label="Add stat" onClick={() => onChange({ ...config, stats: [...stats, { label: 'New stat', value: 'score', icon: 'star', tint: 'blue' }] })} />
      </div>

      {/* sections */}
      <div className="space-y-2.5">
        <SubHead>Sections</SubHead>
        {sections.map((s, i) => {
          const kind = asStr(s.kind, 'fields')
          const patchS = (p: Record<string, unknown>) =>
            onChange({ ...config, sections: sections.map((x, j) => (j === i ? { ...x, ...p } : x)) })
          const fields = asArr<Record<string, unknown>>(s.fields).map((f) => asObj(f))
          return (
            <div key={i} className="rounded-md border border-border bg-bg p-2.5">
              <div className="flex items-center gap-2">
                <select
                  value={kind}
                  onChange={(e) => {
                    const k = e.target.value
                    // swap the kind and seed the one key that kind reads
                    if (k === 'fields') patchS({ kind: k, fields: fields.length ? fields : [{ label: 'Email', value: 'email' }], itemsField: undefined, entriesField: undefined })
                    else if (k === 'chips') patchS({ kind: k, itemsField: asStr(s.itemsField, 'skills'), fields: undefined, entriesField: undefined })
                    else if (k === 'list') patchS({ kind: k, itemsField: asStr(s.itemsField, 'items'), fields: undefined, entriesField: undefined })
                    else patchS({ kind: k, entriesField: asStr(s.entriesField, 'entries'), fields: undefined, itemsField: undefined })
                  }}
                  className={`${inputCls} h-8 w-44 text-[12px]`}
                >
                  {SECTION_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>{k.label}</option>
                  ))}
                </select>
                <input value={asStr(s.title)} onChange={(e) => patchS({ title: e.target.value })} placeholder="Section title" className={`${inputCls} h-8 flex-1 text-[12px]`} />
                <RowMoves index={i} count={sections.length} onMove={(d) => onChange({ ...config, sections: moveItem(sections, i, d) })} onRemove={() => onChange({ ...config, sections: sections.filter((_, j) => j !== i) })} />
              </div>

              {kind === 'fields' && (
                <div className="mt-2 space-y-1.5">
                  {fields.map((f, fi) => (
                    <div key={fi} className="flex items-center gap-2">
                      <input value={asStr(f.label)} onChange={(e) => patchS({ fields: fields.map((x, j) => (j === fi ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className={`${inputCls} h-8 text-[12px]`} />
                      <input value={asStr(f.value)} onChange={(e) => patchS({ fields: fields.map((x, j) => (j === fi ? { ...x, value: e.target.value } : x)) })} placeholder="record key" className={`${inputCls} h-8 text-[12px]`} />
                      <RowMoves index={fi} count={fields.length} onMove={(d) => patchS({ fields: moveItem(fields, fi, d) })} onRemove={() => patchS({ fields: fields.filter((_, j) => j !== fi) })} />
                    </div>
                  ))}
                  <AddRow small label="Add field" onClick={() => patchS({ fields: [...fields, { label: '', value: '' }] })} />
                </div>
              )}
              {kind === 'chips' && (
                <div className="mt-2">
                  <Field label="Record key holding the chip array">
                    <input value={asStr(s.itemsField)} onChange={(e) => patchS({ itemsField: e.target.value })} placeholder="skills" className={inputCls} />
                  </Field>
                </div>
              )}
              {kind === 'list' && (
                <div className="mt-2">
                  <Field label="Record key holding the items">
                    <input value={asStr(s.itemsField)} onChange={(e) => patchS({ itemsField: e.target.value })} placeholder="items" className={inputCls} />
                  </Field>
                </div>
              )}
              {kind === 'timeline' && (
                <div className="mt-2">
                  <Field label="Record key holding the entries">
                    <input value={asStr(s.entriesField)} onChange={(e) => patchS({ entriesField: e.target.value })} placeholder="entries" className={inputCls} />
                  </Field>
                </div>
              )}
            </div>
          )
        })}
        <AddRow label="Add section" onClick={() => onChange({ ...config, sections: [...sections, { kind: 'fields', title: 'Details', fields: [{ label: 'Email', value: 'email' }] }] })} />
      </div>
    </div>
  )
}
