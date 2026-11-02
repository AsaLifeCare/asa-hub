import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { BANNER_TEXT, HANDLER_LABEL, PHASES, PRODUCTION_ACTION_HANDLERS, type PAction } from '@/lib/productionActions'

export type Draft = Record<string, string>
export type Problem = { field: string; words: string }

const PARAM_FIELDS: Record<string, { key: string; label: string; hint?: string; long?: boolean }[]> = {
  banner: [
    { key: 'book', label: 'Book id', hint: 'The Drive id of the outside book' },
    { key: 'gid', label: 'Tab id (gid)', hint: 'The number after #gid= — a tab is found by its id, never its title' },
    { key: 'range', label: 'Cells', hint: 'One row in the frozen header band, right of the header, e.g. G1:N1' },
    { key: 'text', label: 'Text', long: true },
    { key: 'background', label: 'Background', hint: '#RRGGBB' },
    { key: 'color', label: 'Text colour', hint: '#RRGGBB' },
    { key: 'bold', label: 'Bold', hint: 'yes or no' },
    { key: 'tab_color', label: 'Tab colour', hint: '#RRGGBB, or empty to leave the tab colour alone' },
    { key: 'note', label: 'What the header columns hold', hint: 'Shown in the preview' },
    { key: 'script', label: 'A script that reads this tab', hint: 'Empty when none is known' },
  ],
  link: [{ key: 'url', label: 'Link', hint: 'https://…' }],
  form_close: [
    { key: 'form', label: 'Form edit id or edit link', hint: 'Or the book and tab id its answers land on' },
    { key: 'book', label: 'Responses book id' },
    { key: 'gid', label: 'Responses tab id (gid)' },
    { key: 'message', label: 'Closed message', long: true },
  ],
}

const PLACED = ['title', 'number', 'phase', 'kind', 'handler', 'link']

export function draftFrom(action: PAction | null): Draft {
  const phase = !action ? 'before' : PHASES.some((p) => p.id === action.phase) ? action.phase : ''
  const d: Draft = {
    id: action?.id ?? '', title: action?.title ?? '', number: action?.number ?? '', phase,
    system: action?.system ?? '', kind: action?.kind || 'manual', handler: action?.handler ?? '', how: action?.how ?? '',
    link: action?.link ?? '', requires: action?.requires ?? '', effect: action?.effect ?? '', enabled: action?.enabled || 'yes',
  }
  const params = action?.params_obj ?? {}
  for (const [k, v] of Object.entries(params)) {
    d[`p.${k}`] = typeof v === 'boolean' ? (v ? 'yes' : 'no') : v == null ? '' : String(v)
  }
  if (action?.handler === 'banner' && action.params_obj && !('tab_color' in params)) d['p.tab_color'] = '#8B0000'
  return d
}

export function sortProblems(problems: Problem[], handler: string): { general: Problem[]; params: Problem[] } {
  const fields = new Set((PARAM_FIELDS[handler] ?? []).map((f) => `params.${f.key}`))
  return {
    general: problems.filter((p) => !PLACED.includes(p.field) && !p.field.startsWith('params')),
    params: problems.filter((p) => p.field === 'params' || (p.field.startsWith('params.') && !fields.has(p.field))),
  }
}

export function payloadFrom(d: Draft): Record<string, unknown> {
  const handler = d.kind === 'automatic' ? d.handler : ''
  const params: Record<string, unknown> = {}
  for (const f of PARAM_FIELDS[handler] ?? []) {
    const v = String(d[`p.${f.key}`] ?? '').trim()
    if (!v && f.key === 'tab_color') params.tab_color = ''
    if (!v) continue
    if (f.key === 'gid' && /^\d+$/.test(v)) params.gid = Number(v)
    else if (f.key === 'bold') params.bold = !['no', 'false', '0'].includes(v.toLowerCase())
    else params[f.key] = v
  }
  return {
    id: d.id, title: d.title, number: d.number, phase: d.phase, system: d.system, kind: d.kind, handler,
    params: handler ? params : '', how: d.how, link: d.link, requires: d.requires, effect: d.effect, enabled: d.enabled,
  }
}

function Field({ label, hint, value, onChange, problem, long }: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  problem?: string
  long?: boolean
}) {
  const cls = cn('w-full rounded-md border bg-surface px-2.5 py-1.5 text-[13px] text-text-1 outline-none focus:border-primary',
    problem ? 'border-tint-fg-danger' : 'border-border')
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-text-2">{label}</span>
      {long ? <textarea className={cn(cls, 'mt-1 min-h-[64px]')} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className={cn(cls, 'mt-1 h-9')} value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint && !problem && <span className="mt-0.5 block text-[11px] text-text-3">{hint}</span>}
      {problem && <span className="mt-0.5 block text-[11.5px] font-semibold text-tint-fg-danger">{problem}</span>}
    </label>
  )
}

