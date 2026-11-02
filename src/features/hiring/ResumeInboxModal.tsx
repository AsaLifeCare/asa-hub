// Resume inbox — the Drive folder recruiting drops CVs into, as one button.
// Scans on open (read-only), then imports a handful through the SAME door the "From resume" upload uses: the text…
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { ohioDayYear } from '@/lib/ohio'
import { toast } from '@/stores/useToastStore'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'
import { cn } from '@/lib/utils'

type Person = {
  name: string; fileId: string; filename: string
  modifiedTime: string; copies: number
  knownIn?: string; status?: string
  docsOnFile?: number; docTypes?: string
  /** From the ledger — what happened the last time this person was read. */
  outcome?: string; reason?: string; readAt?: string; candidateId?: string
}
type Scan = {
  fresh: Person[]; alreadyKnown: Person[]; unnamed: Person[]
  readBefore: Person[]
  filesSeen: number; truncated: boolean; batch: number; message: string
}
type Imported = {
  imported: {
    name: string; candidate_id: string; matchedExisting?: boolean
    score?: string; recommendation?: string; scoring?: string
  }[]
  skipped: { name: string; why: string }[]
  /** People the pass did not get to — the relay hangs up at 110s. */
  outOfTime?: number
  seconds?: number
  message: string
}

