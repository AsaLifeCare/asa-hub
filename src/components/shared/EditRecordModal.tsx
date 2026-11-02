// Config-driven "edit record" modal — the editing counterpart of CreateRecordModal.
// Prefills from an existing record, validates required fields, re-checks the permission at the call site and…
import { useEffect, useRef, useState } from 'react'
import { ANIMAL_AVATARS, AnimalAvatarSvg, animalValue } from '@/lib/animalAvatars'
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from 'lucide-react'
import { gasAction, fileToBase64, inferMime, humanSize, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'
import { ohioDayYear } from '@/lib/ohio'
import { attachmentId, openAttachment, parseAttachments, TASK_ATTACH_ACCEPT, TASK_ATTACH_MAX, type TaskAttachment } from '@/lib/taskAttachments'
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
import { toast } from '@/stores/useToastStore'
import SafeImg, { TilePicker, parseIconRef, tintForName, type FallbackTint } from '@/components/shared/SafeImg'
import { cn } from '@/lib/utils'
import { thumbFor } from '@/lib/thumbs'

export type EditField = {
  key: string // supports dot paths, e.g. "guardian.email"
  label: string
  type?: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'photo' | 'tags' | 'paragraphs' | 'attachments'
  required?: boolean
  options?: string[]
  placeholder?: string
}

export type EditSpec = {
  title: string
  description?: string
  resource: string
  perm: Permission
  submitLabel?: string
  fields: EditField[]
}

// The 12 GENERATED faces that used to sit here are gone — those fake users were removed from the whole platform…

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

// IMAGES AND PDFS ON A CARD (Task Board): the file bytes go to Drive through taskFileStore; the LIST is this…
function AttachmentsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const list = parseAttachments(value)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pick = async (f: File) => {
    const isImage = f.type.startsWith('image/')
    if (!isImage && f.type !== 'application/pdf') {
      toast({ type: 'warning', title: 'Images and PDFs only' })
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast({ type: 'warning', title: 'Too large', body: `${humanSize(f.size)} — up to 15MB.` })
      return
    }
    if (list.length >= TASK_ATTACH_MAX) {
      toast({ type: 'warning', title: `Up to ${TASK_ATTACH_MAX} attachments per card` })
      return
    }
    setBusy(true)
    try {
      const base64 = await fileToBase64(f)
      const d = await gasAction<{ url: string; name: string; mime: string }>('taskFileStore', {
        base64, filename: f.name, mime: f.type || inferMime(f),
      })
      const next: TaskAttachment[] = [...list, {
        id: attachmentId(),
        name: d.name, url: d.url, mime: d.mime, at: new Date().toISOString(),
      }]
      onChange(JSON.stringify(next))
    } catch (e) {
      toast({ type: 'danger', title: 'Upload failed', body: e instanceof Error ? e.message : 'Try again.' })
    }
    setBusy(false)
  }
  return (
    <div className="rounded-sm border border-border bg-surface p-2">
      {list.length === 0 && <p className="px-1 pb-1 text-[12px] italic text-text-3">Nothing attached yet.</p>}
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-surface-2">
          {a.mime.startsWith('image/') ? <ImageIcon size={13} className="shrink-0 text-text-3" /> : <FileText size={13} className="shrink-0 text-text-3" />}
          <button
            type="button"
            onClick={() => void openAttachment(a)}
            className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-primary hover:underline"
            title="Open in the viewer"
          >
            {a.name}
          </button>
          {/* the upload stamp on Ohio's clock — its first ten characters are the
              UTC day, already tomorrow through every Ohio evening */}
          <span className="shrink-0 text-[10.5px] tabular-nums text-text-3">{ohioDayYear(a.at ?? '')}</span>
          <button
            type="button"
            onClick={() => onChange(JSON.stringify(list.filter((x) => x.id !== a.id)))}
            title="Remove from this card (the file itself is kept)"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-danger"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept={TASK_ATTACH_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void pick(f)
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="mt-1 inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
        {busy ? 'Uploading…' : 'Attach image or PDF'}
      </button>
    </div>
  )
}

/** Read a (possibly dotted) key from a record. */
export function getDeep(record: any, path: string): any {
  if (!record) return undefined
  if (path in record) return record[path]
  return path.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), record)
}

