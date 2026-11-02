// `tags` section — editable tag row.
// Users holding `section.perm` (default "tags.edit") get an inline editor (add/remove + tint picker) persisting via…
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { staggerItem } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { api } from '@/lib/api'
import { useCan } from '@/auth/permissions'
import type { Permission } from '@/auth/types'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'

export function TagsSection({ section, record }: { section: any; record: any }) {
  const perm = (section.perm ?? 'tags.edit') as Permission
  const canEdit = useCan(perm)
  const [tags, setTags] = useState<string[]>(() => (record?.[section.tagsField ?? 'tags'] as string[]) ?? [])
  const [tintMap, setTintMap] = useState<Record<string, TintName>>(
    () => (record?.tagTints as Record<string, TintName>) ?? {},
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftTint, setDraftTint] = useState<TintName>('mint')
  const [saving, setSaving] = useState(false)
  const palette: TintName[] = section.tints ?? ['mint', 'blue', 'lavender', 'peach', 'amber', 'pink']
  const resource = section.resource ?? 'people'
  const tintFor = (t: string, i: number) => tintMap[t] ?? palette[i % palette.length]

  const persist = async (next: string[], nextTints: Record<string, TintName>) => {
    if (!canEdit) {
      toast({ type: 'warning', title: 'Not allowed', body: `Requires ${perm} — ask an admin.` })
      return
    }
    setSaving(true)
    try {
      await api.update(resource, String(record.id), { [section.tagsField ?? 'tags']: next, tagTints: nextTints } as never)
      setTags(next)
      setTintMap(nextTints)
      toast({ type: 'success', title: 'Tags updated', body: `${record.name ?? 'Record'} now has ${next.length} tag${next.length === 1 ? '' : 's'}.` })
    } catch {
      toast({ type: 'danger', title: 'Could not save tags', body: 'Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const addTag = () => {
    const t = draft.trim()
    if (!t || tags.includes(t)) return
    setDraft('')
    void persist([...tags, t], { ...tintMap, [t]: draftTint })
  }
  const removeTag = (t: string) => {
    const nextTints = { ...tintMap }
    delete nextTints[t]
    void persist(tags.filter((x) => x !== t), nextTints)
  }

  return (
    <motion.section variants={staggerItem}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{section.title}</h3>
        {canEdit && (
          <button
            onClick={() => setEditing((e) => !e)}
            aria-pressed={editing}
            className={cn(
              'flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition-colors duration-150',
              editing ? 'bg-primary-soft text-primary-strong' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
            )}
          >
            <AppIcon name={editing ? 'check' : 'pencil'} size={11} />
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className="text-[12px] text-text-3">No tags yet.</p>}
        {tags.map((t, i) => {
          const tint = tintFor(t, i)
          return (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium leading-4"
              style={{ background: TINT_BG_VAR[tint], color: TINT_VAR[tint] }}
            >
              {t}
              {editing && (
                <button
                  aria-label={`Remove tag ${t}`}
                  disabled={saving}
                  onClick={() => removeTag(t)}
                  className="grid h-3.5 w-3.5 place-items-center rounded-full transition-opacity hover:opacity-70"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
            </span>
          )
        })}
      </div>
      {editing && (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5">
            {palette.map((t) => (
              <button
                key={t}
                aria-label={`Tint ${t}`}
                aria-pressed={draftTint === t}
                onClick={() => setDraftTint(t)}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform duration-150',
                  draftTint === t ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'opacity-70 hover:opacity-100',
                )}
                style={{ background: TINT_VAR[t] }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="New tag…"
              disabled={saving}
              className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
            />
            <button
              onClick={addTag}
              disabled={saving || !draft.trim()}
              className="flex h-8 items-center gap-1 rounded-sm bg-primary px-3 text-[12px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover disabled:opacity-40"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      )}
    </motion.section>
  )
}
