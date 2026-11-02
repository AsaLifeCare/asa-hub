// House Calendars' drag and drop for a house manager and up: the right panel a drop opens. The server works out
// everything that drop does before anything is written — the cells it changes, what stops it, what it warns of, who is
// told — and Confirm writes it at once, auto-approved. Swap shifts and the staff's own drag stay as they were.
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Ban, Info, Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import type { MoveNote, MovePreview, WriteAnswer } from './schedulingModel'
import { moveShift, previewMove, saidOf, type MoveAt } from './schedulingLane'
import { LABEL, Muted, OUTLINE_BTN, PRIMARY_BTN, Refusal } from './SchedulingParts'

/** The press that writes the move, by what the drop does. */
const CONFIRM: Record<MovePreview['kind'], string> = {
  move: 'Confirm the move', exchange: 'Confirm the exchange', assign: 'Confirm — give the OPEN shift',
  release: 'Confirm — make it OPEN', '': 'Confirm',
}

const NOTE_ICON: Record<MoveNote['tone'], { icon: typeof Info; tone: string }> = {
  block: { icon: Ban, tone: 'text-danger' },
  warn: { icon: AlertTriangle, tone: 'text-warning' },
  info: { icon: Info, tone: 'text-text-3' },
}

export const moveKey = (at: MoveAt): string => `${at.house}|${at.from_row_id}|${at.from_date}>${at.to_row_id}|${at.to_date}`

export default function DragMovePanel({ at, onClose, onWrite }: {
  /** the drop: the shift's cell and the cell it was dropped on, one house; null closes the panel */
  at: MoveAt | null
  onClose: () => void
  onWrite: (answer: WriteAnswer, close: boolean) => void
}) {
  const key = at ? moveKey(at) : ''
  const [read, setRead] = useState<{ key: string; preview: MovePreview | null; error: string }>({ key: '', preview: null, error: '' })
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  useEffect(() => {
    if (!at) return
    let live = true
    setRefusal('')
    setRead({ key: moveKey(at), preview: null, error: '' })
    previewMove(at)
      .then((preview) => { if (live) setRead({ key: moveKey(at), preview, error: '' }) })
      .catch((err: unknown) => { if (live) setRead({ key: moveKey(at), preview: null, error: saidOf(err) }) })
    return () => { live = false }
  }, [at])
  const preview = read.key === key ? read.preview : null
  const error = read.key === key ? read.error : ''

  const confirm = async () => {
    if (!at || !preview || preview.blocked) return
    setBusy(true)
    setRefusal('')
    try {
      onWrite(await moveShift(at, { seen_from: preview.seen_from, seen_to: preview.seen_to }, preview.needs_override), true)
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SidePanel open={Boolean(at)} onClose={onClose} label="Drag and drop" title={preview?.title || 'Move shift'}
      footer={(
        <div className="grid gap-2">
          <button type="button" className={cn(PRIMARY_BTN, 'w-full')} data-act="move-confirm"
            disabled={!preview || Boolean(preview.blocked) || busy} onClick={() => void confirm()}>
            {busy && <Loader2 size={13} className="animate-spin" />} {CONFIRM[preview?.kind ?? '']}
          </button>
          <button type="button" className={cn(OUTLINE_BTN, 'w-full')} onClick={onClose} disabled={busy}>
            Cancel — leave the calendar as it is
          </button>
        </div>
      )}>
      <div data-move-panel={key}>
        {!preview && !error && (
          <p className="mt-2 flex items-center gap-2 text-[12.5px] text-text-2" data-move-reading="">
            <Loader2 size={14} className="animate-spin" /> Working out what this move does…
          </p>
        )}
        <Refusal>{error}</Refusal>
        {preview && (
          <>
            <section className="mt-1" data-move-changes="">
              <p className={LABEL}>What changes</p>
              <ul className="mt-1.5 grid gap-1.5 rounded-lg border border-border bg-surface p-3">
                {preview.changes.map((c) => (
                  <li key={`${c.row_id}|${c.date}`} className="text-[12.5px] leading-5 text-text-1" data-move-change={`${c.row_id}|${c.date}`}>
                    <span className="font-semibold">{c.name}</span> <span className="text-text-3">· {c.day}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[12px]">
                      <span className={cn(!c.was && 'text-text-3')}>{c.was || '—'}</span>
                      <ArrowRight size={12} className="text-text-3" />
                      <span className={cn('font-semibold', !c.now && 'text-text-3')}>{c.now || '—'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="mt-3" data-move-notes="">
              <p className={LABEL}>What this move means</p>
              <ul className="mt-1.5 grid gap-1.5">
                {preview.notes.map((n, i) => {
                  const { icon: Icon, tone } = NOTE_ICON[n.tone]
                  return (
                    <li key={i} data-move-note={n.tone}
                      className={cn('flex items-start gap-1.5 text-[12px] leading-5',
                        n.tone === 'block' ? 'text-danger' : 'text-text-1',
                        n.tone === 'warn' && 'rounded-md border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-tint-warning px-2 py-1')}>
                      <Icon size={13} className={cn('mt-1 shrink-0', tone)} /> <span>{n.text}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
            {!preview.blocked && (
              <Muted className="mt-3">
                Nothing is written until you confirm. Confirming writes it at once — no approval is asked{preview.needs_override
                  ? ', and the Staff Preferences above are overridden (the override is logged)' : ''}.
              </Muted>
            )}
          </>
        )}
        <Refusal>{refusal}</Refusal>
      </div>
    </SidePanel>
  )
}