export default function EditActionSheet({ open, action, onClose, onSave }: {
  open: boolean
  action: PAction | null
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<Problem[]>
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(action))
  const [problems, setProblems] = useState<Problem[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) { setDraft(draftFrom(action)); setProblems([]) }
  }, [open, action])
  const set = (k: string) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const problemOf = (field: string) => problems.find((p) => p.field === field)?.words
  const handler = draft.kind === 'automatic' ? draft.handler : ''
  const pick = (h: string) => setDraft((d) => {
    const next: Draft = { ...d, kind: h ? 'automatic' : 'manual', handler: h }
    if (h === 'banner' && !next['p.text']) {
      Object.assign(next, { 'p.text': BANNER_TEXT, 'p.background': '#8B0000', 'p.color': '#FFFFFF', 'p.bold': 'yes',
                            'p.tab_color': '#8B0000' })
    }
    return next
  })
  const save = async () => {
    setSaving(true)
    try {
      setProblems(await onSave(payloadFrom(draft)))
    } finally {
      setSaving(false)
    }
  }
  const { general, params: paramGeneral } = sortProblems(problems, handler)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-surface p-6 sm:max-w-[384px]">
        <SheetHeader className="mb-4">
          <SheetTitle className="font-display text-[17px] font-bold text-text-1">
            {action ? `Edit #${action.number} ${action.title}` : 'New action'}
          </SheetTitle>
          <SheetDescription className="text-[12px] text-text-3">
            Saved to the runbook house; nothing is deleted — switch an action off instead.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3">
          <Field label="Title" value={draft.title} onChange={set('title')} problem={problemOf('title')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number" value={draft.number} onChange={set('number')} problem={problemOf('number')} />
            <label className="block">
              <span className="text-[12px] font-semibold text-text-2">Phase</span>
              <select className={cn('mt-1 h-9 w-full rounded-md border bg-surface px-2 text-[13px]',
                problemOf('phase') ? 'border-tint-fg-danger' : 'border-border')}
                value={draft.phase} onChange={(e) => set('phase')(e.target.value)}>
                {!draft.phase && <option value="" disabled>Choose a phase</option>}
                {PHASES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {problemOf('phase') && (
                <span className="mt-0.5 block text-[11.5px] font-semibold text-tint-fg-danger">{problemOf('phase')}</span>
              )}
            </label>
          </div>
          <Field label="System it uses" value={draft.system} onChange={set('system')} />
          <label className="block">
            <span className="text-[12px] font-semibold text-text-2">Handler</span>
            <select className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-[13px]"
              value={handler} onChange={(e) => pick(e.target.value)}>
              <option value="">None — a manual action</option>
              {PRODUCTION_ACTION_HANDLERS.map((h) => <option key={h} value={h}>{HANDLER_LABEL[h]}</option>)}
            </select>
            {(problemOf('handler') || problemOf('kind')) && (
              <span className="mt-0.5 block text-[11.5px] font-semibold text-tint-fg-danger">{problemOf('handler') || problemOf('kind')}</span>
            )}
          </label>
          {handler && (
            <div className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
              {(PARAM_FIELDS[handler] ?? []).map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint} long={f.long} value={draft[`p.${f.key}`] ?? ''}
                  onChange={set(`p.${f.key}`)} problem={problemOf(`params.${f.key}`)} />
              ))}
              {paramGeneral.map((p) => <p key={p.words} className="text-[11.5px] font-semibold text-tint-fg-danger">{p.words}</p>)}
            </div>
          )}
          <Field label={handler ? 'What happens' : 'How (the steps a person follows)'} long value={draft.how} onChange={set('how')} />
          <Field label="Link" hint="https://… or an in-app /app/… path" value={draft.link} onChange={set('link')} problem={problemOf('link')} />
          <Field label="Requires" hint="What must be true first" value={draft.requires} onChange={set('requires')} />
          <Field label="Effect" hint="One sentence, shown on the card" value={draft.effect} onChange={set('effect')} />
          <label className="flex items-center gap-2 text-[12.5px] text-text-2">
            <input type="checkbox" checked={draft.enabled !== 'no'} onChange={(e) => set('enabled')(e.target.checked ? 'yes' : 'no')} />
            Enabled (off moves it to "Switched off")
          </label>
          {general.map((p) => <p key={p.field + p.words} className="text-[12px] font-semibold text-tint-fg-danger">{p.words}</p>)}
        </div>
        <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
          <button type="button" onClick={() => void save()} disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[13px] text-text-2 hover:bg-surface-2">Cancel</button>
          {problems.length > 0 && (
            <p className="text-[12px] font-semibold text-tint-fg-danger">Not saved: fix the fields marked in red.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
