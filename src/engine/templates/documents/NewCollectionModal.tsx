// New collection — the left rail, editable from the screen itself.
// The rail used to be a hardcoded list in the app registry, so "add a collection" meant a code change and the…
import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import type { CollectionCfg } from './types'

const TINTS: TintName[] = ['blue', 'mint', 'lavender', 'peach', 'amber', 'pink']

/** Icons that actually read as a folder of documents at 14px. */
const ICONS = ['folder', 'book-open', 'shield', 'graduation-cap', 'clipboard-list', 'heart-pulse', 'palette', 'code']

export function NewCollectionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (c: CollectionCfg) => void
}) {
  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState(ICONS[0])
  const [tint, setTint] = useState<TintName>('blue')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const name = label.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const res = await gasAction<{ collection?: CollectionCfg }>('collectionCreate', {
        label: name,
        icon,
        tint,
      })
      const created = res?.collection ?? ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: name, icon, tint } as CollectionCfg)
      onCreate(created)
      toast({ type: 'success', title: 'Collection created', body: name })
      onClose()
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not create the collection',
        body: err instanceof Error ? err.message : 'Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

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
        aria-label="New collection"
        className="w-full max-w-[420px] rounded-xl bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-bold text-text-1">New collection</h2>
            <p className="mt-0.5 text-[12.5px] text-text-2">A shelf in the library — documents pick one.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <X size={15} />
          </button>
        </div>

        <label className="mb-1 block text-[12px] font-medium text-text-2">
          Name <span className="text-danger">*</span>
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          autoFocus
          placeholder="e.g. Onboarding, Nursing, Safety"
          className="mb-4 h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-border-strong"
        />

        <p className="mb-1.5 text-[12px] font-medium text-text-2">Icon</p>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {ICONS.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              aria-pressed={icon === ic}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-md border transition-colors',
                icon === ic ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border text-text-2 hover:bg-surface-2',
              )}
            >
              <AppIcon name={ic} size={15} />
            </button>
          ))}
        </div>

        <p className="mb-1.5 text-[12px] font-medium text-text-2">Colour</p>
        <div className="mb-5 flex flex-wrap gap-1.5">
          {TINTS.map((t) => (
            <button
              key={t}
              onClick={() => setTint(t)}
              aria-pressed={tint === t}
              title={t}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-md border transition-all',
                tint === t ? 'border-primary scale-105' : 'border-border hover:scale-105',
              )}
              style={{ background: TINT_BG[t], color: TINT_FG[t] }}
            >
              <AppIcon name={icon} size={14} />
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-md border border-border bg-surface text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!label.trim() || busy}
            className="h-9 flex-1 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create collection'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
