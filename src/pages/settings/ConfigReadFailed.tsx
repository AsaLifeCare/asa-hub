// A SETTINGS SECTION WHOSE CONFIG READ FAILED says so in place, with the way to ask again — never a "Reading the…
// The switches stay hidden: a law nobody could read must not be written over by one accidental flip.
import { RotateCw } from 'lucide-react'

export default function ConfigReadFailed({ why, onRetry }: { why: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2.5 text-[13px] leading-[20px] text-text-1">
      <p>
        The config could not be read — {why}. These switches stay hidden until it can be, so nothing
        here is written over a value nobody read.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
      >
        <RotateCw size={13} /> Try again
      </button>
    </div>
  )
}
