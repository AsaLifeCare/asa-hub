// Onboarding documents — the whole required list for one candidate, with the file that proves each item.
// Two things the old world could not do, and the reason this screen exists: 1.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CloudUpload, ExternalLink, FolderOpen, RotateCcw, ShieldCheck } from 'lucide-react'
import { openFile } from '@/stores/useFileViewerStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MAX_UPLOAD_BYTES, fileToBase64, gasAction, humanSize } from './shared'
import { ohioWall } from '@/lib/ohio'
import DragPerson from '@/components/shared/DragPerson'
import { useCan } from '@/auth'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'

export type DocItem = {
  doc_id: string
  label: string
  kind: string
  required: boolean
  applies_to?: string
  status: 'missing' | 'uploaded' | 'verified' | 'returned' | string
  review_status?: string
  file_url?: string
  file_name?: string
  issued_on?: string
  expires_on?: string
  uploaded_at?: string
  uploaded_by?: string
}

type DocState = {
  items: DocItem[]
  uploaded: number
  total: number
  required_missing: string[]
  folder_url?: string
}

// How long the new-hire account may keep filing paperwork — the onboarding twin of the interviewer's day-of window…
type WindowState = {
  window_open?: boolean
  window_from?: string
  window_until?: string
  window_reason?: string
  /** true only for the trainee account — admins are never limited by it */
  window_applies?: boolean
  can_extend?: boolean
}

