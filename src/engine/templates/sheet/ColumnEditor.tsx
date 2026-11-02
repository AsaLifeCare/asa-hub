// The pencil — adjust a table's columns the way you would in a spreadsheet.
// Reorder, hide, widen, wrap, rename.
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, RotateCcw, Save } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Column } from './types'

/** What a person changed about a table — only the differences, never a copy. */
export type ColumnOverride = {
  key: string
  hidden?: boolean
  width?: number
  wrap?: number
  label?: string
  order?: number
}

const storageKey = (scope: string, userId: string) => `asa-columns-v1:${userId}:${scope}`

export function loadColumnLayout(scope: string, userId: string): ColumnOverride[] {
  try {
    const raw = localStorage.getItem(storageKey(scope, userId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveColumnLayout(scope: string, userId: string, overrides: ColumnOverride[]) {
  try {
    if (overrides.length === 0) localStorage.removeItem(storageKey(scope, userId))
    else localStorage.setItem(storageKey(scope, userId), JSON.stringify(overrides))
  } catch {
    /* storage blocked — the layout lives for this page view only */
  }
}

/** Apply a saved layout over the columns the app declares. */
export function applyColumnLayout(columns: Column[], overrides: ColumnOverride[]): Column[] {
  if (overrides.length === 0) return columns
  const byKey = new Map(overrides.map((o) => [o.key, o]))
  const out = columns
    .map((c, i) => {
      const o = byKey.get(c.key)
      if (!o) return { col: c, order: i, hidden: false }
      return {
        col: {
          ...c,
          ...(o.width ? { width: o.width, minWidth: undefined } : {}),
          ...(o.wrap !== undefined ? { wrap: o.wrap || undefined } : {}),
          ...(o.label ? { label: o.label } : {}),
        },
        order: o.order ?? i,
        hidden: Boolean(o.hidden),
      }
    })
    .filter((e) => !e.hidden)
    .sort((a, b) => a.order - b.order)
  // a layout that hides everything is a mistake, not an instruction
  return out.length ? out.map((e) => e.col) : columns
}

export default function ColumnEditor({
  scope,
  userId,
  columns,
  overrides,
  onChange,
  onPublish,
}: {
  /** what this layout belongs to — tenant + resource + page */
  scope: string
  userId: string
  /** the columns the app declares, before any layout is applied */
  columns: Column[]
  overrides: ColumnOverride[]
  onChange: (next: ColumnOverride[]) => void
  /** admins only: make this layout the app's default for everyone */
  onPublish?: (next: ColumnOverride[]) => Promise<void> | void
}) {
  const [draft, setDraft] = useState<ColumnOverride[]>(overrides)
  const [publishing, setPublishing] = useState(false)
  useEffect(() => setDraft(overrides), [overrides])

  /** The declared columns in the order the draft puts them. */
  const rows = useMemo(() => {
    const byKey = new Map(draft.map((o) => [o.key, o]))
    return columns
      .map((c, i) => ({ col: c, o: byKey.get(c.key), order: byKey.get(c.key)?.order ?? i }))
      .sort((a, b) => a.order - b.order)
  }, [columns, draft])

  const patch = (key: string, change: Partial<ColumnOverride>) => {
    setDraft((d) => {
      const next = [...d]
      const i = next.findIndex((o) => o.key === key)
      if (i >= 0) next[i] = { ...next[i], ...change }
      else next.push({ key, ...change })
      return next
    })
  }

  const move = (key: string, dir: -1 | 1) => {
    const order = rows.map((r) => r.col.key)
    const i = order.indexOf(key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    setDraft(() => order.map((k, idx) => {
      const prev = draft.find((o) => o.key === k)
      return { ...(prev ?? { key: k }), key: k, order: idx }
    }))
  }

  const apply = () => {
    saveColumnLayout(scope, userId, draft)
    onChange(draft)
    toast({ type: 'success', title: 'Layout saved', body: 'Just for you — use “Save for everyone” to make it the default.' })
  }

  const reset = () => {
    saveColumnLayout(scope, userId, [])
    setDraft([])
    onChange([])
    toast({ type: 'info', title: 'Back to the original layout' })
  }

  const publish = async () => {
    if (!onPublish) return
    setPublishing(true)
    try {
      await onPublish(draft)
      saveColumnLayout(scope, userId, [])
      onChange(draft)
      toast({ type: 'success', title: 'Saved for everyone', body: 'This is the table’s layout now.' })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save for everyone', body: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Adjust columns"
          title="Adjust columns"
          className="grid h-9 w-9 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
        >
          <Pencil size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="font-display text-[13px] font-semibold text-text-1">Columns</p>
          <p className="text-[11.5px] text-text-3">Order, width, wrapping and names. Saved for you unless you publish it.</p>
        </div>

        <div className="scroll-thin max-h-[340px] overflow-y-auto p-2">
          {rows.map(({ col, o }, i) => (
            <div key={col.key} className="mb-1 rounded-sm border border-border p-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => patch(col.key, { hidden: !o?.hidden })}
                  title={o?.hidden ? 'Show this column' : 'Hide this column'}
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-sm transition-colors hover:bg-surface-2',
                    o?.hidden ? 'text-text-3' : 'text-primary',
                  )}
                >
                  {o?.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <input
                  value={o?.label ?? col.label}
                  onChange={(e) => patch(col.key, { label: e.target.value })}
                  className={cn(
                    'h-7 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 text-[12.5px] font-semibold text-text-1 outline-none hover:border-border focus:border-primary',
                    o?.hidden && 'text-text-3 line-through',
                  )}
                />
                <span className="shrink-0 font-mono text-[10px] text-text-3">{col.kind}</span>
                <button
                  onClick={() => move(col.key, -1)}
                  disabled={i === 0}
                  aria-label="Move left"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  onClick={() => move(col.key, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move right"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
              </div>
              {!o?.hidden && (
                <div className="mt-1.5 flex items-center gap-3 pl-7">
                  <label className="flex items-center gap-1.5 text-[11px] text-text-3">
                    Width
                    <input
                      type="number"
                      min={60}
                      step={10}
                      placeholder="auto"
                      value={o?.width ?? ''}
                      onChange={(e) => patch(col.key, { width: parseInt(e.target.value, 10) || undefined })}
                      className="h-6 w-[68px] rounded-sm border border-border bg-surface px-1.5 text-[11.5px] text-text-1 outline-none focus:border-primary"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-text-3">
                    Lines
                    <select
                      value={o?.wrap ?? col.wrap ?? 1}
                      onChange={(e) => patch(col.key, { wrap: parseInt(e.target.value, 10) })}
                      className="h-6 rounded-sm border border-border bg-surface px-1 text-[11.5px] text-text-1 outline-none focus:border-primary"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            onClick={reset}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <span className="flex-1" />
          {onPublish && (
            <button
              onClick={publish}
              disabled={publishing}
              title="Make this the default for everyone"
              className="h-8 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {publishing ? 'Saving…' : 'Save for everyone'}
            </button>
          )}
          <button
            onClick={apply}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Save size={12} /> Apply
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
