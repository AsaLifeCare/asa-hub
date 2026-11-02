// KEY-MAP BUILDER — gallery, checklist and timeline are pure key-mapping templates: the config says which row key…
// This builder renders those as labelled inputs (each with the engine's default as placeholder), plus the few…
import type { PageType, TintName } from '@/engine/types'
import {
  Field,
  SubHead,
  TintByEditor,
} from './shared'
import { asObj, asStr, inputCls, type BuilderProps } from './utils'

/** [configKey, label, engine default] per template — placeholders teach the default. */
const KEY_FIELDS: Record<string, [string, string, string][]> = {
  gallery: [
    ['srcKey', 'Image URL key', 'src'],
    ['titleKey', 'Title key', 'title'],
    ['subtitleKey', 'Subtitle key', 'assignedTo'],
    ['groupBy', 'Group-by key', 'kind'],
  ],
  checklist: [
    ['groupKey', 'Group key', 'section'],
    ['labelKey', 'Item label key', 'item'],
    ['noteKey', 'Note key', 'note'],
    ['requiredKey', 'Required flag key', 'required'],
  ],
  timeline: [
    ['timeKey', 'Timestamp key', 'at'],
    ['titleKey', 'Title key', 'title'],
    ['bodyKey', 'Body key', 'detail'],
    ['actorKey', 'Actor key', 'actor'],
    ['kindKey', 'Kind key', 'kind'],
  ],
}

const ASPECTS = ['photo', 'square', 'portrait'] as const

export default function KeyMapBuilder({ config, onChange, type }: BuilderProps & { type: PageType }) {
  const fields = KEY_FIELDS[type] ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(([key, label, def]) => (
          <Field key={key} label={label}>
            <input
              value={asStr(config[key])}
              onChange={(e) => onChange({ ...config, [key]: e.target.value || undefined })}
              placeholder={def}
              className={inputCls}
            />
          </Field>
        ))}
        {type === 'gallery' && (
          <Field label="Aspect ratio">
            <select
              value={asStr(config.aspect, 'photo')}
              onChange={(e) => onChange({ ...config, aspect: e.target.value })}
              className={inputCls}
            >
              {ASPECTS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {type === 'gallery' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Search placeholder">
            <input value={asStr(config.searchPlaceholder)} onChange={(e) => onChange({ ...config, searchPlaceholder: e.target.value || undefined })} placeholder="Search images…" className={inputCls} />
          </Field>
          <Field label="Empty text">
            <input value={asStr(config.emptyText)} onChange={(e) => onChange({ ...config, emptyText: e.target.value || undefined })} placeholder="No image matches this filter." className={inputCls} />
          </Field>
        </div>
      )}

      {type === 'timeline' && (
        <div>
          <SubHead>Kind → tint</SubHead>
          <div className="mt-1.5">
            <TintByEditor
              map={(asObj(config.kindTints) as Record<string, TintName>)}
              onChange={(kindTints) => onChange({ ...config, kindTints })}
              addLabel="Add kind"
            />
          </div>
        </div>
      )}
    </div>
  )
}
