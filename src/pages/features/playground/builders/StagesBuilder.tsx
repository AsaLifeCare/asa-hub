// STAGES BUILDER — pipeline and board share the stage vocabulary (`stages…
// Board note: the board's drag update writes back through `stageField`, but its card chrome reads the conventional…
import type { TintName } from '@/engine/types'
import {
  AddRow,
  Field,
  RowMoves,
  SubHead,
  SwitchLine,
  TintByEditor,
  TintDots,
} from './shared'
import { asArr, asBool, asNum, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'

type StageRow = { id: string; label: string; tint: TintName; description?: string; celebrate?: boolean }

const readStages = (config: Record<string, unknown>): StageRow[] =>
  asArr<Record<string, unknown>>(config.stages).map((s) => ({
    ...asObj(s),
    id: asStr(s.id),
    label: asStr(s.label),
    tint: asStr(s.tint, 'blue') as TintName,
  })) as StageRow[]

export default function StagesBuilder({ config, onChange, variant }: BuilderProps & { variant: 'pipeline' | 'board' }) {
  const stages = readStages(config)
  const cf = asObj(config.cardFields)
  const tags = asObj(cf.tags)
  const score = asObj(cf.score)
  const write = (next: StageRow[]) => onChange({ ...config, stages: next })
  const patchStage = (i: number, patch: Partial<StageRow>) =>
    write(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const patchCf = (patch: Record<string, unknown>) =>
    onChange({ ...config, cardFields: { ...cf, ...patch } })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Stage field (row key)">
          <input
            value={asStr(config.stageField, variant === 'board' ? 'column' : 'stage')}
            onChange={(e) => onChange({ ...config, stageField: e.target.value })}
            placeholder={variant === 'board' ? 'column' : 'stage'}
            className={inputCls}
          />
        </Field>
        {variant === 'pipeline' && (
          <Field label="Entity name">
            <input
              value={asStr(config.entity)}
              onChange={(e) => onChange({ ...config, entity: e.target.value })}
              placeholder="deals"
              className={inputCls}
            />
          </Field>
        )}
      </div>

      <div className="space-y-2.5">
        <SubHead>Stages</SubHead>
        {stages.map((s, i) => (
          <div key={i} className="rounded-md border border-border bg-bg p-2.5">
            <div className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Id">
                  <input value={s.id} onChange={(e) => patchStage(i, { id: e.target.value })} placeholder="new" className={inputCls} />
                </Field>
                <Field label="Label">
                  <input value={s.label} onChange={(e) => patchStage(i, { label: e.target.value })} placeholder="New" className={inputCls} />
                </Field>
              </div>
              <div className="pt-5">
                <RowMoves index={i} count={stages.length} onMove={(d) => write(moveItem(stages, i, d))} onRemove={() => write(stages.filter((_, j) => j !== i))} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <TintDots value={s.tint} onChange={(t) => patchStage(i, { tint: t })} />
              {variant === 'pipeline' && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-text-2">
                  <input
                    type="checkbox"
                    checked={s.celebrate ?? false}
                    onChange={(e) => patchStage(i, { celebrate: e.target.checked ? true : undefined })}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Celebrate (confetti on drop)
                </label>
              )}
            </div>
            {variant === 'pipeline' && (
              <div className="mt-2">
                <Field label="Description">
                  <input
                    value={s.description ?? ''}
                    onChange={(e) => patchStage(i, { description: e.target.value || undefined })}
                    placeholder="What lives in this stage"
                    className={inputCls}
                  />
                </Field>
              </div>
            )}
          </div>
        ))}
        <AddRow
          label="Add stage"
          onClick={() => write([...stages, { id: `stage-${stages.length + 1}`, label: `Stage ${stages.length + 1}`, tint: 'blue' }])}
        />
      </div>

      {variant === 'pipeline' && (
        <>
          <div className="rounded-md border border-border bg-bg p-2.5">
            <SubHead>Card fields</SubHead>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Title key">
                <input value={asStr(cf.title)} onChange={(e) => patchCf({ title: e.target.value })} placeholder="name" className={inputCls} />
              </Field>
              <Field label="Subtitle key">
                <input value={asStr(cf.subtitle)} onChange={(e) => patchCf({ subtitle: e.target.value || undefined })} placeholder="company" className={inputCls} />
              </Field>
              <Field label="Tags key">
                <input
                  value={asStr(tags.key)}
                  onChange={(e) => patchCf({ tags: { ...tags, key: e.target.value } })}
                  placeholder="source"
                  className={inputCls}
                />
              </Field>
              <Field label="Meta keys (comma-separated)">
                <input
                  key={asArr<string>(cf.meta).join(',')}
                  defaultValue={asArr<string>(cf.meta).join(', ')}
                  onBlur={(e) =>
                    patchCf({ meta: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                  }
                  placeholder="daysInStage"
                  className={inputCls}
                />
              </Field>
              <Field label="Score key">
                <input
                  value={asStr(score.key)}
                  onChange={(e) => patchCf({ score: { ...score, key: e.target.value } })}
                  placeholder="score"
                  className={inputCls}
                />
              </Field>
              <Field label="Score max">
                <input
                  type="number"
                  min={1}
                  value={asNum(score.max, 5)}
                  onChange={(e) => patchCf({ score: { ...score, max: Number(e.target.value) || 5 } })}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="mt-2">
              <SubHead>Tag value → tint</SubHead>
              <div className="mt-1.5">
                <TintByEditor
                  map={(tags.tintBy as Record<string, TintName>) ?? {}}
                  onChange={(tintBy) => patchCf({ tags: { ...tags, tintBy } })}
                />
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-bg p-2.5">
            <SubHead>Chrome</SubHead>
            <SwitchLine label="Show stage rail" checked={asBool(config.showRail, true)} onChange={(v) => onChange({ ...config, showRail: v })} />
            <SwitchLine label="Show summary strip" checked={asBool(config.showSummary, true)} onChange={(v) => onChange({ ...config, showSummary: v })} />
          </div>
        </>
      )}
    </div>
  )
}
