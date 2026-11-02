/** New document modal (moved verbatim from DocumentsTemplate.tsx). */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { api } from '@/lib/api'
import { people } from '@/lib/seed'
import { TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Doc } from '@/engine/types'
import type { CollectionCfg } from './types'
import { DEFAULT_COVER, CoverPicker } from './covers'

export function NewDocModal({
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
  const [cover, setCover] = useState(DEFAULT_COVER)
  const [body, setBody] = useState('')

  const create = () => {
    if (!canEdit) {
      toast({ type: 'warning', title: 'Requires knowledge.edit — ask an admin' })
      return
    }
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const newDoc: Doc = {
      id: `d-local-${Date.now().toString(36)}`,
      title: title.trim() || 'Untitled document',
      excerpt: body.trim().slice(0, 120) || 'A brand-new document.',
      collection,
      cover: cover || DEFAULT_COVER,
      authorIds: [people[0]?.id ?? 'p-01'],
      updatedAt: new Date().toISOString(),
      readMinutes: Math.max(1, Math.round(words / 200) || 1),
      body: [
        { kind: 'h2', id: 'overview', text: 'Overview' },
        { kind: 'p', text: body.trim() || 'Start writing — this page is yours.' },
      ],
    }
    api.create('documents', newDoc).catch(() => {})
    onCreate(newDoc)
    toast({ type: 'success', title: 'Document created', body: newDoc.title })
  }

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
        aria-label="New document"
        className="scroll-thin max-h-[86vh] w-full max-w-[540px] overflow-y-auto rounded-xl bg-surface p-6 shadow-3"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-[17px] font-bold text-text-1">New document</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
            <X size={16} />
          </button>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Remote Work Policy"
          autoFocus
          className="mb-4 h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />

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

        <label className="mb-1 block text-[12px] font-medium text-text-2">Cover</label>
        <CoverPicker cover={cover} onChange={setCover} />

        <label className="mb-1 block text-[12px] font-medium text-text-2">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Write the first section…"
          className="scroll-thin mb-1 w-full resize-y rounded-sm border border-border bg-surface p-3 font-mono text-[13px] leading-5 text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />
        <p className="mb-5 text-[11px] text-text-3">Markdown supported</p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2">
            Cancel
          </button>
          <button onClick={create} className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]">
            Create document
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
