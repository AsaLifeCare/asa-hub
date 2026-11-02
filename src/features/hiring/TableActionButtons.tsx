// TABLE ACTION BUTTONS — three buttons in the house style, each opening the same kind of pop-up the resume upload…
// Per row, at most three: up to TWO upload buttons — one for each document the person still OWES at their current…
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import DragPerson from '@/components/shared/DragPerson'
import { toast } from '@/stores/useToastStore'
import { AppIcon } from '@/lib/icons'
import { uploadCandidateDoc } from '@/engine/templates/pipeline/viewDoc'
import {
  FileDropZone,
  MAX_UPLOAD_BYTES,
  SelectedFileCard,
  extOf,
  gasAction,
  humanSize,
} from './shared'

const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']

// Structural on purpose: the flow board and the engine each carry their own ItemLike type with the same shape…
type ItemLike = { id: string; label: string; status: string; stage?: string; upload?: boolean }
type RowLike = { id: string; name: string; email?: string; stage: string; checklist?: ItemLike[] }

// EVERY OWED ITEM TAKES A FILE — the other rows still showing amber need an upload option too.
const shortLabel = (label: string): string => {
  const head = label.split(/\s+[—–-]\s+|\(/)[0].trim()
  return head.length > 22 ? head.slice(0, 21) + '…' : head || label.slice(0, 21)
}

const owedUploads = (r: RowLike): ItemLike[] =>
  (r.checklist ?? []).filter(
    (c) => c.stage === r.stage && !/decision$/.test(c.id) &&
      (c.status === 'missing' || c.status === 'pending'),
  ).slice(0, 4)

const openDecision = (r: RowLike): ItemLike | undefined =>
  (r.checklist ?? []).find(
    (c) => c.stage === r.stage && /decision$/.test(c.id) && (c.status === 'missing' || c.status === 'pending'),
  )

const btnGhost =
  'flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50'
const btnPrimary =
  'flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11.5px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50'

export default function TableActionButtons({ r, onChanged }: { r: RowLike; onChanged?: () => void }) {
  const [uploadItem, setUploadItem] = useState<ItemLike | null>(null)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [settled, setSettled] = useState<Record<string, boolean>>({})

  const uploads = owedUploads(r).filter((c) => !settled[c.id])
  const decision = openDecision(r)
  const showDecision = decision && !settled[decision.id]

  if (uploads.length === 0 && !showDecision) return null

  return (
    <span className="flex w-max flex-col items-stretch gap-1" onClick={(e) => e.stopPropagation()}>
      {uploads.map((c) => (
        <button
          key={c.id}
          type="button"
          title={`Upload ${c.label} for ${r.name}`}
          onClick={() => setUploadItem(c)}
          className={btnGhost}
        >
          <AppIcon name="upload" size={12} className="shrink-0" />
          {/* a label is a SENTENCE on some conditions — the button wears a
              stub, the tooltip carries the whole thing (the pills that came
              out sentence-long) */}
          <span className="max-w-[110px] truncate">{shortLabel(c.label)}</span>
        </button>
      ))}
      {showDecision && decision && (
        <button
          type="button"
          title={`${decision.label} — accept or decline`}
          onClick={() => setDecisionOpen(true)}
          className={btnPrimary}
        >
          <AppIcon name="gavel" size={12} />
          Decide
        </button>
      )}

      <TableDocUploadModal
        open={uploadItem != null}
        onOpenChange={(o) => { if (!o) setUploadItem(null) }}
        row={r}
        item={uploadItem}
        onUploaded={(id) => { setSettled((s) => ({ ...s, [id]: true })); onChanged?.() }}
      />
      {decision && (
        <DecisionModal
          open={decisionOpen}
          onOpenChange={setDecisionOpen}
          row={r}
          item={decision}
          onDecided={(id) => { setSettled((s) => ({ ...s, [id]: true })); onChanged?.() }}
        />
      )}
    </span>
  )
}

export function TableDocUploadModal({
  open, onOpenChange, row, item, onUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: RowLike
  item: ItemLike | null
  onUploaded: (itemId: string) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const close = (o: boolean) => {
    if (!o) { setFile(null); setError(null) }
    onOpenChange(o)
  }

  const pickFile = (f: File) => {
    if (!ALLOWED_EXTS.includes(extOf(f.name))) {
      setError('Unsupported file type — PDF, DOC, DOCX, JPG or PNG.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`File is too large (${humanSize(f.size)}) — the limit is 15MB.`)
      return
    }
    setError(null)
    setFile(f)
  }

  const submit = async () => {
    if (!file || !item || uploading) return
    setUploading(true)
    setError(null)
    try {
      // ONE CALL FOR BOTH SHAPES OF THIS CONTROL: the panel's form hands a file in through the very same function…
      await uploadCandidateDoc(row, item, file)
      toast({
        type: 'success',
        title: `${item.label} uploaded`,
        body: `${row.name} · filed on the record and mirrored to the document folders.`,
      })
      onUploaded(item.id)
      close(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] font-bold text-text-1">
            {item?.label ?? 'Document'} —{' '}
            <DragPerson name={row.name} id={row.id} type="staff" subtitle={row.stage}>{row.name}</DragPerson>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Upload the {item?.label?.toLowerCase() ?? 'document'} — it files on the candidate record
            and lands in the document folders.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {file ? (
            <SelectedFileCard file={file} disabled={uploading} onRemove={() => setFile(null)} />
          ) : (
            <FileDropZone
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              hint="PDF, DOC, DOCX, JPG or PNG · up to 15MB"
              disabled={uploading}
              onFile={pickFile}
            />
          )}
          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-md bg-tint-pink px-3 py-2 text-[12px] font-medium text-tint-fg-pink">
              <AppIcon name="circle-alert" size={14} className="mt-[1px] shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={uploading}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!file || uploading}
            title={file ? undefined : 'Pick a file first'}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="upload" size={15} />
            {uploading ? 'Uploading…' : `Upload ${item?.label ?? 'document'}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DecisionModal({
  open, onOpenChange, row, item, onDecided,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: RowLike
  item: ItemLike
  onDecided: (itemId: string) => void
}) {
  const [busy, setBusy] = useState<'Advance' | 'Decline' | null>(null)

  const decide = async (value: 'Advance' | 'Decline') => {
    if (busy) return
    setBusy(value)
    try {
      // THE ANSWER, NOT A RECEIPT.
      const res = await gasAction<{
        accepted?: boolean
        declined?: boolean
        gate_passed?: boolean
        moved_to?: string | null
        missing?: string[]
      }>('setDecision', { candidate_id: row.id, checkpoint: item.id, value })
      if (res?.accepted) {
        toast({ type: 'info', title: `${item.label}: ${value}`,
                body: `${row.name} · sent — the platform is still answering; the row follows the sheet.` })
      } else if (res?.declined) {
        toast({ type: 'info', title: `${item.label}: Decline`, body: `${row.name} · declined — off the board.` })
      } else if (res?.moved_to) {
        toast({ type: 'success', title: `${row.name} moved on`,
                body: res.moved_to === 'interview'
                  ? 'Phone screen complete — the in-person interview is scheduled.'
                  : `Now at ${res.moved_to}.` })
      } else if (value === 'Advance' && res && res.gate_passed === false) {
        toast({ type: 'warning', title: `${item.label}: Advance recorded`,
                body: `${row.name} stays at this stage — still missing: ` +
                      `${(res.missing ?? []).join(', ') || 'a step the gate names'}.` })
      } else {
        toast({ type: 'success', title: `${item.label}: ${value}`, body: `${row.name} · recorded.` })
      }
      onDecided(item.id)
      onOpenChange(false)
    } catch (err) {
      // Two refusals are news rather than failures: the person already moved past this decision (the row is…
      const env = (err as { envelope?: { already_at?: unknown; busy?: unknown } })?.envelope
      if (env?.already_at || env?.busy) {
        toast({ type: 'info', title: env.busy ? 'Already being recorded' : `${row.name} has moved on`,
                body: err instanceof Error ? err.message : 'The row follows the sheet.' })
        onDecided(item.id)
        onOpenChange(false)
        return
      }
      toast({
        type: 'danger',
        title: 'Could not record the decision',
        body: err instanceof Error ? err.message : 'Try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-[18px] font-bold text-text-1">
            {item.label} —{' '}
            <DragPerson name={row.name} id={row.id} type="staff" subtitle={row.stage}>{row.name}</DragPerson>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            Accept moves them forward when the gate agrees; Decline takes them off the board.
            The decision is recorded either way.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => void decide('Decline')}
            disabled={busy != null}
            className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-danger transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50"
          >
            <AppIcon name="x" size={14} />
            {busy === 'Decline' ? 'Declining…' : 'Decline'}
          </button>
          <button
            type="button"
            onClick={() => void decide('Advance')}
            disabled={busy != null}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            <AppIcon name="check" size={14} />
            {busy === 'Advance' ? 'Accepting…' : 'Accept'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
