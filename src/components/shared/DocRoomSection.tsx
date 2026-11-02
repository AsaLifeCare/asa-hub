// A reading room as a SECTION of the desk that owns the subject — the fold the gap survey's rooms mount through on…
// Collapsed by default and the room is NOT mounted until opened: a closed fold must cost nothing…
import { useState } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import DriveReadingRoom from '@/components/shared/DriveReadingRoom'
import { cn } from '@/lib/utils'

export default function DocRoomSection({ room, title, line }: {
  room: 'interviews' | 'invoices' | 'audits' | 'training' | 'isp'
  title: string
  line: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="mt-5 rounded-lg border border-border bg-surface shadow-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-lavender text-tint-fg-lavender">
          <FolderOpen size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-text-1">{title}</span>
          <span className="block text-[12px] text-text-3">{line}</span>
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <DriveReadingRoom room={room} />
        </div>
      )}
    </section>
  )
}
