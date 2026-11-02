// ACTIONS BUILDER — the studio half of "real actions and buttons".
// Edits the frozen ConfigAction vocabulary where it lives in the page config: - sheet → `config.rowActions[]`…
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ACTIONS_CATALOGUE, type BakedAction } from '@/lib/actions.generated'
import { PERMISSIONS } from '@/auth/permissions'
import { cn } from '@/lib/utils'
import { AddRow, Field, IconPicker, RowMoves, SubHead, SwitchLine } from './shared'
import { asArr, asBool, asObj, asStr, inputCls, moveItem, type BuilderProps } from './utils'

/* ---------------- the frozen vocabulary (mirrors the engine runner) ---------------- */

type ConfigAction = {
  id: string
  label: string
  icon?: string
  quick?: boolean
  danger?: boolean
  bulk?: boolean
  perm?: string
  when?: { field: string; eq?: unknown; neq?: unknown; in?: unknown[] }
  confirm?: string
  kind: 'patch' | 'call' | 'link' | 'create' | 'delete' | 'navigate'
  patch?: Record<string, unknown>
  call?: string
  payload?: Record<string, unknown>
  href?: string
  toast?: string
}

const KINDS: { id: ConfigAction['kind']; label: string }[] = [
  { id: 'patch', label: 'Patch — update row fields' },
  { id: 'call', label: 'Call — run a hub action' },
  { id: 'link', label: 'Link — open a URL' },
  { id: 'create', label: 'Create — add a row (duplicate, follow-up…)' },
  { id: 'delete', label: 'Delete — remove this row' },
  { id: 'navigate', label: 'Navigate — go to another app page' },
]

/** Where the list lives: sheet row menu, sheet header bar, detail footer. */
type Placement = 'row' | 'header' | 'footer'

const readActions = (v: unknown): ConfigAction[] =>
  asArr<Record<string, unknown>>(v).map((a) => {
    const o = asObj(a)
    const kind = asStr(o.kind, 'patch')
    return {
      ...o,
      id: asStr(o.id),
      label: asStr(o.label),
      kind: (KINDS.some((k) => k.id === kind) ? kind : 'patch') as ConfigAction['kind'],
    } as ConfigAction
  })

// Read footer buttons from either the frozen object shape or the legacy bare-array shape the detail template still…
const readFooterButtons = (config: Record<string, unknown>): ConfigAction[] =>
  readActions(Array.isArray(config.footer) ? config.footer : asObj(config.footer).buttons)

/* ---------------- one-click presets (inserted, then freely editable) ---------------- */

const PRESETS: { label: string; action: ConfigAction }[] = [
  {
    label: 'Mark done',
    action: {
      id: 'mark-done',
      label: 'Mark done',
      icon: 'check',
      kind: 'patch',
      patch: { status: 'Done' },
      when: { field: 'status', neq: 'Done' },
      toast: 'Marked done',
    },
  },
  {
    label: 'Approve',
    action: { id: 'approve', label: 'Approve', icon: 'check', kind: 'patch', patch: { status: 'Approved' }, toast: 'Approved' },
  },
  {
    // The vocabulary has no tint key, so the pink half of the pair comes from `danger` (danger styling + forced…
    label: 'Reject',
    action: {
      id: 'reject',
      label: 'Reject',
      icon: 'x',
      kind: 'patch',
      patch: { status: 'Rejected' },
      danger: true,
      confirm: 'Reject this row?',
    },
  },
  {
    label: 'Archive',
    action: {
      id: 'archive',
      label: 'Archive',
      icon: 'archive',
      kind: 'patch',
      patch: { archived: true },
      danger: true,
      confirm: 'Archive this row?',
    },
  },
  {
    label: 'Open link',
    action: { id: 'open-link', label: 'Open link', icon: 'external-link', kind: 'link', href: 'https://{row.website}' },
  },
  {
    label: 'Duplicate row',
    action: {
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      kind: 'create',
      payload: { name: '{row.name} (copy)' },
      toast: 'Duplicated',
    },
  },
  {
    label: 'Delete row',
    action: { id: 'delete-row', label: 'Delete', icon: 'trash-2', kind: 'delete', danger: true, confirm: 'Delete this row?' },
  },
  {
    label: 'Open page',
    action: { id: 'open-page', label: 'Open page', icon: 'arrow-right', kind: 'navigate', href: 'page:detail' },
  },
  // the shortcuts — the four state moves every board keeps typing
  {
    label: 'Mark urgent',
    action: {
      id: 'mark-urgent', label: 'Mark urgent', icon: 'triangle-alert', kind: 'patch',
      patch: { priority: 'High' }, when: { field: 'priority', neq: 'High' }, toast: 'Marked urgent',
    },
  },
  {
    label: 'Start work',
    action: {
      id: 'start-work', label: 'Start work', icon: 'play', kind: 'patch',
      patch: { status: 'In progress' }, when: { field: 'status', neq: 'In progress' }, toast: 'Started',
    },
  },
  {
    label: 'Put on hold',
    action: {
      id: 'put-on-hold', label: 'Put on hold', icon: 'pause', kind: 'patch',
      patch: { status: 'On hold' }, when: { field: 'status', neq: 'On hold' }, toast: 'On hold',
    },
  },
  {
    label: 'Reopen',
    action: {
      id: 'reopen', label: 'Reopen', icon: 'rotate-ccw', kind: 'patch',
      patch: { status: 'Open' }, when: { field: 'status', eq: 'Done' }, toast: 'Reopened',
    },
  },
]

