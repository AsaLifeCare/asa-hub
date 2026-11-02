// Config-driven "create record" modal for sheet primary actions.
// Validates required fields, re-checks the permission at the call site, persists via api.create and reports the…
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { useCan } from '@/auth/permissions'
import type { Permission } from '@/auth/types'
import { PhotoField } from '@/components/shared/EditRecordModal'
import { TINT_PAIR, TINT_VAR, type ExtendedTintName } from '@/lib/tints'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export type CreateField = {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'photo' | 'tags'
  required?: boolean
  options?: string[]
  // Colour per option (the status dropdown wears the same tints the table's chips wear) — turns the select into a…
  tints?: Record<string, ExtendedTintName>
  /** Require at least first AND last name — one word is not an identity. */
  fullName?: boolean
  placeholder?: string
}

export type CreateSpec = {
  title: string
  description?: string
  resource: string
  perm: Permission
  submitLabel?: string
  /** Two-column layout for forms carrying the whole record. */
  wide?: boolean
  // Values stamped on every created row without a visible field — e.g. a pipeline row is born stage 'new' whether…
  presets?: Record<string, string>
  // EITHER/OR requirements: the record passes when at least ONE group has every field filled — e.g.…
  requiredGroups?: { label: string; fields: string[] }[]
  fields: CreateField[]
}

// A select whose options wear their tints — dot + word, like the chips.
function ChipSelect({ field, value, invalid, openKey, setOpenKey, onPick }: {
  field: CreateField
  value: string
  invalid?: boolean
  openKey: string | null
  setOpenKey: (key: string | null) => void
  onPick: (v: string) => void
}) {
  const open = openKey === field.key
  const wrapRef = useRef<HTMLDivElement>(null)
  const tint = (o: string) => field.tints?.[o] ?? 'blue'

  // The panel covers the fields beneath it, so it has to go the moment attention leaves it: before this, a click on…
  useEffect(() => {
    if (!open) return
    const onPointerDown = (ev: PointerEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpenKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, setOpenKey])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpenKey(open ? null : field.key)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-sm border border-border bg-surface px-3 text-[13px] outline-none transition-colors focus:border-primary',
          invalid && 'border-danger',
          value ? 'text-text-1' : 'text-text-3',
        )}
      >
        {value ? (
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize leading-4', TINT_PAIR(tint(value)))}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TINT_VAR[tint(value)] }} />
            {value}
          </span>
        ) : (
          field.placeholder ?? 'Select…'
        )}
        <ChevronDown size={14} className="ml-auto shrink-0 text-text-3" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-border bg-surface p-1 shadow-2">
          {(field.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onPick(o); setOpenKey(null) }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold capitalize leading-4', TINT_PAIR(tint(o)))}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TINT_VAR[tint(o)] }} />
                {o}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export default function CreateRecordModal({
  open,
  onOpenChange,
  spec,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  spec: CreateSpec
  onCreated?: (row: any) => void
}) {
  const allowed = useCan(spec.perm)
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  /** The one chip dropdown showing, by field key — see ChipSelect. */
  const [openChip, setOpenChip] = useState<string | null>(null)

  const set = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }))
    setErrors((s) => ({ ...s, [k]: false }))
  }

  const close = (o: boolean) => {
    if (!o) {
      setValues({})
      setErrors({})
      setOpenChip(null)
    }
    onOpenChange(o)
  }

  const submit = async () => {
    if (!allowed) {
      toast({ type: 'warning', title: 'Not allowed', body: `Requires ${spec.perm} — ask an admin.` })
      return
    }
    const missing: Record<string, boolean> = {}
    for (const f of spec.fields) {
      const v = values[f.key]?.trim()
      if (f.required && !v) missing[f.key] = true
      // first AND last name — one word cannot be told apart in a directory
      else if (f.fullName && v && v.split(/\s+/).length < 2) missing[f.key] = true
    }
    // either/or groups: one of them must be whole; highlight the group closest to complete so the person finishes…
    if (spec.requiredGroups?.length) {
      const gaps = spec.requiredGroups.map((g) => g.fields.filter((k) => !values[k]?.trim()))
      if (!gaps.some((gap) => gap.length === 0)) {
        const nearest = gaps.reduce((a, b) => (b.length < a.length ? b : a))
        nearest.forEach((k) => { missing[k] = true })
        setErrors(missing)
        toast({
          type: 'warning', title: 'Missing required fields',
          body: `Fill one of: ${spec.requiredGroups.map((g) => g.label).join(' — or — ')}.`,
        })
        return
      }
    }
    if (Object.keys(missing).length) {
      setErrors(missing)
      toast({ type: 'warning', title: 'Missing required fields', body: 'Fill in the highlighted fields — the name needs first AND last.' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { ...(spec.presets ?? {}) }
      for (const f of spec.fields) {
        const v = values[f.key]?.trim()
        if (!v) continue
        if (f.type === 'number') payload[f.key] = Number(v)
        else if (f.type === 'tags') payload[f.key] = v.split(',').map((t) => t.trim()).filter(Boolean)
        else payload[f.key] = v
      }
      const row = await api.create(spec.resource, payload)
      toast({ type: 'success', title: `${spec.title} — saved`, body: 'The record was created successfully.' })
      onCreated?.(row)
      close(false)
    } catch {
      toast({ type: 'danger', title: 'Could not create record', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className={cn('bg-surface', spec.wide ? 'max-h-[85vh] overflow-y-auto sm:max-w-[640px]' : 'sm:max-w-[480px]')}
        onEscapeKeyDown={(e) => {
          // Escape answers the innermost thing that is open.
          if (openChip) {
            e.preventDefault()
            setOpenChip(null)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">{spec.title}</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            {spec.description ?? 'Fill in the details below. Required fields are marked.'}
          </DialogDescription>
        </DialogHeader>
        <div className={cn('grid gap-3', spec.wide && 'sm:grid-cols-2')}>
          {spec.fields.map((f) => (
            <label key={f.key} className={cn('grid gap-1.5', spec.wide && (f.type === 'textarea' || f.type === 'photo') && 'sm:col-span-2')}>
              <span className="text-[12px] font-medium text-text-2">
                {f.label}
                {f.required && <span className="text-danger"> *</span>}
              </span>
              {f.type === 'photo' ? (
                <PhotoField value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} name={values.name ?? ''} />
              ) : f.type === 'select' && f.tints ? (
                <ChipSelect
                  field={f}
                  value={values[f.key] ?? ''}
                  invalid={errors[f.key]}
                  openKey={openChip}
                  setOpenKey={setOpenChip}
                  onPick={(v) => set(f.key, v)}
                />
              ) : f.type === 'textarea' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={3}
                  className={cn(inputCls, 'h-auto py-2', errors[f.key] && 'border-danger')}
                />
              ) : f.type === 'select' ? (
                <select
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={cn(inputCls, errors[f.key] && 'border-danger', !values[f.key] && 'text-text-3')}
                >
                  <option value="" disabled>
                    {f.placeholder ?? 'Select…'}
                  </option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o} className="text-text-1">
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className={cn(inputCls, errors[f.key] && 'border-danger')}
                />
              )}
            </label>
          ))}
        </div>
        <DialogFooter>
          <button
            onClick={() => close(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? 'Saving…' : (spec.submitLabel ?? 'Create')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
