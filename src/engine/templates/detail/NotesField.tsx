// Save goes through the normal api.update door, so the sheet row itself is what changes.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/stores/useToastStore'

export type NotesFieldSpec = {
  field: string
  resource: string
  label?: string
  placeholder?: string
}

export function NotesField({
  spec,
  record,
  onSaved,
}: {
  spec: NotesFieldSpec
  record: any
  onSaved: (row: any) => void
}) {
  const stored = String(record?.[spec.field] ?? '')
  const [value, setValue] = useState(stored)
  const [saving, setSaving] = useState(false)
  // ROOM TO WRITE — an option to enlarge the box and write a note with a better view of it.
  const [big, setBig] = useState(false)
  // a different record in the same panel starts from ITS text, not the last one's
  useEffect(() => setValue(String(record?.[spec.field] ?? '')), [record?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = value !== stored

  // Escape closes the large view.
  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [big])

  const save = async () => {
    if (!record?.id || saving || !dirty) return
    setSaving(true)
    try {
      await api.update(spec.resource as never, String(record.id), { [spec.field]: value } as never)
      onSaved({ ...record, [spec.field]: value })
      toast({ type: 'success', title: 'Saved' })
    } catch (err) {
      toast({ type: 'danger', title: 'Could not save', body: err instanceof Error ? err.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const label = spec.label ?? 'Notes'
  const placeholder = spec.placeholder ?? 'Type the activity or note…'
  const saveBtn = (
    <button
      onClick={() => void save()}
      disabled={!dirty || saving}
      className="h-8 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  )

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</p>
        <button
          type="button"
          onClick={() => setBig(true)}
          title="Write in a bigger view"
          aria-label="Expand the note editor"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <Maximize2 size={13} />
        </button>
      </div>
      <textarea
        rows={5}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        className="w-full resize-y rounded-sm border border-border bg-bg px-3 py-2 text-[13px] leading-5 text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {dirty && !big && <span className="text-[11.5px] text-text-3">unsaved</span>}
        {saveBtn}
      </div>

      {/* Rendered through a PORTAL. The detail panel is a scrolling column with
          its own stacking context, and a fixed overlay inside it is clipped by
          the very panel it is trying to escape. */}
      {big && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 sm:p-8"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(false) }}
        >
          <div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-[13px] font-semibold text-text-1">{label}</p>
              <button
                type="button"
                onClick={() => setBig(false)}
                aria-label="Close the bigger view"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <X size={15} />
              </button>
            </div>
            <textarea
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[14px] leading-6 text-text-1 outline-none placeholder:text-text-3"
            />
            <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
              <span className="mr-auto text-[11.5px] text-text-3">
                {dirty ? 'Unsaved — closing keeps what you typed.' : 'Saved.'}
              </span>
              {saveBtn}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