/* ---------------- the engine's reserved row-action ids ---------------- */

// The sheet's runRowAction checks these ids BEFORE a config action's `kind` ('edit'/'assign'/'delete' run the…
const RESERVED_IDS = ['edit', 'delete', 'share', 'assign', 'view']

/** Keep ids unique when a preset is inserted twice. */
const uniqueId = (base: string, actions: ConfigAction[]): string => {
  if (!actions.some((a) => a.id === base)) return base
  let n = 2
  while (actions.some((a) => a.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}

/* ---------------- key/value rows (patch + payload) ---------------- */

/** Commit a typed value: keep booleans/numbers real when the text round-trips. */
const coerceValue = (raw: string): unknown => {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.trim() !== '' && !isNaN(Number(raw)) && String(Number(raw)) === raw.trim()) return Number(raw)
  return raw
}

function KvEditor({
  map,
  onChange,
  addLabel,
  note,
  hints,
}: {
  map: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  addLabel: string
  note?: string
  hints?: string[]
}) {
  const entries = Object.entries(map)
  const writeEntries = (next: [string, unknown][]) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of next) if (k !== '') out[k] = v
    onChange(out)
  }
  return (
    <div className="space-y-1.5">
      {note && <p className="text-[11px] leading-4 text-text-3">{note}</p>}
      {hints && hints.length > 0 && (
        <p className="text-[11px] leading-4 text-text-3">
          Declared params: <span className="font-mono text-text-2">{hints.join(', ')}</span>
        </p>
      )}
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => writeEntries(entries.map(([ek, ev], j) => (j === i ? [e.target.value, ev] : [ek, ev])))}
            placeholder="field"
            className={cn(inputCls, 'h-8 w-2/5 font-mono text-[12px]')}
          />
          <input
            value={typeof v === 'string' ? v : JSON.stringify(v)}
            onChange={(e) => writeEntries(entries.map(([ek, ev], j) => (j === i ? [ek, coerceValue(e.target.value)] : [ek, ev])))}
            placeholder="value or {row.key}"
            className={cn(inputCls, 'h-8 flex-1 font-mono text-[12px]')}
          />
        </div>
      ))}
      <AddRow small label={addLabel} onClick={() => onChange({ ...map, [`field-${entries.length + 1}`]: '' })} />
    </div>
  )
}

/* ---------------- the hub-action picker (kind: call) ---------------- */

const LANE_BADGE: Record<string, string> = {
  read: 'bg-tint-mint/50 text-tint-fg-mint',
  write: 'bg-tint-amber/50 text-tint-fg-amber',
  tool: 'bg-tint-blue/50 text-tint-fg-blue',
}

const ACTION_IDS = Object.keys(ACTIONS_CATALOGUE).sort()
const PICKER_PAGE = 40

function CallPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = q ? ACTION_IDS.filter((id) => id.toLowerCase().includes(q)) : ACTION_IDS
  const shown = matches.slice(0, PICKER_PAGE)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px]">{value || 'Pick a hub action…'}</span>
        {open ? <ChevronDown size={12} className="shrink-0 text-text-3" /> : <ChevronRight size={12} className="shrink-0 text-text-3" />}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-bg p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions…"
            autoFocus
            className={cn(inputCls, 'h-8 text-[12px]')}
          />
          <div className="mt-2 max-h-[180px] space-y-0.5 overflow-y-auto pr-1">
            {shown.map((id) => {
              const a = ACTIONS_CATALOGUE[id]
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onChange(id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left transition-colors',
                    value === id ? 'bg-primary-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-1">{id}</span>
                  <LaneBadge action={a} />
                  {a.emits.length > 0 && (
                    <span className="shrink-0 rounded-sm bg-tint-pink/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-tint-fg-pink">
                      reaches people
                    </span>
                  )}
                </button>
              )
            })}
            {shown.length === 0 && <p className="px-2 py-1 text-[11px] text-text-3">No actions match.</p>}
            {matches.length > shown.length && (
              <p className="px-2 py-1 text-[11px] text-text-3">{matches.length - shown.length} more — keep typing to narrow.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LaneBadge({ action }: { action: BakedAction }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em]',
        LANE_BADGE[action.lane] ?? 'bg-surface-2 text-text-3',
      )}
    >
      {action.lane}
    </span>
  )
}

/* ---------------- one action card ---------------- */