export default function ResumeInboxModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onImported?: () => void
}) {
  const [scan, setScan] = useState<Scan | null>(null)
  const [err, setErr] = useState('')
  // NOT EVERY NON-ANSWER IS AN ERROR — it must not bring the screen down, nor raise an error in the pop-up.
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<Imported | null>(null)

  // `keepResult` because the rescan that follows an import used to WIPE the very explanation the import had just…
  const load = useCallback(async (keepResult = false) => {
    setBusy(true); setErr(''); setPending('')
    if (!keepResult) setResult(null)
    try {
      // A SHAPE CHECK, NOT A CAST.
      const got = await gasAction<Scan>('resumeInboxScan', {})
      if (!got || !Array.isArray((got as Partial<Scan>).fresh)) {
        setPending('Still reading the folders — this scan can take most of a minute. '
          + 'Nothing was missed; press Rescan in a moment.')
        return
      }
      setScan(got)
    } catch (e) {
      // The server distinguishes "Drive refused" from "nothing new" — its sentence is better than one invented here.
      const msg = e instanceof Error ? e.message : ''
      if (!msg || /unreachable|timed? ?out|502|504/i.test(msg)) {
        setPending('Still reading the folders — this scan can take most of a minute. '
          + 'Nothing was missed; press Rescan in a moment.')
      } else {
        setErr(msg || 'The resume folder could not be read.')
      }
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  // No argument = the newest N the ledger has never seen.
  const run = async (fileId?: string) => {
    if (importing) return
    setImporting(true)
    try {
      const out = await gasAction<Imported>('resumeInboxImport',
        fileId ? { limit: 1, fileIds: fileId } : { limit: scan?.batch ?? 5 })
      setResult(out)
      invalidate('candidates'); noteWrite('candidates')
      toast({
        type: (out.imported?.length ?? 0) ? 'success' : 'warning',
        title: out.message,
        body: (out.skipped?.length ?? 0) ? 'The ones left out are listed with the reason.' : undefined,
      })
      onImported?.()
      await load(true)
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was imported', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setImporting(false) }
  }

  const fresh = scan?.fresh ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[560px] max-w-[100vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Resume inbox</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-text-2">{scan?.message ?? 'Reading the folder…'}</p>
            <button
              onClick={() => void load()} disabled={busy}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2 disabled:opacity-40"
            >
              <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} /> Rescan
            </button>
          </div>

          {err && (
            <p className="rounded-md border border-tint-pink bg-tint-pink/40 px-3 py-2 text-[13px] leading-5 text-tint-fg-pink">{err}</p>
          )}

          {pending && !err && (
            <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] leading-5 text-text-2">{pending}</p>
          )}

          {/* No silent caps: the folder is being flooded by something outside
              this platform, and a partial list must not read as the whole. */}
          {scan?.truncated && (
            <p className="rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber">
              The folder holds more files than one scan reads ({scan.filesSeen} seen). Everything
              below is real; there may be more behind it.
            </p>
          )}

          {fresh.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                New — not on the board, not on the roster ({fresh.length})
              </p>
              <div className="space-y-1">
                {fresh.map((p) => (
                  <div key={p.fileId} className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5">
                    {/* no card exists for them yet — the résumé is all there
                        is — so the NAME is the whole identity here */}
                    <DragPerson name={p.name} subtitle="Résumé in the inbox" className="flex min-w-0 flex-1 items-center gap-2.5">
                      <Avatar src="" name={p.name} size="xs" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text-1">{p.name}</span>
                    </DragPerson>
                    {/* New to the board is not new to the company: somebody
                        with documents already filed must not be asked twice. */}
                    {!!p.docsOnFile && (
                      <span className="shrink-0 rounded-full bg-tint-mint px-2 py-0.5 text-[11px] font-semibold text-tint-fg-mint"
                            title={p.docTypes}>
                        {p.docsOnFile} doc{p.docsOnFile === 1 ? '' : 's'} on file
                      </span>
                    )}
                    <span className="shrink-0 text-[11.5px] text-text-3">{ohioDayYear(p.modifiedTime)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!!scan?.alreadyKnown?.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] text-text-3">
                {scan.alreadyKnown?.length} already known — skipped
              </summary>
              <div className="mt-1.5 space-y-1">
                {scan.alreadyKnown.map((p) => (
                  <p key={p.fileId} className="text-[12.5px] text-text-3">
                    <DragPerson name={p.name} subtitle={p.knownIn === 'roster' ? 'Already staff' : 'Already on the board'}>{p.name}</DragPerson>
                    {' — '}{p.knownIn === 'roster' ? 'already staff' : `on the board${p.status ? ` (${p.status})` : ''}`}
                  </p>
                ))}
              </div>
            </details>
          )}

          {/* READ BEFORE — the ones the platform already paid to read. They are
              not hidden: the ones that could not become cards never reach the
              board, so this list is the only place their names exist. Each can
              be read again on purpose. */}
          {!!scan?.readBefore?.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] text-text-3">
                {scan.readBefore?.length} read before — not read again
              </summary>
              <div className="mt-1.5 space-y-1">
                {scan.readBefore.map((p) => (
                  <div key={p.fileId} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-text-2">
                        <DragPerson name={p.name} subtitle={p.outcome}>{p.name}</DragPerson>
                        <span className="ml-1.5 font-normal text-text-3">
                          — {p.outcome}{p.readAt ? ` · ${ohioDayYear(p.readAt)}` : ''}
                        </span>
                      </p>
                      {p.reason && <p className="text-[11.5px] leading-4 text-text-3">{p.reason}</p>}
                    </div>
                    <button
                      onClick={() => void run(p.fileId)}
                      disabled={importing || busy}
                      className="h-6 shrink-0 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
                    >
                      Read again
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {!!scan?.unnamed?.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] text-text-3">
                {scan.unnamed?.length} file(s) name nobody — open by hand
              </summary>
              <div className="mt-1.5 space-y-1">
                {scan.unnamed.map((p) => (
                  <a key={p.fileId} href={`https://drive.google.com/file/d/${p.fileId}/view`}
                     target="_blank" rel="noreferrer"
                     className="block text-[12.5px] text-primary hover:underline">{p.filename}</a>
                ))}
              </div>
            </details>
          )}

          {result && (
            <div className="space-y-1.5 rounded-md border border-border bg-surface-2/50 px-3 py-2.5">
              {result.imported.map((i) => (
                <p key={i.candidate_id} className="text-[12.5px] text-tint-fg-mint">
                  <DragPerson name={i.name} id={i.candidate_id} subtitle="Just imported">{i.name}</DragPerson>
                  {' — '}{i.matchedExisting ? 'matched an existing card, résumé attached' : 'card opened in New'}
                  {i.score ? ` · score ${i.score}/18` : ''}
                  {/* The rubric's verdict, shown and never applied: the resume
                      decision stays a person's press. */}
                  {i.recommendation ? ` · rubric suggests “${i.recommendation}” — yours to decide` : ''}
                  {i.scoring && i.scoring !== 'ok' ? ` · not scored (${i.scoring})` : ''}
                </p>
              ))}
              {result.skipped.map((s, i) => (
                <p key={i} className="text-[12.5px] text-tint-fg-amber">
                  <DragPerson name={s.name} subtitle={s.why}>{s.name}</DragPerson>
                  {' — '}{s.why}
                </p>
              ))}
              {/* A press that stopped on the clock says so — the work already
                  done is saved, and pressing again continues rather than
                  repeats. */}
              {!!result.outOfTime && (
                <p className="text-[12.5px] text-text-2">
                  {result.outOfTime} did not start — the pass ran {result.seconds}s and stopped before
                  the relay hangs up. Press Import again to continue where it left off.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button onClick={() => onOpenChange(false)}
              className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-2 hover:bg-surface-2">
              Close
            </button>
            <button
              onClick={() => void run()}
              disabled={importing || busy || !fresh.length}
              className={cn('flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40')}
            >
              {importing && <Loader2 size={14} className="animate-spin" />}
              {importing
                ? 'Reading — this can take a minute'
                : `Import ${Math.min(fresh.length, scan?.batch ?? 5)}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