// The access window's edges, as OHIO days.
const day = (iso?: string) => {
  const d = iso ? ohioWall(iso) : null
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Write-ledger envelope from the /gas relay — the save is accepted (queued, or executed with its receipt lost) but…
const accepted = (d: any) => d && typeof d === 'object' && d.accepted === true

const STATUS_STYLE: Record<string, string> = {
  verified: 'bg-tint-mint text-tint-fg-mint',
  uploaded: 'bg-tint-blue text-tint-fg-blue',
  returned: 'bg-tint-amber text-tint-fg-amber',
  missing: 'bg-surface-2 text-text-3',
}

const STATUS_LABEL: Record<string, string> = {
  verified: 'Verified',
  uploaded: 'Awaiting review',
  returned: 'Returned',
  missing: 'Missing',
}

export default function OnboardingDocsModal({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidateId: string
  candidateName: string
  onChanged?: (state: DocState) => void
}) {
  const canReview = useCan('hiring.edit')
  const [state, setState] = useState<DocState | null>(null)
  const [windowState, setWindowState] = useState<WindowState | null>(null)
  const [movingWindow, setMovingWindow] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pickerFor = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await gasAction<DocState>('docList', { candidate_id: candidateId })
      setState(res)
      onChanged?.(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the document list.')
    }
    try {
      setWindowState(await gasAction<WindowState>('onboardingWindowGet', { candidate_id: candidateId }))
    } catch {
      setWindowState(null) // no window yet is not an error worth showing
    }
    // onChanged is a fresh closure on every parent render — including it would reload the list in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId])

  useEffect(() => {
    if (!open) return
    setState(null)
    void load()
  }, [open, load])

  const choose = (docId: string) => {
    pickerFor.current = docId
    inputRef.current?.click()
  }

  const onFile = async (file: File | undefined) => {
    const docId = pickerFor.current
    pickerFor.current = null
    if (!file || !docId) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`${file.name} is too large (${humanSize(file.size)}) — the limit is 15MB.`)
      return
    }
    setBusy(docId)
    setError(null)
    try {
      const base64 = await fileToBase64(file)
      const res = await gasAction<{ state: DocItem[] }>('docUpload', {
        candidate_id: candidateId,
        doc_id: docId,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        base64,
      })
      if (res?.state) {
        const items = res.state
        const next: DocState = {
          items,
          uploaded: items.filter((i) => i.status === 'uploaded' || i.status === 'verified').length,
          total: items.length,
          required_missing: items
            .filter((i) => i.required && i.status !== 'uploaded' && i.status !== 'verified')
            .map((i) => i.label),
          folder_url: state?.folder_url,
        }
        setState(next)
        onChanged?.(next)
      } else {
        await load()
      }
      toast({ type: 'success', title: 'Document filed', body: `${file.name} → ${candidateName}'s folder.` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — try again.')
    } finally {
      setBusy(null)
    }
  }

  /** Move one edge of the new-hire's access window. */
  const moveWindow = async (edge: 'earlier' | 'later', days: number) => {
    setMovingWindow(true)
    try {
      const res = await gasAction<WindowState>(
        'onboardingSetWindow',
        edge === 'later'
          ? { candidate_id: candidateId, extend_days: days }
          : { candidate_id: candidateId, open_earlier_days: days },
      )
      if (accepted(res)) {
        // Write-ledger envelope: the change is saved but the new dates did not come back — reload instead of…
        await load()
        toast({
          type: 'success',
          title: edge === 'later' ? `Access extended by ${days}d` : `Access opened ${days}d earlier`,
          body: 'Saved — the dates shown come from a fresh read.',
        })
        return
      }
      setWindowState((w) => (w ? { ...w, ...res } : w))
      toast({
        type: 'success',
        title: edge === 'later' ? `Access extended by ${days}d` : `Access opened ${days}d earlier`,
        body: `New-hire access: ${day(res.window_from)} → ${day(res.window_until)}.`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the window.')
    } finally {
      setMovingWindow(false)
    }
  }

  const review = async (docId: string, decision: 'verified' | 'returned') => {
    setBusy(docId)
    setError(null)
    try {
      await gasAction('docReview', { candidate_id: candidateId, doc_id: docId, decision })
      await load()
      toast({
        type: decision === 'verified' ? 'success' : 'info',
        title: decision === 'verified' ? 'Document verified' : 'Document returned',
        body: decision === 'verified' ? 'Counts towards the onboarding gate.' : 'The candidate has to send it again.',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the review.')
    } finally {
      setBusy(null)
    }
  }

  const done = state?.uploaded ?? 0
  const total = state?.total ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">
            Onboarding documents —{' '}
            <DragPerson name={candidateName} id={candidateId}>
              {candidateName}
            </DragPerson>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Each file lands in this candidate&apos;s own folder in Drive. Uploading records the
            evidence; an admin still has to verify it.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] font-semibold text-text-2">
            {state ? `${done} of ${total} on file` : 'Loading…'}
          </span>
          {state?.folder_url && (
            <a
              href={state.folder_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
            >
              <FolderOpen size={12} /> Drive folder
            </a>
          )}
        </div>

        {error && (
          <p className="rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>
        )}

        {/* Access window — the new hire is not staff yet, so their account is
            a bounded stay. Recruiters widen it here, per person, both ways. */}
        {windowState && (windowState.window_from || windowState.window_until) && (
          <div
            className={cn(
              'rounded-md px-3 py-2 text-[12.5px]',
              windowState.window_applies && windowState.window_open === false
                ? 'bg-tint-amber text-tint-fg-amber'
                : 'bg-surface-2 text-text-2',
            )}
          >
            <p className="font-medium">
              New-hire access: {day(windowState.window_from)} → {day(windowState.window_until)}
              {windowState.window_open === false ? ` · ${windowState.window_reason || 'closed'}` : ''}
            </p>
            {windowState.can_extend && (
              <div className="mt-1.5 grid gap-1.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[86px] shrink-0 text-[11px] opacity-80">Open earlier</span>
                  {[1, 3, 7, 30].map((d) => (
                    <button
                      key={`b${d}`}
                      type="button"
                      disabled={movingWindow}
                      onClick={() => void moveWindow('earlier', d)}
                      className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      −{d}d
                    </button>
                  ))}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[86px] shrink-0 text-[11px] opacity-80">Extend later</span>
                  {[1, 3, 7, 30].map((d) => (
                    <button
                      key={`f${d}`}
                      type="button"
                      disabled={movingWindow}
                      onClick={() => void moveWindow('later', d)}
                      className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      +{d}d
                    </button>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}

        <ul className="scroll-thin max-h-[52vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
          {(state?.items ?? []).map((it) => {
            const working = busy === it.doc_id
            return (
              <li key={it.doc_id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="clamp-1 text-[13px] font-semibold text-text-1">{it.label}</span>
                    {!it.required && (
                      <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
                        optional
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                        STATUS_STYLE[it.status] ?? STATUS_STYLE.missing,
                      )}
                    >
                      {STATUS_LABEL[it.status] ?? it.status}
                    </span>
                    {it.expires_on && (
                      <span className="text-[11px] text-text-3">expires {it.expires_on}</span>
                    )}
                    {it.file_url && (
                      // reviewers read the document inside the platform — the viewer offers the new tab for whoever…
                      <button
                        type="button"
                        onClick={() => openFile({ title: it.label, subtitle: 'Onboarding document', url: it.file_url as string })}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        <ExternalLink size={10} /> open
                      </button>
                    )}
                  </span>
                </span>

                {canReview && (it.status === 'uploaded' || it.status === 'verified') && (
                  <span className="flex shrink-0 gap-1">
                    {it.status !== 'verified' && (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => void review(it.doc_id, 'verified')}
                        title="Verify"
                        className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-tint-fg-mint transition-colors hover:bg-surface-2 disabled:opacity-50"
                      >
                        <ShieldCheck size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void review(it.doc_id, 'returned')}
                      title="Return to candidate"
                      className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-tint-fg-amber transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </span>
                )}

                <button
                  type="button"
                  disabled={working}
                  onClick={() => choose(it.doc_id)}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50',
                    it.status === 'missing'
                      ? 'bg-primary text-on-primary hover:bg-primary-hover'
                      : 'border border-border bg-surface text-text-1 hover:bg-surface-2',
                  )}
                >
                  {working ? (
                    'Saving…'
                  ) : it.status === 'missing' ? (
                    <>
                      <CloudUpload size={13} /> Upload
                    </>
                  ) : (
                    <>
                      <Check size={13} /> Replace
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {state && state.required_missing.length > 0 && (
          <p className="text-[12px] leading-5 text-text-3">
            Still required: {state.required_missing.join(' · ')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