// Build an update payload: dotted keys become nested objects merged over the record's existing sub-objects…
function buildPatch(record: any, entries: [string, unknown][]): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [path, value] of entries) {
    const parts = path.split('.')
    if (parts.length === 1) {
      patch[path] = value
      continue
    }
    const top = parts[0]
    const existing = (patch[top] as Record<string, unknown>) ?? (record?.[top] as Record<string, unknown>) ?? {}
    const clone = { ...existing }
    let cur: Record<string, unknown> = clone
    for (let i = 1; i < parts.length - 1; i++) {
      cur[parts[i]] = { ...((cur[parts[i]] as Record<string, unknown>) ?? {}) }
      cur = cur[parts[i]] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]] = value
    patch[top] = clone
  }
  return patch
}

// Preset-grid + icon tile + URL photo picker with live preview.
export function BankGrid({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [bank, setBank] = useState<{ src: string; title?: string; assignedTo?: string }[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    let alive = true
    api.list<{ src?: string; kind?: string; hidden?: unknown; title?: string; assignedTo?: string }>('photos')
      .then((rows) => {
        if (!alive) return
        // the resource can answer the same photo more than once (seed + live rows, re-imports) — one tile per…
        const seen = new Set<string>()
        setBank(
          (rows ?? [])
            .filter((p) => p.kind === 'avatar' && p.src && String(p.hidden ?? '') !== 'true')
            .filter((p) => {
              const k = String(p.src)
              if (seen.has(k)) return false
              seen.add(k)
              return true
            })
            .map((p) => ({ src: String(p.src), title: p.title, assignedTo: p.assignedTo })),
        )
      })
      .catch(() => setBank([]))
    return () => { alive = false }
  }, [])
  if (bank === null) {
    return <p className="py-1 text-[11.5px] text-text-3">Reading the Image Bank…</p>
  }
  if (bank.length === 0) return null
  const shown = showAll ? bank : bank.slice(0, 11)
  return (
    <div className={cn('grid grid-cols-6 gap-1.5', showAll && 'max-h-56 overflow-y-auto pr-1')}>
      {shown.map((p) => (
        <button
          key={p.src}
          type="button"
          title={p.assignedTo || p.title || ''}
          aria-pressed={value === p.src}
          onClick={() => onChange(p.src)}
          className={cn(
            'relative aspect-square overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-surface transition-all duration-150',
            value === p.src ? 'ring-primary' : 'ring-transparent hover:ring-border-strong',
          )}
        >
          <SafeImg src={thumbFor(p.src)} icon="user" size="h-full w-full" />
        </button>
      ))}
      {!showAll && bank.length > 11 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          title={`Show all ${bank.length} photos`}
          className="grid aspect-square place-items-center rounded-full border border-dashed border-border-strong text-[15px] font-bold text-text-2 hover:bg-surface-2"
        >
          …
        </button>
      )}
    </div>
  )
}

export function PhotoField({
  value,
  onChange,
  error,
  name,
}: {
  value: string
  onChange: (v: string) => void
  error?: boolean
  name?: string
}) {
  const iconRef = parseIconRef(value)
  const [tile, setTile] = useState<{ icon: string; tint: FallbackTint }>(() => ({
    icon: iconRef?.icon ?? 'user',
    tint: iconRef?.tint ?? tintForName(name ?? 'photo'),
  }))
  useEffect(() => {
    const ref = parseIconRef(value)
    if (ref) setTile({ icon: ref.icon, tint: ref.tint ?? tintForName(name ?? 'photo') })
  }, [value, name])
  return (
    <div className="grid gap-2">
      {/* THE DRAWINGS: animals instead of strangers'
          faces, and the last four move — a blink, a tail, a hop. Inline SVG,
          so choosing one costs no request and no licence. */}
      <div className="grid gap-1">
        <span className="text-[11px] font-medium text-text-3">Drawings</span>
        <div className="flex flex-wrap gap-1.5">
          {ANIMAL_AVATARS.map((a) => {
            const v = animalValue(a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(v)}
                aria-pressed={value === v}
                title={a.animated ? `${a.label} — it moves` : a.label}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full border transition-colors',
                  value === v ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2',
                )}
              >
                <AnimalAvatarSvg id={a.id} size={26} />
              </button>
            )
          })}
        </div>
      </div>
      <BankGrid value={value} onChange={onChange} />
      <div className="flex items-center gap-2.5">
        <SafeImg
          src={value || null}
          name={name}
          icon={tile.icon}
          tint={tile.tint}
          size={40}
          className="border border-border"
        />
        <TilePicker
          icon={tile.icon}
          tint={tile.tint}
          onChange={(v) => {
            setTile(v)
            onChange(`icon:${v.icon}:${v.tint}`)
          }}
        />
        <button
          type="button"
          onClick={() => onChange('')}
          aria-pressed={!value}
          title="Use the initials tile"
          className={cn(
            'h-9 shrink-0 rounded-md border px-2.5 text-[12px] font-semibold transition-colors',
            !value ? 'border-primary text-primary-strong' : 'border-border text-text-2 hover:bg-surface-2',
          )}
        >
          Initials
        </button>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste an image URL"
          className={cn(inputCls, error && 'border-danger')}
        />
      </div>
    </div>
  )
}

