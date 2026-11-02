// The CJIS folder, as one button.
// Somebody outside this platform files background reports into a Drive folder, and the Hub never knew.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { invalidate } from '@/lib/apiCache'
import { noteWrite } from '@/lib/snapshotClient'

type Row = {
  candidate_id: string; name: string; status: string
  cjis_status?: string; has_doc?: boolean
  filename?: string; file_url?: string; at?: string
}
type Scan = {
  found: Row[]; already: Row[]; without: Row[]
  filesSeen: number; truncated: boolean
  unparsed: string[]; unparsedCount: number
  message: string
}

export default function CjisFolderModal({
  open, onOpenChange, onAttached,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onAttached?: () => void
}) {
  const [scan, setScan] = useState<Scan | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      setScan(await gasAction<Scan>('cjisScan', {}))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The CJIS folder could not be read.')
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  const attach = async (only?: string) => {
    if (writing) return
    setWriting(true)
    try {
      const r = await gasAction<{ message: string; attached: unknown[] }>(
        'cjisApply', only ? { candidate_ids: only } : {})
      toast({ type: r.attached.length ? 'success' : 'warning', title: r.message })
      invalidate('candidates'); noteWrite('candidates')
      onAttached?.()
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was attached', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setWriting(false) }
  }

  const found = scan?.found ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[580px] max-w-[100vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">CJIS folder</DialogTitle>
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

          {/* THE LINE, said on the screen and not only in the code. */}
          <p className="flex items-start gap-2 rounded-md bg-tint-amber/40 px-3 py-2 text-[12px] leading-4 text-tint-fg-amber">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              Attaching records that the report <strong>exists</strong>. Nobody is marked Clear —
              that is still read and decided by a person, and the candidate does not leave New
              on this alone.
            </span>
          </p>

          {scan?.truncated && (
            <p className="rounded-md border border-tint-amber bg-tint-amber/40 px-3 py-2 text-[12.5px] leading-5 text-tint-fg-amber">
              The folder holds more files than one scan reads ({scan.filesSeen} seen).
            </p>
          )}

          {found.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                On file in the folder, not yet on the card ({found.length})
              </p>
              <div className="space-y-1">
                {found.map((r) => (
                  <div key={r.candidate_id} className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5">
                    <DragPerson name={r.name} id={r.candidate_id} subtitle={r.status} className="shrink-0">
                      <Avatar src="" name={r.name} size="xs" />
                    </DragPerson>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-text-1">
                        <DragPerson name={r.name} id={r.candidate_id}>{r.name}</DragPerson>
                        <span className="ml-1.5 font-normal text-text-3">{r.status}</span>
                      </p>
                      {/* THE FILE IT MATCHED, always — this is the join a person
                          has to be able to check. */}
                      <a href={r.file_url} target="_blank" rel="noreferrer"
                         className="block truncate text-[11.5px] text-primary hover:underline">
                        {r.filename}
                      </a>
                    </div>
                    <button
                      onClick={() => void attach(r.candidate_id)}
                      disabled={writing}
                      className="h-6 shrink-0 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
                    >
                      Attach
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!!scan?.already.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] text-text-3">
                {scan.already.length} already attached
              </summary>
              <div className="mt-1.5 space-y-1">
                {scan.already.map((r) => (
                  <p key={r.candidate_id} className="text-[12.5px] text-text-3">
                    <DragPerson name={r.name} id={r.candidate_id} subtitle={r.cjis_status || 'on file'}>{r.name}</DragPerson>
                    {' — '}{r.cjis_status || 'on file'}
                  </p>
                ))}
              </div>
            </details>
          )}

          {!!scan?.without.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] text-text-3">
                {scan.without.length} with nothing in the folder
              </summary>
              <div className="mt-1.5 space-y-1">
                {scan.without.map((r) => (
                  <p key={r.candidate_id} className="text-[12.5px] text-text-3">
                    <DragPerson name={r.name} id={r.candidate_id} subtitle={r.status}>{r.name}</DragPerson>
                    {' — '}{r.status}
                  </p>
                ))}
              </div>
            </details>
          )}

          {/* A file naming nobody is listed, never dropped: it is somebody's
              report and they are waiting on it. */}
          {!!scan?.unparsedCount && (
            <details>
              <summary className="cursor-pointer text-[12.5px] text-text-3">
                {scan.unparsedCount} file(s) name nobody — open by hand
              </summary>
              <div className="mt-1.5 space-y-1">
                {scan.unparsed.map((n) => (
                  <p key={n} className="truncate text-[12.5px] text-text-3">{n}</p>
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button onClick={() => onOpenChange(false)}
              className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-2 hover:bg-surface-2">
              Close
            </button>
            <button
              onClick={() => void attach()}
              disabled={writing || busy || !found.length}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40"
            >
              {writing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Attach all {found.length || ''}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
