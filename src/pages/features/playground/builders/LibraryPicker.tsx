// LIBRARY PICKER — the image bank, one click away from any image-ish cell of the Rows builder, so the app builder…
// The list IS the bank: the `photos` dataset (seed-photos.ts) — the animal library first, then scenes and covers…
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import SearchInput from '@/components/shared/SearchInput'
import { photos } from '@/lib/seed-photos'
import { thumbFor } from '@/lib/thumbs'

const KIND_ORDER: Record<string, number> = { animal: 0, avatar: 1, scene: 2, cover: 3 }

export default function LibraryPicker({ onPick, onClose }: { onPick: (src: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return photos
      .filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.src.toLowerCase().includes(needle))
      .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.title.localeCompare(b.title))
  }, [q])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pick from the image bank"
        className="scroll-thin max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-xl bg-surface p-5 shadow-3"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-[15px] font-bold text-text-1">Image bank</h3>
            <p className="mt-0.5 text-[12px] text-text-3">Animals, scenes and covers — the pick lands in the cell.</p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2"
          >
            <X size={14} />
          </button>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search the bank…" className="mb-3 w-full" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.src)}
              title={`${p.title} — ${p.src}`}
              className="group overflow-hidden rounded-md border border-border text-left transition-colors hover:border-primary"
            >
              <img
                src={thumbFor(p.src)}
                alt={p.title}
                loading="lazy"
                className="aspect-[4/3] w-full bg-surface-2 object-cover"
              />
              <span className="block truncate px-1.5 py-1 text-[10.5px] text-text-2 group-hover:text-text-1">
                {p.title}
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="col-span-full py-6 text-center text-[12px] text-text-3">Nothing in the bank matches.</p>
          )}
        </div>
      </div>
    </div>
  )
}
