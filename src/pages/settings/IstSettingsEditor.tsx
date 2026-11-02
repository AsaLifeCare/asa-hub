// Settings → IST → IST settings: one editor per `ist_config` key, drawn by its declared type (number, yes/no…
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import {
  IST_CONFIG_GROUPS, IST_CONFIG_SPEC, cfgCatalogueOf, cfgSaveProblems, type IstGroup, type IstKeySpec,
} from '@/lib/istConfig'

/** One row of the `ist_config` tab, as istConfigGet answers it. */
export type CfgRow = {
  key: string
  value: string
  raw: string
  default_value: string
  note: string
  group: string
  type?: string
  min?: number | null
  max?: number | null
  allowed?: string[] | null
  keys?: string[] | null
  values?: string[] | null
  placeholders?: string[] | null
  /** the cell in the tab was refused; its usable entries or the declared value answer until it is fixed */
  problem?: string
}

export type CfgAnswer = {
  rows: CfgRow[]
  groups?: IstGroup[]
  unknown_rows: { key: string; value: string }[]
  tab: string
  source: string
  blind: boolean
  blind_reason: string
}

/** The declaration of a row: the answer's own fields over this build's copy. */
export function rowSpec(r: CfgRow): IstKeySpec {
  const mine = IST_CONFIG_SPEC[r.key]
  return {
    ...(mine ?? {}),
    key: r.key,
    group: r.group || mine?.group || 'other',
    type: (r.type || mine?.type || 'text') as IstKeySpec['type'],
    value: r.default_value ?? mine?.value ?? '',
    note: r.note || mine?.note || '',
    min: r.min ?? mine?.min,
    max: r.max ?? mine?.max,
    allowed: r.allowed ?? mine?.allowed,
    keys: r.keys ?? mine?.keys,
    values: r.values ?? mine?.values,
    placeholders: r.placeholders ?? mine?.placeholders,
  }
}

/** What a cell takes, in one line — drawn under the input beside the note. */
export function cfgHint(spec: IstKeySpec): string {
  switch (spec.type) {
    case 'int': return 'A whole number.'
    case 'yesno': return 'yes or no.'
    case 'choice': return `One of: ${(spec.allowed ?? []).join(', ')}.`
    case 'course': return 'A short course key from the course list (ist_cert_labels).'
    case 'list': return 'Entries separated by commas.'
    case 'pairs':
      return ['key=value pairs separated by commas.',
        spec.keys ? `Keys: ${spec.keys.join(', ')}.` : '',
        spec.values ? `Values: ${spec.values.join(', ')}.` : ''].filter(Boolean).join(' ')
    case 'template':
      return `A sentence; it fills in ${(spec.placeholders ?? []).map((p) => `{${p}}`).join(', ')}.`
    default: return 'Text.'
  }
}

/** The cells as the tab holds them, from an answer — what a save is checked against. */
export function storedOf(answer?: CfgAnswer | null): Record<string, string> {
  return Object.fromEntries((answer?.rows ?? []).map((r) => [r.key, r.raw ?? '']))
}

/** Why saving this ONE key's draft would be refused — the door's rule against the cells as saved; '' when accepted. */
export function draftProblem(key: string, draft: Record<string, string>, answer?: CfgAnswer | null): string {
  const value = draft[key] ?? ''
  if (!value.trim()) return 'Empty — a blank cell is not saved from here. Use Reset to default to go back to the declared value.'
  const stored = storedOf(answer)
  const own = `${key}: `
  const said = cfgSaveProblems({ [key]: value }, stored)
    .map((p) => (p.startsWith(own) ? p.slice(own.length) : p))
  if (!said.length) return ''
  // the course list's own unsaved draft would accept it: say which save comes first
  const labels = draft.ist_cert_labels
  const savedLabels = answer?.rows.find((r) => r.key === 'ist_cert_labels')?.value
  if (key !== 'ist_cert_labels' && labels !== undefined && labels !== savedLabels
      && !cfgSaveProblems({ ist_cert_labels: labels, [key]: value }, stored).some((p) => p.startsWith(own))) {
    return `${said.join(' · ')} — the course list's unsaved edit has it: save ist_cert_labels first`
  }
  return said.join(' · ')
}

/** The drafts after a re-read: an unsaved edit is kept; an untouched or just-saved (`refresh`) key takes the value read. */
export function keepDrafts(prev: CfgRow[] | undefined, next: CfgRow[], draft: Record<string, string>,
  refresh: readonly string[] = []): Record<string, string> {
  const was = new Map((prev ?? []).map((r) => [r.key, r.value]))
  const out: Record<string, string> = {}
  for (const r of next) {
    const edited = draft[r.key] !== undefined && was.has(r.key) && draft[r.key] !== was.get(r.key)
    out[r.key] = edited && !refresh.includes(r.key) ? draft[r.key] : r.value
  }
  return out
}

