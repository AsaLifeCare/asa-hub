// SHARED BUILDER PRIMITIVES — the small parts every visual schema builder composes: labelled fields, tint dot…
// Two rules every builder here obeys: 1.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { AppIcon, ALL_PICKER_ICONS, ICON_GROUPS } from '@/lib/icons'
import { CUSTOM_CATEGORY_TINTS } from '@/lib/categories'
import { TINT_BG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import { inputCls, type EditorMode } from './utils'

/* ---------------- mode toggle (Visual | Advanced JSON) ---------------- */

export function ModeToggle({ mode, onChange }: { mode: EditorMode; onChange: (m: EditorMode) => void }) {
  return (
    <div className="flex items-center rounded-md bg-surface-2 p-0.5">
      {(
        [
          ['visual', 'Visual'],
          ['json', 'Advanced (JSON)'],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition-colors',
            mode === m ? 'bg-surface text-text-1 shadow-1' : 'text-text-3 hover:text-text-2',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Compact validity dot for Visual mode (the full chip lives in Advanced). */
export function ValidityDot({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span
      title={title}
      className={cn('inline-block h-2 w-2 rounded-full', ok ? 'bg-tint-fg-mint' : 'bg-tint-fg-pink')}
    />
  )
}

/* ---------------- field chrome ---------------- */

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{label}</span>
      {children}
    </label>
  )
}

/** Sub-heading inside a builder (between row lists and option groups). */
export function SubHead({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">{children}</p>
  )
}

export function SwitchLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12.5px] text-text-2">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

/* ---------------- tint dot picker (same pattern as the accent picker) ---------------- */

export function TintDots({
  value,
  onChange,
  tints = CUSTOM_CATEGORY_TINTS,
}: {
  value: TintName | undefined
  onChange: (t: TintName) => void
  tints?: readonly TintName[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tints.map((t) => (
        <button
          key={t}
          type="button"
          title={t}
          onClick={() => onChange(t)}
          className={cn(
            'h-6 w-6 rounded-full transition-transform',
            TINT_BG[t],
            value === t ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'hover:scale-105',
          )}
        />
      ))}
    </div>
  )
}

// value → tint map editor (chip columns, timeline kinds, stage tags…).
export function TintByEditor({
  map,
  onChange,
  addLabel = 'Add value',
}: {
  map: Record<string, TintName>
  onChange: (next: Record<string, TintName>) => void
  addLabel?: string
}) {
  const entries = Object.entries(map)
  const setEntry = (i: number, key: string, tint: TintName) => {
    const next: Record<string, TintName> = {}
    entries.forEach(([k, t], j) => {
      next[j === i ? key : k] = j === i ? tint : t
    })
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {entries.map(([k, t], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => setEntry(i, e.target.value, t)}
            placeholder="Value, e.g. Active"
            className={cn(inputCls, 'h-8 flex-1 text-[12px]')}
          />
          <TintDots value={t} onChange={(nt) => setEntry(i, k, nt)} />
          <IconBtn
            title="Remove value"
            danger
            onClick={() => {
              const next = { ...map }
              delete next[k]
              onChange(next)
            }}
            icon={<X size={12} />}
          />
        </div>
      ))}
      <AddRow label={addLabel} small onClick={() => onChange({ ...map, [`value-${entries.length + 1}`]: 'blue' })} />
    </div>
  )
}

/* ---------------- icon pickers ---------------- */

/** The grouped, scrollable icon grid — extracted verbatim from App identity. */
export function IconGrid({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div className="max-h-[168px] space-y-2.5 overflow-y-auto pr-1">
      {ICON_GROUPS.map((g) => (
        <div key={g.id}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">{g.label}</p>
          <div className="flex flex-wrap gap-1">
            {g.icons.map((n) => (
              <button
                key={n}
                type="button"
                title={n}
                onClick={() => onChange(n)}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-sm border transition-colors',
                  value === n
                    ? 'border-primary bg-primary-soft text-primary-strong'
                    : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                )}
              >
                <AppIcon name={n} size={14} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Collapsible icon picker for list rows (collections) — a full grid per row would bury the builder, so the grid…
export function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2"
        title="Pick an icon"
      >
        <AppIcon name={value || 'circle'} size={14} />
        <span className="max-w-[90px] truncate font-mono text-[11px]">{value || 'icon'}</span>
        {open ? <ChevronDown size={12} className="text-text-3" /> : <ChevronRight size={12} className="text-text-3" />}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-border bg-bg p-2">
          <IconGrid
            value={value}
            onChange={(n) => {
              onChange(n)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

// Compact icon select for tight rows (detail stats) where even the collapsible grid is too much chrome.
export function IconSelect({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-border bg-surface text-text-2">
        <AppIcon name={value || 'circle'} size={14} />
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'h-8 text-[12px]')}>
        <option value="">No icon</option>
        {ALL_PICKER_ICONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ---------------- list-row chrome ---------------- */

export function IconBtn({
  title,
  onClick,
  icon,
  danger = false,
  disabled = false,
}: {
  title: string
  onClick: () => void
  icon: ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-surface transition-colors hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-surface',
        danger ? 'text-tint-fg-pink' : 'text-text-2',
      )}
    >
      {icon}
    </button>
  )
}

/** Up / down / remove for every reorderable builder list. */
export function RowMoves({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(-1)} icon={<ArrowUp size={12} />} />
      <IconBtn title="Move down" disabled={index === count - 1} onClick={() => onMove(1)} icon={<ArrowDown size={12} />} />
      <IconBtn title="Remove" danger onClick={onRemove} icon={<X size={12} />} />
    </div>
  )
}

export function AddRow({ label, onClick, small = false }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border font-semibold text-text-2 transition-colors hover:bg-surface-2',
        small ? 'h-7 text-[11px]' : 'h-8 text-[12px]',
      )}
    >
      <Plus size={12} /> {label}
    </button>
  )
}

/* ---------------- invalid JSON notice ---------------- */

// Visual mode parses the same JSON the Advanced editor owns.
export function InvalidJsonNotice({ message, line }: { message: string; line?: number }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2.5">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-tint-fg-amber" />
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-text-1">Visual mode needs valid JSON</p>
        <p className="mt-0.5 text-[12px] leading-4 text-text-2">
          {message}
          {line ? ` (line ${line})` : ''} — switch to <b>Advanced (JSON)</b> to fix it; the visual editor picks
          up from there.
        </p>
      </div>
    </div>
  )
}
