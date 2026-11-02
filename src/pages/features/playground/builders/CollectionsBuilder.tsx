// COLLECTIONS BUILDER — documents and videos both group their rows into labelled buckets: documents call them…
// Around the list: documents gets the reader switches and card style, videos the player switches and the featured…
import {
  AddRow,
  Field,
  IconPicker,
  RowMoves,
  SubHead,
  SwitchLine,
  TintDots,
} from './shared'
import { asArr, asBool, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'
import type { TintName } from '@/engine/types'

type GroupRow = { id: string; label: string; icon?: string; tint: TintName }

export default function CollectionsBuilder({
  config,
  onChange,
  variant,
  rowIds,
}: BuilderProps & { variant: 'documents' | 'videos'; rowIds: string[] }) {
  const isDocs = variant === 'documents'
  const listKey = isDocs ? 'collections' : 'channels'
  const groups: GroupRow[] = asArr<Record<string, unknown>>(config[listKey]).map((g) => ({
    ...asObj(g),
    id: asStr(g.id),
    label: asStr(g.label),
    tint: asStr(g.tint, 'blue') as TintName,
  })) as GroupRow[]
  const write = (next: GroupRow[]) => onChange({ ...config, [listKey]: next })
  const patch = (i: number, p: Partial<GroupRow>) => write(groups.map((g, j) => (j === i ? { ...g, ...p } : g)))
  const toggles = asObj(isDocs ? config.reader : config.player)
  const toggleKey = isDocs ? 'reader' : 'player'
  const patchToggle = (k: string, v: boolean) => onChange({ ...config, [toggleKey]: { ...toggles, [k]: v } })

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <SubHead>{isDocs ? 'Collections' : 'Channels'}</SubHead>
        {groups.map((g, i) => (
          <div key={i} className="rounded-md border border-border bg-bg p-2.5">
            <div className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Id">
                  <input value={g.id} onChange={(e) => patch(i, { id: e.target.value })} placeholder="guides" className={inputCls} />
                </Field>
                <Field label="Label">
                  <input value={g.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Guides" className={inputCls} />
                </Field>
              </div>
              <div className="pt-5">
                <RowMoves index={i} count={groups.length} onMove={(d) => write(moveItem(groups, i, d))} onRemove={() => write(groups.filter((_, j) => j !== i))} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <TintDots value={g.tint} onChange={(t) => patch(i, { tint: t })} />
              {isDocs && <IconPicker value={g.icon ?? ''} onChange={(n) => patch(i, { icon: n })} />}
            </div>
          </div>
        ))}
        <AddRow
          label={isDocs ? 'Add collection' : 'Add channel'}
          onClick={() =>
            write([
              ...groups,
              {
                id: `${isDocs ? 'collection' : 'channel'}-${groups.length + 1}`,
                label: `${isDocs ? 'Collection' : 'Channel'} ${groups.length + 1}`,
                ...(isDocs ? { icon: 'folder' } : {}),
                tint: 'blue',
              },
            ])
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-bg p-2.5">
          <SubHead>{isDocs ? 'Reader' : 'Player'}</SubHead>
          {isDocs ? (
            <>
              <SwitchLine label="Show table of contents" checked={asBool(toggles.showToc, true)} onChange={(v) => patchToggle('showToc', v)} />
              <SwitchLine label="Show document meta" checked={asBool(toggles.showMeta, true)} onChange={(v) => patchToggle('showMeta', v)} />
              <SwitchLine label="Allow print" checked={asBool(toggles.allowPrint, true)} onChange={(v) => patchToggle('allowPrint', v)} />
            </>
          ) : (
            <>
              <SwitchLine label="Show playlist" checked={asBool(toggles.showPlaylist, true)} onChange={(v) => patchToggle('showPlaylist', v)} />
              <SwitchLine label="Show progress" checked={asBool(toggles.showProgress, true)} onChange={(v) => patchToggle('showProgress', v)} />
              <SwitchLine label="Autoplay next" checked={asBool(toggles.autoplayNext)} onChange={(v) => patchToggle('autoplayNext', v)} />
            </>
          )}
        </div>

        <div className="rounded-md border border-border bg-bg p-2.5">
          {isDocs ? (
            <Field label="Card style">
              <select
                value={asStr(config.cardStyle, 'cover')}
                onChange={(e) => onChange({ ...config, cardStyle: e.target.value })}
                className={inputCls}
              >
                <option value="cover">cover</option>
                <option value="minimal">minimal</option>
              </select>
            </Field>
          ) : (
            <Field label="Featured video">
              {rowIds.length ? (
                <select
                  value={asStr(config.featuredId)}
                  onChange={(e) => onChange({ ...config, featuredId: e.target.value || undefined })}
                  className={inputCls}
                >
                  <option value="">First video (default)</option>
                  {rowIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={asStr(config.featuredId)}
                  onChange={(e) => onChange({ ...config, featuredId: e.target.value || undefined })}
                  placeholder="row-1"
                  className={inputCls}
                />
              )}
            </Field>
          )}
        </div>
      </div>
    </div>
  )
}
