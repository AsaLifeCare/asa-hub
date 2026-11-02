// CHECKLIST — a page type for "walk through this and tick it off".
// House audits, kitchen and bathroom cleaning rounds, shift handovers, new manager training: the estate is full of…
import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, CircleDashed, RotateCcw, Send, TriangleAlert } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import { api } from '@/lib/api'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

type Tick = 'ok' | 'issue' | null

export default function ChecklistTemplate({ config, data, schema }: TemplateProps) {
  const groupKey = (config.groupKey as string) ?? 'section'
  const labelKey = (config.labelKey as string) ?? 'item'
  const noteKey = (config.noteKey as string) ?? 'note'
  const requiredKey = (config.requiredKey as string) ?? 'required'
  const saveTo = (config.resource as string) ?? schema.dataSource.resource
  const storageKey = `asa-checklist:${schema.dataSource.resource}:${schema.id}`

  const user = useAuthStore((s) => s.user)
  const [ticks, setTicks] = useState<Record<string, Tick>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    } catch {
      return {}
    }
  })
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const persist = (next: Record<string, Tick>) => {
    setTicks(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* private mode — the run still works, it just will not survive a reload */
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, any[]>()
    data.forEach((r) => {
      const g = String(r[groupKey] ?? '').trim() || 'Checklist'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(r)
    })
    return [...map.entries()]
  }, [data, groupKey])

  const idOf = (r: any, i: number) => String(r.id ?? `${r[labelKey]}-${i}`)
  const total = data.length
  const done = data.filter((r, i) => ticks[idOf(r, i)]).length
  const issues = data.filter((r, i) => ticks[idOf(r, i)] === 'issue').length
  const missingRequired = data.filter(
    (r, i) => String(r[requiredKey] ?? '').toLowerCase() === 'yes' && !ticks[idOf(r, i)],
  ).length

  const submit = async () => {
    if (saving) return
    setSaving(true)
    const lines = data.map((r, i) => ({
      item: String(r[labelKey] ?? ''),
      section: String(r[groupKey] ?? ''),
      state: ticks[idOf(r, i)] ?? 'skipped',
      note: notes[idOf(r, i)] ?? String(r[noteKey] ?? ''),
    }))
    try {
      await api.create(saveTo as never, {
        id: `RUN_${Date.now().toString(36).toUpperCase()}`,
        completedBy: user?.name ?? '',
        completedAt: new Date().toISOString(),
        total,
        ok: lines.filter((l) => l.state === 'ok').length,
        issues: lines.filter((l) => l.state === 'issue').length,
        skipped: lines.filter((l) => l.state === 'skipped').length,
        lines: JSON.stringify(lines),
      } as never)
      toast({
        type: issues ? 'warning' : 'success',
        title: issues ? `Submitted with ${issues} issue${issues > 1 ? 's' : ''}` : 'Checklist submitted',
        body: `${done} of ${total} lines · signed by ${user?.name ?? 'you'}`,
      })
      persist({})
      setNotes({})
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not submit the run',
        body: err instanceof Error ? err.message : 'Your ticks are still here — try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  if (total === 0) {
    return (
      <Card>
        <EmptyState title="Nothing on this checklist yet" body="Add lines to the source sheet and they appear here." />
      </Card>
    )
  }

  return (
    <div className="w-full">
      <PageHeader
        title={schema.title}
        subtitle={`${done} of ${total} checked${issues ? ` · ${issues} issue${issues > 1 ? 's' : ''}` : ''}`}
        actions={
          <>
            <button
              onClick={() => persist({})}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <RotateCcw size={14} className="text-text-3" /> Reset
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving || done === 0}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
            >
              <Send size={14} /> {saving ? 'Submitting…' : 'Submit run'}
            </button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <motion.div
            className={cn('h-full rounded-full', issues ? 'bg-tint-fg-amber' : 'bg-primary')}
            animate={{ width: `${(done / total) * 100}%` }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          />
        </div>
        {missingRequired > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-tint-amber px-2.5 py-1 text-[11.5px] font-semibold text-tint-fg-amber">
            <TriangleAlert size={12} /> {missingRequired} required line{missingRequired > 1 ? 's' : ''} left
          </span>
        )}
      </div>

      <div className="grid gap-3">
        {groups.map(([group, lines]) => (
          <Card key={group} padded={false}>
            <p className="border-b border-border px-4 py-2.5 text-[13px] font-bold text-text-1">{group}</p>
            <ul className="divide-y divide-border">
              {lines.map((r) => {
                const i = data.indexOf(r)
                const id = idOf(r, i)
                const state = ticks[id] ?? null
                const required = String(r[requiredKey] ?? '').toLowerCase() === 'yes'
                return (
                  <li key={id} className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-text-1">
                          {String(r[labelKey] ?? '')}
                          {required && <span className="ml-1.5 text-[11px] font-semibold text-danger">required</span>}
                        </span>
                        {r[noteKey] && <span className="block text-[11.5px] text-text-3">{String(r[noteKey])}</span>}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {(
                          [
                            { v: 'ok' as const, icon: Check, on: 'bg-tint-mint text-tint-fg-mint', label: 'Fine' },
                            { v: 'issue' as const, icon: TriangleAlert, on: 'bg-tint-amber text-tint-fg-amber', label: 'Issue' },
                          ]
                        ).map((opt) => (
                          <button
                            key={opt.v}
                            aria-label={opt.label}
                            title={opt.label}
                            onClick={() => persist({ ...ticks, [id]: state === opt.v ? null : opt.v })}
                            className={cn(
                              'grid h-8 w-8 place-items-center rounded-md border transition-colors',
                              state === opt.v ? `border-transparent ${opt.on}` : 'border-border text-text-3 hover:bg-surface-2',
                            )}
                          >
                            <opt.icon size={14} />
                          </button>
                        ))}
                        {state === null && <CircleDashed size={14} className="ml-1 self-center text-text-3" />}
                      </span>
                    </div>
                    {state === 'issue' && (
                      <input
                        value={notes[id] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [id]: e.target.value }))}
                        placeholder="What is wrong? This is what someone reads tomorrow."
                        className="mt-2 h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