/** The groups in the answer's order, then any group a row names that the answer does not. */
export function editorGroups(answer: CfgAnswer): IstGroup[] {
  const declared = answer.groups?.length ? answer.groups : [...IST_CONFIG_GROUPS]
  const out = [...declared]
  for (const r of answer.rows ?? []) {
    if (r.group && !out.some((g) => g.id === r.group)) out.push({ id: r.group, title: r.group, blurb: '' })
  }
  return out
}

const input =
  'h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors focus:border-primary'

export default function IstSettingsEditor({ answer, draft, busy, onChange, onSave }: {
  answer: CfgAnswer
  draft: Record<string, string>
  busy: string
  onChange: (key: string, value: string) => void
  onSave: (key: string) => void
}) {
  // the course select offers the list as saved: one key is saved at a time
  const catalogue = cfgCatalogueOf(storedOf(answer))
  const blind = !!answer.blind
  return (
    <div className="space-y-4">
      {editorGroups(answer).map((g) => {
        const rows = (answer.rows ?? []).filter((r) => (r.group || 'other') === g.id)
        if (!rows.length) return null
        return (
          <div key={g.id} data-ist-group={g.id}>
            <p className="text-[12px] font-semibold text-text-1">{g.title}</p>
            {g.blurb && <p className="mb-2 text-[11.5px] leading-4 text-text-3">{g.blurb}</p>}
            <div className="space-y-2.5">
              {rows.map((r) => {
                const spec = rowSpec(r)
                const value = draft[r.key] ?? ''
                // a refused cell is saveable as it stands on screen: saving it is the fix
                const dirty = value !== r.value || (!!r.problem && value !== r.raw)
                const problem = draftProblem(r.key, draft, answer)
                const atDefault = value === r.default_value
                const set = (v: string) => onChange(r.key, v)
                // what answers while the refused cell stands: its usable entries, or the declared value
                const answering = r.value === r.default_value
                  ? 'The declared value answers until the cell is fixed.'
                  : `What the platform uses meanwhile: “${r.value}”.`
                let field
                if (spec.type === 'int') {
                  field = <input type="number" inputMode="numeric" min={spec.min} max={spec.max} value={value}
                    data-ist-input="int" onChange={(e) => set(e.target.value)} className={input + ' max-w-[160px]'} />
                } else if (spec.type === 'yesno' || spec.type === 'choice' || spec.type === 'course') {
                  const options = spec.type === 'yesno' ? ['yes', 'no']
                    : spec.type === 'choice' ? (spec.allowed ?? []) : catalogue
                  const all = options.includes(value) || !value ? options : [value, ...options]
                  field = (
                    <select value={value} data-ist-input={spec.type} onChange={(e) => set(e.target.value)}
                      className={input + ' max-w-[260px]'}>
                      {all.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )
                } else {
                  field = <textarea rows={value.length > 70 ? 3 : 1} value={value} data-ist-input={spec.type}
                    onChange={(e) => set(e.target.value)}
                    className="min-h-9 min-w-[260px] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text-1 outline-none transition-colors focus:border-primary" />
                }
                return (
                  <div key={r.key} data-ist-key={r.key} className="rounded-md border border-border bg-surface px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <code className="text-[11.5px] font-semibold text-text-2">{r.key}</code>
                      {!atDefault && (
                        <button type="button" onClick={() => set(r.default_value)} data-ist-reset
                          title={`The declared value: ${r.default_value}`}
                          className="flex items-center gap-1 text-[11px] font-semibold text-text-3 underline-offset-2 hover:underline">
                          <RotateCcw size={11} /> Reset to default
                        </button>
                      )}
                    </div>
                    {r.problem && (
                      <p className="mt-1 flex items-start gap-1 rounded-md bg-tint-amber px-2 py-1 text-[11.5px] leading-4 text-tint-fg-amber">
                        <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                        <span>The cell in the tab reads “{r.raw}” and is refused — {r.problem}. {answering}</span>
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-start gap-2">
                      {field}
                      <button type="button" data-ist-save disabled={blind || !dirty || !!problem || busy === 'cfg:' + r.key}
                        onClick={() => onSave(r.key)}
                        title={blind ? 'The tab could not be read — reload once it answers' : undefined}
                        className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                        {busy === 'cfg:' + r.key && <Loader2 size={12} className="animate-spin" />} Save
                      </button>
                    </div>
                    {problem && dirty && <p data-ist-problem className="mt-1 text-[11.5px] leading-4 text-danger">{problem}</p>}
                    <p className="mt-1 text-[11.5px] leading-4 text-text-3">
                      <span className="font-semibold text-text-2">{cfgHint(spec)}</span> {r.note}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-text-3">Default: <code>{r.default_value}</code></p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
