// FORMS — the "Import a Google Form" modal.
// ONE STEP, because the job is one paste: the Google Forms edit link, an optional title override and an optional…
import { useState } from 'react'
import { Import } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { gasAction, inputCls } from '@/features/hiring/shared'

type ImportResult = {
  slug: string
  title: string
  questions: number
  skipped: string[]
  breakdown?: string
  contact_block?: string
}

const labelCls = 'mb-1.5 block text-[12px] font-medium text-text-2'

export default function ImportFormModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs when the modal closes after a successful import — the list re-reads. */
  onImported: () => void
}) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [notifyTo, setNotifyTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<ImportResult | null>(null)

  const reset = () => {
    setUrl('')
    setTitle('')
    setNotifyTo('')
    setBusy(false)
    setError('')
    setDone(null)
  }

  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      if (done) onImported()
      reset()
    }
  }

  const run = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await gasAction<ImportResult>('formImportGoogle', {
        url: url.trim(),
        title: title.trim() || undefined,
        notify_to: notifyTo.trim() || undefined,
      }, { timeoutMs: 60_000 })
      setDone(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-surface sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            Import a Google Form
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            The questions are copied — the link here keeps working the day the Google original is gone.
            Any form link works: the short forms.gle one, the send link, or the edit link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className={labelCls}>Google Forms link</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/forms/d/…"
              className={inputCls}
              disabled={!!done}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && !done && void run()}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Title (optional — the form&rsquo;s own wins by default)</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave empty to keep the form's title"
              className={inputCls}
              disabled={!!done}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Notify answers to (optional e-mail)</span>
            <input
              value={notifyTo}
              onChange={(e) => setNotifyTo(e.target.value)}
              placeholder="somebody@asalifecare.com"
              className={inputCls}
              disabled={!!done}
            />
          </label>

          {error && <p className="text-[12px] font-medium text-danger">{error}</p>}

          {done && (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-600">
              Imported &lsquo;{done.title}&rsquo; — {done.questions} question{done.questions === 1 ? '' : 's'}
              {done.breakdown ? <> (kept: {done.breakdown})</> : null}
              {done.skipped.length > 0 && (
                <>, {done.skipped.length} skipped ({done.skipped.join('; ')})</>
              )}
              {done.contact_block?.startsWith('off') ? <>. Contact block off — the form asks for a name itself</> : null}
              . The link is open already.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          {done ? (
            <button
              onClick={() => close(false)}
              className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={() => close(false)}
                disabled={busy}
                className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void run()}
                disabled={!url.trim() || busy}
                title={url.trim() ? undefined : 'Paste the link first'}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                <Import size={14} /> {busy ? 'Importing…' : 'Import'}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
