// BUNDLE GALLERY — "Start from a template".
// A modal of curated, ready-made app bundles.
import { Check, Download, X } from 'lucide-react'
import TintTile from '@/components/shared/TintTile'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import type { PlaygroundBundle } from './validation'
import { PAGE_TYPES } from './starters'
import { CURATED_BUNDLES } from './bundles'

/** Page-type chip label for a type id ("sheet" → "Sheet"). */
function typeLabel(id: string): string {
  return PAGE_TYPES.find((t) => t.id === id)?.label ?? id
}

export default function BundleGallery({
  open,
  onClose,
  onInstall,
}: {
  open: boolean
  onClose: () => void
  onInstall: (bundle: PlaygroundBundle) => void
}) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Start from a template"
        className="scroll-thin max-h-[88vh] w-full max-w-[760px] overflow-y-auto rounded-xl bg-surface p-5 shadow-3"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-bold text-text-1">Start from a template</h2>
            <p className="mt-0.5 text-[12.5px] text-text-2">
              Curated apps for the operation, installable in one click. Install loads a fresh draft — review it, then publish.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CURATED_BUNDLES.map((b) => {
            const app = b.bundle.app
            const types = [...new Set(app.pages.map((p) => p.type))]
            return (
              <div key={b.id} className="flex flex-col rounded-lg border border-border bg-surface p-3.5">
                <div className="flex items-start gap-3">
                  <TintTile icon={app.icon ?? 'rocket'} tint={(app.accent ?? 'lavender') as TintName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-text-1">{app.name}</p>
                    <p className="text-[11.5px] leading-4 text-text-3">{app.tagline}</p>
                  </div>
                </div>
                <p className="mt-2.5 text-[12.5px] leading-[1.45] text-text-2">{b.blurb}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-2"
                    >
                      {typeLabel(t)}
                    </span>
                  ))}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-3">
                    {app.pages.length} page{app.pages.length === 1 ? '' : 's'}
                  </span>
                </div>
                <button
                  onClick={() => onInstall(b.bundle)}
                  className={cn(
                    'mt-3 flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3',
                    'text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover active:scale-[0.98]',
                  )}
                >
                  <Download size={13} /> Install
                </button>
              </div>
            )
          })}
        </div>

        <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-text-3">
          <Check size={12} className="shrink-0 text-tint-fg-mint" />
          Installs land as drafts, exactly like an imported file — nothing is published until you hit Publish app.
        </p>
      </div>
    </div>
  )
}