function ActionEditor({
  action,
  index,
  count,
  placement,
  onPatch,
  onMove,
  onRemove,
}: {
  action: ConfigAction
  index: number
  count: number
  placement: Placement
  onPatch: (patch: Partial<ConfigAction>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(index === count - 1)
  const baked = action.kind === 'call' && action.call ? ACTIONS_CATALOGUE[action.call] : undefined
  const reachesPeople = (baked?.emits.length ?? 0) > 0
  const patchMap = asObj(action.patch)
  const payloadMap = asObj(action.payload)
  const when = asObj(action.when)

  const pickCall = (id: string) => {
    const next = ACTIONS_CATALOGUE[id]
    // An emitting action must confirm — prefill the standard copy when empty.
    onPatch({
      call: id,
      confirm: next.emits.length > 0 && !action.confirm ? 'This contacts people. Send?' : action.confirm,
    })
  }

  return (
    <div className="rounded-md border border-border bg-bg p-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown size={12} className="shrink-0 text-text-3" /> : <ChevronRight size={12} className="shrink-0 text-text-3" />}
          <span className="truncate text-[12.5px] font-semibold text-text-1">{action.label || action.id || 'Untitled action'}</span>
          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-text-3">
            {action.kind}
          </span>
          {reachesPeople && (
            <span className="shrink-0 rounded-sm bg-tint-pink/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-tint-fg-pink">
              reaches people
            </span>
          )}
        </button>
        <RowMoves index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>

      {open && (
        <div className="mt-2.5 space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Label">
              <input value={action.label} onChange={(e) => onPatch({ label: e.target.value })} placeholder="Mark done" className={inputCls} />
            </Field>
            <Field label="Id">
              <input
                value={action.id}
                onChange={(e) => onPatch({ id: e.target.value })}
                placeholder="mark-done"
                className={cn(inputCls, 'font-mono text-[12px]')}
              />
            </Field>
          </div>

          {placement === 'row' && action.kind && RESERVED_IDS.includes(action.id) && (
            <p className="rounded-sm bg-tint-amber/50 px-2 py-1.5 text-[11px] leading-4 text-tint-fg-amber">
              This id is reserved by the engine — the button will run the engine's built-in, not your action.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Kind" className="min-w-[220px] flex-1">
              <select
                value={action.kind}
                onChange={(e) => {
                  const kind = e.target.value as ConfigAction['kind']
                  if (kind === 'patch') onPatch({ kind, patch: Object.keys(patchMap).length ? patchMap : { status: 'Done' }, call: undefined, payload: undefined, href: undefined })
                  else if (kind === 'call') onPatch({ kind, call: action.call ?? '', patch: undefined, bulk: undefined, href: undefined })
                  else if (kind === 'create') onPatch({ kind, payload: Object.keys(payloadMap).length ? payloadMap : { name: '{row.name} (copy)' }, patch: undefined, bulk: undefined, call: undefined, href: undefined })
                  else if (kind === 'delete') onPatch({ kind, patch: undefined, bulk: undefined, call: undefined, payload: undefined, href: undefined })
                  else if (kind === 'navigate') onPatch({ kind, href: action.href ?? 'page:detail', patch: undefined, bulk: undefined, call: undefined, payload: undefined })
                  else onPatch({ kind, href: action.href ?? 'https://{row.website}', patch: undefined, bulk: undefined, call: undefined, payload: undefined })
                }}
                className={cn(inputCls, 'h-8 text-[12px]')}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Icon">
              <IconPicker value={action.icon ?? ''} onChange={(n) => onPatch({ icon: n || undefined })} />
            </Field>
          </div>

          {action.kind === 'patch' && (
            <div className="rounded-md border border-border bg-surface p-2">
              <SubHead>Patch fields</SubHead>
              <div className="mt-1.5">
                <KvEditor
                  map={patchMap}
                  onChange={(patch) => onPatch({ patch })}
                  addLabel="Add field"
                  note="Values write straight into the row — use {row.key} to interpolate another field."
                />
              </div>
              {placement === 'row' && (
                <div className="mt-1">
                  <SwitchLine
                    label="Bulk — offer on the selection bar"
                    checked={asBool(action.bulk)}
                    onChange={(v) => onPatch({ bulk: v || undefined })}
                  />
                </div>
              )}
            </div>
          )}

          {action.kind === 'call' && (
            <div className="space-y-2 rounded-md border border-border bg-surface p-2">
              <SubHead>Hub action</SubHead>
              <CallPicker value={action.call ?? ''} onChange={pickCall} />
              {baked && (
                <div className="flex flex-wrap items-center gap-2">
                  <LaneBadge action={baked} />
                  <span className="text-[11px] text-text-3">cost: {baked.cost}</span>
                  {reachesPeople && (
                    <span className="rounded-sm bg-tint-pink/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-tint-fg-pink">
                      reaches people — emits: {baked.emits.join(', ')}
                    </span>
                  )}
                </div>
              )}
              <p className="text-[11px] leading-4 text-text-3">The resolver gate re-checks permissions on every call.</p>
              <div>
                <SubHead>Payload</SubHead>
                <div className="mt-1.5">
                  <KvEditor
                    map={payloadMap}
                    onChange={(payload) => onPatch({ payload })}
                    addLabel="Add payload key"
                    note="Sent with the call — use {row.key} to interpolate row fields."
                    hints={baked?.params}
                  />
                </div>
              </div>
            </div>
          )}

          {action.kind === 'link' && (
            <Field label="Href">
              <input
                value={action.href ?? ''}
                onChange={(e) => onPatch({ href: e.target.value || undefined })}
                placeholder="https://{row.website}"
                className={cn(inputCls, 'font-mono text-[12px]')}
              />
              <p className="mt-1 text-[11px] leading-4 text-text-3">Use {'{row.key}'} to interpolate row fields.</p>
            </Field>
          )}

          {action.kind === 'create' && (
            <div className="rounded-md border border-border bg-surface p-2">
              <SubHead>New row fields</SubHead>
              <div className="mt-1.5">
                <KvEditor
                  map={payloadMap}
                  onChange={(payload) => onPatch({ payload })}
                  addLabel="Add field"
                  note="Creates a row on the page's resource — use {row.key} to copy fields from this row (duplicate, follow-up)."
                />
              </div>
            </div>
          )}

          {action.kind === 'delete' && (
            <p className="rounded-sm bg-tint-pink/60 px-2 py-1.5 text-[11px] leading-4 text-tint-fg-pink">
              Removes this row from the page's resource. The runner always asks for confirmation — declared or not.
            </p>
          )}

          {action.kind === 'navigate' && (
            <Field label="Href">
              <input
                value={action.href ?? ''}
                onChange={(e) => onPatch({ href: e.target.value || undefined })}
                placeholder="page:detail"
                className={cn(inputCls, 'font-mono text-[12px]')}
              />
              <p className="mt-1 text-[11px] leading-4 text-text-3">
                <span className="font-mono text-text-2">page:detail</span> or <span className="font-mono text-text-2">./detail</span> jumps to another
                page of this app; <span className="font-mono text-text-2">/…</span> is any app route. Use {'{row.key}'} to interpolate row fields.
              </p>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Show when field">
              <input
                value={asStr(when.field)}
                onChange={(e) =>
                  onPatch({ when: e.target.value ? { ...when, field: e.target.value } : undefined })
                }
                placeholder="status"
                className={cn(inputCls, 'font-mono text-[12px]')}
              />
            </Field>
            <Field label="…equals">
              <input
                value={typeof when.eq === 'string' ? when.eq : when.eq === undefined ? '' : JSON.stringify(when.eq)}
                onChange={(e) =>
                  onPatch({
                    when: when.field
                      ? { ...when, field: asStr(when.field), eq: e.target.value === '' ? undefined : coerceValue(e.target.value) }
                      : action.when,
                  })
                }
                placeholder="Open"
                className={cn(inputCls, 'font-mono text-[12px]')}
              />
            </Field>
            <Field label={reachesPeople ? 'Confirm (required — this action reaches people)' : 'Confirm text'}>
              <input
                value={action.confirm ?? ''}
                onChange={(e) => onPatch({ confirm: e.target.value || undefined })}
                placeholder={reachesPeople ? 'This contacts people. Send?' : 'Are you sure?'}
                className={cn(inputCls, reachesPeople && !action.confirm && 'border-tint-fg-pink')}
              />
              {reachesPeople && (
                <p className="mt-1 text-[11px] leading-4 text-tint-fg-pink">Emitting actions always confirm before they run.</p>
              )}
            </Field>
            <Field label="Toast text">
              <input
                value={action.toast ?? ''}
                onChange={(e) => onPatch({ toast: e.target.value || undefined })}
                placeholder="Done — {row.name} updated"
                className={inputCls}
              />
            </Field>
            <Field label="Permission gate">
              <select
                value={action.perm ?? ''}
                onChange={(e) => onPatch({ perm: e.target.value || undefined })}
                className={cn(inputCls, 'h-8 text-[12px]')}
              >
                <option value="">No gate</option>
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {placement === 'row' && (
              <SwitchLine label="Quick — visible row button (not the ⋯ menu)" checked={asBool(action.quick)} onChange={(v) => onPatch({ quick: v || undefined })} />
            )}
            <SwitchLine label="Danger — red styling, always confirms" checked={asBool(action.danger)} onChange={(v) => onPatch({ danger: v || undefined })} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- the section ---------------- */

export default function ActionsBuilder({ config, onChange, variant }: BuilderProps & { variant: 'sheet' | 'detail' | 'board' | 'pipeline' }) {
  const [tab, setTab] = useState<'rowActions' | 'headerActions'>('rowActions')
  const placement: Placement =
    variant === 'detail' ? 'footer' : variant === 'sheet' && tab === 'headerActions' ? 'header' : 'row'

  const actions =
    variant === 'detail' ? readFooterButtons(config) : variant === 'sheet' ? readActions(config[tab]) : readActions(config.rowActions)

  const write = (next: ConfigAction[]) => {
    if (variant === 'detail') {
      // Always the frozen object shape; legacy bare arrays upgrade on write.
      onChange({ ...config, footer: { ...asObj(config.footer), buttons: next } })
    } else if (variant === 'sheet') {
      onChange({ ...config, [tab]: next })
    } else {
      onChange({ ...config, rowActions: next })
    }
  }

  const patchAction = (i: number, patch: Partial<ConfigAction>) =>
    write(actions.map((a, j) => (j === i ? ({ ...a, ...patch } as ConfigAction) : a)))

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <SubHead>{variant === 'detail' ? 'Footer buttons' : variant === 'sheet' ? 'Actions' : 'Row actions'}</SubHead>

      {variant === 'sheet' && (
        <div className="flex items-center rounded-md bg-surface-2 p-0.5">
          {(
            [
              ['rowActions', 'Row actions'],
              ['headerActions', 'Header actions'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition-colors',
                tab === t ? 'bg-surface text-text-1 shadow-1' : 'text-text-3 hover:text-text-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Presets</span>
        {/* header actions run row-less, where the runner refuses `patch` and
            `delete` — only row-less kinds (link/call/create/navigate) are
            offered there */}
        {PRESETS.filter((p) => placement !== 'header' || (p.action.kind !== 'patch' && p.action.kind !== 'delete')).map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => write([...actions, { ...p.action, id: uniqueId(p.action.id, actions) }])}
            className="rounded-sm border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {actions.map((a, i) => (
          <ActionEditor
            key={i}
            action={a}
            index={i}
            count={actions.length}
            placement={placement}
            onPatch={(p) => patchAction(i, p)}
            onMove={(d) => write(moveItem(actions, i, d))}
            onRemove={() => write(actions.filter((_, j) => j !== i))}
          />
        ))}
        <AddRow
          label="Add action"
          onClick={() =>
            write([
              ...actions,
              // header actions run without a row — `patch` would be a dead button there, so the default is a link…
              placement === 'header'
                ? { id: uniqueId(`action-${actions.length + 1}`, actions), label: 'New action', kind: 'link', href: 'https://' }
                : { id: uniqueId(`action-${actions.length + 1}`, actions), label: 'New action', kind: 'patch', patch: { status: 'Done' } },
            ])
          }
        />
      </div>
    </div>
  )
}
