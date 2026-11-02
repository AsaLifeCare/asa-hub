// Import a document that already exists somewhere else — a Google Doc, a Drive PDF, a policy on a share.
// Nothing is copied: the library gains an entry that opens the real file inside the platform (FileViewer), so there…
import { useState } from 'react'
import { Link2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toEmbedUrl } from '@/stores/useFileViewerStore'

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export function ImportLinkModal({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onImport: (v: { title: string; url: string }) => Promise<void> | void
}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = url.trim()
  const valid = /^https?:\/\//i.test(trimmed)
  // Told up front, not after saving: some hosts refuse to be framed.
  const framable = valid && toEmbedUrl(trimmed).embeddable

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onImport({ title: title.trim() || 'Linked document', url: trimmed })
      setTitle('')
      setUrl('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Import a link</DialogTitle>
          <DialogDescription>
            A Google Doc or Drive file stays where it is — the library just points at it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Title</span>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Medication Administration Policy"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-text-2">Link</span>
            <input
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/…"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          {valid && (
            <p className="flex items-start gap-2 rounded-sm bg-surface-2 px-3 py-2 text-[11.5px] leading-4 text-text-2">
              <Link2 size={13} className="mt-[1px] shrink-0 text-text-3" />
              {framable
                ? 'This link opens inside the platform.'
                : "This host blocks embedding — the entry will open it in a new tab instead."}
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add to library'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
