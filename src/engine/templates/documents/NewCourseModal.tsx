/** New course modal — title/collection/description, editable module rows with
 *  time estimate, cover picker (moved verbatim from DocumentsTemplate.tsx). */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, GraduationCap, Plus, X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { api } from '@/lib/api'
import { people } from '@/lib/seed'
import { TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Doc, DocBlock } from '@/engine/types'
import type { CollectionCfg, CourseModule } from './types'
import { fmtMinutes, slug } from './utils'
import { DEFAULT_COVER, CoverPicker } from './covers'

type ModuleRow = { key: string; title: string; minutes: string }

export function NewCourseModal({
  collections,
  canEdit,
  onClose,
  onCreate,
}: {
  collections: CollectionCfg[]
  canEdit: boolean
  onClose: () => void
  onCreate: (d: Doc) => void
}) {
  const [title, setTitle] = useState('')
  const [collection, setCollection] = useState(collections[0]?.id ?? '')
  const [description, setDescription] = useState('')
  const [cover, setCover] = useState(DEFAULT_COVER)
  const [rows, setRows] = useState<ModuleRow[]>([
    { key: 'm-1', title: '', minutes: '15' },
    { key: 'm-2', title: '', minutes: '15' },
  ])
  const [tried, setTried] = useState(false)

  const totalMin = rows.reduce((a, r) => a + (parseInt(r.minutes, 10) || 0), 0)
  const moduleCount = rows.filter((r) => r.title.trim()).length
  const valid = title.trim().length > 0 && moduleCount > 0

  const setRow = (key: string, patch: Partial<ModuleRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () =>
    setRows((rs) => [...rs, { key: `m-${Date.now().toString(36)}`, title: '', minutes: '15' }])
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs))

  const create = () => {
    setTried(true)
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires knowledge.edit — ask an admin' })
      return
    }
    if (!valid) return
    const modules: CourseModule[] = rows
      .filter((r) => r.title.trim())
      .map((r, i) => ({
        id: `${slug(r.title) || 'module'}-${i + 1}`,
        title: r.title.trim(),
        minutes: Math.max(1, parseInt(r.minutes, 10) || 10),
      }))
    const body: DocBlock[] = [
      {
        kind: 'p',
        text:
          description.trim() ||
          'A self-paced course. Work through the modules in order and check them off in the sidebar as you go.',
      },
      ...modules.flatMap((m): DocBlock[] => [
        { kind: 'h2', id: m.id, text: m.title },
        { kind: 'p', text: `${m.title} — about ${m.minutes} minutes. Notes, links and checklists for this module live here.` },
      ]),
    ]
    const base: Doc = {
      id: `d-local-${Date.now().toString(36)}`,
      title: title.trim(),
      excerpt: description.trim().slice(0, 120) || `${modules.length} modules · about ${fmtMinutes(totalMin)}.`,
      collection,
      cover: cover || DEFAULT_COVER,
      authorIds: [people[0]?.id ?? 'p-01'],
      updatedAt: new Date().toISOString(),
      readMinutes: Math.max(1, totalMin),
      body,
    }
    const courseDoc: Doc & { kind: 'course'; modules: CourseModule[] } = { ...base, kind: 'course', modules }
    api.create('documents', courseDoc).catch(() => {})
    onCreate(courseDoc)
    toast({ type: 'success', title: 'Course created', body: courseDoc.title })
  }

  const inputCls =
    'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New course"
        className="scroll-thin max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-xl bg-surface p-6 shadow-3"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-[17px] font-bold text-text-1">
            <GraduationCap size={18} className="text-primary" /> New course
          </h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={16} />
          </button>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">
          Title <span className="text-danger">*</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. New Hire Orientation"
          autoFocus
          className={cn(inputCls, 'mb-1', tried && !title.trim() && 'border-danger')}
        />
        {tried && !title.trim() ? (
          <p className="mb-3 text-[11px] text-danger">A title is required.</p>
        ) : (
          <div className="mb-3" />
        )}

        <label className="mb-1 block text-[12px] font-medium text-text-2">Collection</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {collections.map((c) => (
            <button
              key={c.id}
              onClick={() => setCollection(c.id)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors duration-150',
                collection === c.id
                  ? 'border-transparent bg-primary-soft text-primary-strong'
                  : 'border-border bg-surface text-text-2 hover:bg-surface-2',
              )}
            >
              <AppIcon name={c.icon} size={13} className={TINT_FG[c.tint]} />
              {c.label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What does this course cover? Shown at the top of the reader."
          className="scroll-thin mb-4 w-full resize-y rounded-sm border border-border bg-surface p-3 text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />

        {/* modules */}
        <div className="mb-1 flex items-center">
          <label className="text-[12px] font-medium text-text-2">
            Modules <span className="text-danger">*</span>
          </label>
          <span className="ml-auto flex items-center gap-1 text-[12px] text-text-3">
            <Clock size={12} /> Estimated time: <span className="font-semibold tabular-nums text-text-1">{fmtMinutes(totalMin)}</span>
          </span>
        </div>
        <div className="mb-2 space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold tabular-nums text-text-2">
                {i + 1}
              </span>
              <input
                value={r.title}
                onChange={(e) => setRow(r.key, { title: e.target.value })}
                placeholder={`Module ${i + 1} title`}
                className={cn(inputCls, 'flex-1', tried && !r.title.trim() && rows.some((x) => !x.title.trim()) && moduleCount === 0 && 'border-danger')}
              />
              <input
                type="number"
                min={1}
                value={r.minutes}
                onChange={(e) => setRow(r.key, { minutes: e.target.value })}
                aria-label={`Module ${i + 1} duration in minutes`}
                className={cn(inputCls, 'w-[72px]')}
              />
              <span className="shrink-0 text-[11px] text-text-3">min</span>
              <button
                onClick={() => removeRow(r.key)}
                aria-label={`Remove module ${i + 1}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-danger"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        {tried && moduleCount === 0 && <p className="mb-2 text-[11px] text-danger">Add at least one module with a title.</p>}
        <button
          onClick={addRow}
          className="mb-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong text-[13px] font-medium text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-2"
        >
          <Plus size={14} /> Add module
        </button>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Cover</label>
        <CoverPicker cover={cover} onChange={setCover} />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2">
            Cancel
          </button>
          <button
            onClick={create}
            disabled={tried && !valid}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            <GraduationCap size={14} /> Create course
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
