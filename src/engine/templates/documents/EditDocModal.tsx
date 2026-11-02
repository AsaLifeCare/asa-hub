// Edit an existing document.
// The reader's "Edit" used to be a toast saying editing was disabled.
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Doc, DocBlock } from '@/engine/types'
import type { CollectionCfg } from './types'
import { CoverPicker } from './covers'
import { parseMarkdown } from './importDoc'

/** Blocks → Markdown, so what you see is what the reader has. */
export function blocksToMarkdown(blocks: DocBlock[]): string {
  return blocks
    .map((b) => {
      if (b.kind === 'h2') return `## ${b.text}`
      if (b.kind === 'h3') return `### ${b.text}`
      if (b.kind === 'callout') return `> ${b.text}`
      if (b.kind === 'code') return '```\n' + b.text + '\n```'
      return b.text
    })
    .join('\n\n')
}

export function EditDocModal({
  doc,
  collections,
  onClose,
  onSaved,
}: {
  doc: Doc
  collections: CollectionCfg[]
  onClose: () => void
  onSaved: (d: Doc) => void
}) {
  const [title, setTitle] = useState(doc.title)
  const [collection, setCollection] = useState(doc.collection)
  const [cover, setCover] = useState(doc.cover)
  const [body, setBody] = useState(() => blocksToMarkdown(doc.body))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (busy) return
    setBusy(true)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const { blocks } = parseMarkdown(body)
    const firstPara = blocks.find((b): b is Extract<DocBlock, { kind: 'p' }> => b.kind === 'p')
    const next: Doc = {
      ...doc,
      title: title.trim() || doc.title,
      collection,
      cover,
      body: blocks,
      excerpt: (firstPara?.text ?? doc.excerpt).slice(0, 140),
      readMinutes: Math.max(1, Math.round(words / 200) || 1),
      updatedAt: new Date().toISOString(),
    }
    try {
      await api.update('documents', doc.id, next)
    } catch {
      /* the local copy still updates; the sheet is retried on the next save */
    }
    onSaved(next)
    toast({ type: 'success', title: 'Document saved', body: next.title })
    setBusy(false)
    onClose()
  }

  const inputCls =
    'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit document"
        className="scroll-thin max-h-[88vh] w-full max-w-[640px] overflow-y-auto rounded-xl bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-bold text-text-1">Edit document</h2>
            <p className="mt-0.5 text-[12.5px] text-text-2">Markdown: ## heading, ### sub-heading, - bullet.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <X size={15} />
          </button>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={cn(inputCls, 'mb-4')} />

        <label className="mb-1 block text-[12px] font-medium text-text-2">Collection</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {collections.map((c) => (
            <button
              key={c.id}
              onClick={() => setCollection(c.id)}
              aria-pressed={collection === c.id}
              className={cn(
                'h-8 rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
                collection === c.id
                  ? 'border-primary bg-primary-soft text-primary-strong'
                  : 'border-border text-text-2 hover:bg-surface-2',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Cover</label>
        <div className="mb-4">
          <CoverPicker cover={cover} onChange={setCover} />
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          className={cn(inputCls, 'mb-5 h-auto py-2 font-mono text-[12.5px] leading-5')}
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="h-9 flex-1 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
