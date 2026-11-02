/** Rename modal + add-widget palette modal (moved verbatim from DashboardTemplate.tsx). */
import { useEffect, useState } from 'react'
import TintTile from '@/components/shared/TintTile'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { KIND_META } from './utils'

/* ---------- rename modal ---------- */

export function RenameModal({
  open,
  initial,
  onOpenChange,
  onSave,
}: {
  open: boolean
  initial: string
  onOpenChange: (open: boolean) => void
  onSave: (title: string) => void
}) {
  const [v, setV] = useState(initial)
  useEffect(() => {
    if (open) setV(initial)
  }, [open, initial])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[16px] font-bold text-text-1">Rename widget</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Custom titles live in your layout, not the schema.
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) {
              onSave(v.trim())
              onOpenChange(false)
            }
          }}
          className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md px-4 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            disabled={!v.trim()}
            onClick={() => {
              onSave(v.trim())
              onOpenChange(false)
            }}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- add-widget palette modal ---------- */

// One row of the app's own data list — what this page can display and whether it currently does (see `suggestions`…
export type WidgetSuggestion = { id: string; title: string; description: string; kind: string; on: boolean }

/* ---------- ready-made boards modal ---------- */

export function PresetsModal({
  open,
  onOpenChange,
  presets,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presets: { id: string; title: string; blurb: string; on: string[] }[]
  onApply: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[16px] font-bold text-text-1">Ready-made boards</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            One press arranges the company’s widgets — your own added widgets stay.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onApply(p.id)
                onOpenChange(false)
              }}
              className="flex w-full items-start gap-2.5 rounded-md border border-border bg-surface p-3 text-left transition-all duration-150 hover:border-border-strong hover:bg-surface-2 active:scale-[0.99]"
            >
              <TintTile icon="layout-dashboard" tint="lavender" size="sm" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-text-1">{p.title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-4 text-text-3">
                  {p.blurb} · {p.on.length} widgets
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AddWidgetModal({
  open,
  onOpenChange,
  onAdd,
  suggestions = [],
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (kind: string) => void
  suggestions?: WidgetSuggestion[]
  onToggle?: (id: string, on: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[16px] font-bold text-text-1">Add a widget</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            {suggestions.length > 0
              ? 'Everything this app can display, and blank widgets of your own.'
              : 'Drops into the grid — drag it anywhere, tint it, resize it.'}
          </DialogDescription>
        </DialogHeader>

        {suggestions.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              From this app’s data
            </p>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2"
                >
                  <TintTile icon={KIND_META[s.kind]?.icon ?? 'layout-grid'} tint={s.on ? 'mint' : 'blue'} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-text-1">{s.title}</span>
                    {s.description && (
                      <span className="mt-0.5 block text-[11px] leading-4 text-text-3">{s.description}</span>
                    )}
                  </span>
                  <button
                    onClick={() => onToggle?.(s.id, !s.on)}
                    className={
                      s.on
                        ? 'h-8 shrink-0 rounded-md border border-border px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2'
                        : 'h-8 shrink-0 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover'
                    }
                  >
                    {s.on ? 'Showing · remove' : 'Show'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          {suggestions.length > 0 && (
            <p className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              Blank widgets
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(KIND_META).map(([kind, meta]) => (
              <button
                key={kind}
                onClick={() => {
                  onAdd(kind)
                  onOpenChange(false)
                }}
                className="flex items-start gap-2.5 rounded-md border border-border bg-surface p-3 text-left transition-all duration-150 hover:border-border-strong hover:bg-surface-2 active:scale-[0.98]"
              >
                <TintTile icon={meta.icon} tint="blue" size="sm" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-text-1">{meta.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-text-3">{meta.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
