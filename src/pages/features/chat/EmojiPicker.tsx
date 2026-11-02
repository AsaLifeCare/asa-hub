// THE EMOJI PICKER — a grid, a search box, and what you used last.
// The chat carries emotions of every kind.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { EMOJI_GROUPS, recentEmoji, searchEmoji } from '@/lib/emoji'
import { cn } from '@/lib/utils'

export default function EmojiPicker({
  onPick,
  onClose,
  align = 'left',
  side = 'up',
}: {
  onPick: (glyph: string) => void
  onClose: () => void
  // Which edge the panel hangs from — the composer opens left, a message's reaction bar opens under whichever side…
  align?: 'left' | 'right'
  // Above the trigger or below it.
  side?: 'up' | 'down'
}) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id)
  const [recent, setRecent] = useState<string[]>(() => recentEmoji())
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    // `mousedown`, not `click`: a click that starts inside and ends outside (a drag over the grid) must not be read…
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const found = useMemo(() => searchEmoji(q), [q])
  const shown = q.trim() ? found : (EMOJI_GROUPS.find((g) => g.id === group)?.items ?? []).map(([g]) => g)

  const pick = (glyph: string) => {
    onPick(glyph)
    setRecent(recentEmoji())
  }

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="Emoji"
      className={cn(
        'absolute z-30 w-[320px] rounded-lg border border-border bg-surface shadow-3',
        side === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]',
        align === 'right' ? 'right-0' : 'left-0',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2">
          <Search size={13} className="shrink-0 text-text-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-7 w-full bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3"
          />
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <X size={14} />
        </button>
      </div>

      {!q.trim() && recent.length > 0 && (
        <div className="border-b border-border px-2 py-1.5">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">Recent</p>
          <div className="flex flex-wrap">
            {recent.slice(0, 16).map((glyph) => (
              <Glyph key={`r-${glyph}`} glyph={glyph} onPick={pick} />
            ))}
          </div>
        </div>
      )}

      <div className="scroll-thin max-h-[200px] overflow-y-auto p-1.5">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-text-3">Nothing matches “{q.trim()}”.</p>
        ) : (
          <div className="flex flex-wrap">
            {shown.map((glyph) => (
              <Glyph key={glyph} glyph={glyph} onPick={pick} />
            ))}
          </div>
        )}
      </div>

      {!q.trim() && (
        <div className="flex items-center gap-0.5 overflow-x-auto border-t border-border px-1.5 py-1">
          {EMOJI_GROUPS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              aria-label={g.label}
              title={g.label}
              className={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors',
                group === g.id ? 'bg-surface-2 text-primary' : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
              )}
            >
              <AppIcon name={g.icon} size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Glyph({ glyph, onPick }: { glyph: string; onPick: (g: string) => void }) {
  return (
    <button
      onClick={() => onPick(glyph)}
      className="grid h-8 w-8 place-items-center rounded-md text-[19px] leading-none transition-colors hover:bg-surface-2"
      // The glyph IS the label — an aria-label of "grinning face" read from a list nobody translated is worse than…
      aria-label={glyph}
    >
      {glyph}
    </button>
  )
}