export default function EditRecordModal({
  open,
  onOpenChange,
  record,
  spec,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: any
  spec: EditSpec
  onSaved?: (row: any) => void
}) {
  const allowed = useCan(spec.perm)
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  // prefill from the record whenever the modal opens for a (new) row
  useEffect(() => {
    if (!open || !record) return
    const next: Record<string, string> = {}
    for (const f of spec.fields) {
      const v = getDeep(record, f.key)
      // attachments live as a JSON string in the cell — normalize, never join
      next[f.key] = f.type === 'attachments'
        ? JSON.stringify(parseAttachments(v))
        : Array.isArray(v)
          ? v.join(f.type === 'paragraphs' ? '\n\n' : ', ')
          : v == null
            ? ''
            : String(v)
    }
    setValues(next)
    setErrors({})
  }, [open, record, spec.fields])

  const set = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }))
    setErrors((s) => ({ ...s, [k]: false }))
  }

  const close = (o: boolean) => {
    if (!o) setErrors({})
    onOpenChange(o)
  }

  const submit = async () => {
    if (!allowed) {
      toast({ type: 'warning', title: 'Not allowed', body: `Requires ${spec.perm} — ask an admin.` })
      return
    }
    const missing: Record<string, boolean> = {}
    for (const f of spec.fields) if (f.required && !values[f.key]?.trim()) missing[f.key] = true
    if (Object.keys(missing).length) {
      setErrors(missing)
      toast({ type: 'warning', title: 'Missing required fields', body: 'Fill in the highlighted fields to continue.' })
      return
    }
    setSaving(true)
    try {
      const entries: [string, unknown][] = spec.fields.map((f) => {
        const v = (values[f.key] ?? '').trim()
        if (f.type === 'attachments') return [f.key, v || '[]']
        if (f.type === 'number') return [f.key, v ? Number(v) : null]
        if (f.type === 'tags') return [f.key, v ? v.split(',').map((t) => t.trim()).filter(Boolean) : []]
        if (f.type === 'paragraphs') return [f.key, v ? v.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : []]
        return [f.key, v]
      })
      const patch = buildPatch(record, entries)
      const row = await api.update(spec.resource, String(record.id), patch)
      toast({ type: 'success', title: `${spec.title} — saved`, body: 'The record was updated successfully.' })
      onSaved?.(row)
      close(false)
    } catch {
      toast({ type: 'danger', title: 'Could not save changes', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-surface sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">{spec.title}</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            {spec.description ?? `Update the details for ${record?.name ?? 'this record'}. Required fields are marked.`}
          </DialogDescription>
        </DialogHeader>
        <div className="scroll-thin grid max-h-[52vh] gap-3 overflow-y-auto pr-1">
          {spec.fields.map((f) => (
            <label key={f.key} className="grid gap-1.5">
              <span className="text-[12px] font-medium text-text-2">
                {f.label}
                {f.required && <span className="text-danger"> *</span>}
              </span>
              {f.type === 'photo' ? (
                <PhotoField
                  value={values[f.key] ?? ''}
                  onChange={(v) => set(f.key, v)}
                  error={errors[f.key]}
                  name={record?.name ? String(record.name) : undefined}
                />
              ) : f.type === 'attachments' ? (
                <AttachmentsField value={values[f.key] ?? '[]'} onChange={(v) => set(f.key, v)} />
              ) : f.type === 'textarea' || f.type === 'paragraphs' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder ?? (f.type === 'paragraphs' ? 'Separate paragraphs with a blank line' : undefined)}
                  rows={f.type === 'paragraphs' ? 7 : 3}
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
                  placeholder={f.placeholder ?? (f.type === 'tags' ? 'Comma-separated, e.g. Driver, Bilingual' : undefined)}
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
            {saving ? 'Saving…' : (spec.submitLabel ?? 'Save changes')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
