/** One request, opened in the right panel: always the operator's layout (Edit for its approvers; the reader's answers
 * in its footer); behind Edit, the whole record. Actions come only from the server's `may`, each pressed twice; a
 * link's `act` only focuses. */
import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { toast } from '@/stores/useToastStore'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import {
  STATUS_LABEL, STATUS_TINT, actionsFor, approvedViewOf, dayWords, daysWords, directorsLine, isApproved, isWaiting, legLine,
  nextPress, spanWords, statusOf, type Detail,
} from './timeOffModel'
import { act, readDetail, type Act } from './useTimeOff'
import { StatusPill, StepBar } from './TimeOffCards'
import ApprovedTimeOffPanel, { StatePill, WaitingPill } from './ApprovedTimeOff'

const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all disabled:opacity-40'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-3">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">{title}</h3>
      <div className="grid gap-1 text-[12.5px] leading-[1.55] text-text-2">{children}</div>
    </section>
  )
}

const NEEDS_WORDS: Act[] = ['deny', 'cancel', 'discard']
const LABELS: Record<Act, string> = {
  approve: 'Approve', deny: 'Deny', withdraw: 'Withdraw', cancel: 'Cancel scheduled time off',
  confirm: 'Confirm', merge: 'Merge', discard: 'Discard',
}

export default function TimeOffPanel({ refId, focus, edit = false, onClose, onChanged }: {
  refId: string
  focus: 'approve' | 'deny' | ''
  /** opened from another screen's Edit: an approved request shows what its approvers may do */
  edit?: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let live = true
    setD(null); setFailed('')
    readDetail(refId).then((got) => { if (live) setD(got) })
      .catch((e) => { if (live) setFailed(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [refId])

  const reread = async () => {
    const fresh = await readDetail(refId).catch(() => null)
    if (fresh) setD(fresh)
  }

  return <TimeOffPanelView key={refId} refId={refId} d={d} failed={failed} focus={focus} edit={edit} onClose={onClose}
    onDone={() => { onChanged(); void reread() }} />
}

export function TimeOffPanelView({ refId, d, failed, focus, edit = false, onClose, onDone }: {
  refId: string
  d: Detail | null
  failed: string
  focus: 'approve' | 'deny' | ''
  edit?: boolean
  onClose: () => void
  onDone: () => void
}) {
  // Edit is the approvers' alone: the server's `may.edit`, never the address
  const [managing, setManaging] = useState(edit)
  if (d && !(managing && d.may.edit)) {
    const answers = isApproved(d) ? [] : actionsFor(d.may)
    return <ApprovedTimeOffPanel open view={approvedViewOf(d)} mayEdit={Boolean(d.may.edit)}
      badge={isApproved(d) ? undefined : isWaiting(d) ? <WaitingPill />
        : <StatePill label={STATUS_LABEL[d.status] ?? d.status} tint={STATUS_TINT[d.status] ?? 'slate'} />}
      onEdit={() => setManaging(true)} onClose={onClose}
      footer={isApproved(d)
        ? d.may.withdraw ? <ApprovedWithdraw refId={refId} onDone={onDone} /> : undefined
        : answers.length ? <ActionButtons key={d.status} refId={refId} actions={answers} focus={focus} onDone={onDone} /> : undefined} />
  }
  return <RecordPanel refId={refId} d={d} failed={failed} focus={focus} onClose={onClose} onDone={onDone}
    onBack={d ? () => setManaging(false) : undefined} />
}

/** The reader's actions, from the server's `may` alone, each pressed twice; denying, cancelling or discarding needs
 * words for the person. Under the record, and in a waiting request's footer. */
function ActionButtons({ refId, actions, focus, onDone }: {
  refId: string
  actions: Act[]
  focus: 'approve' | 'deny' | ''
  onDone: () => void
}) {
  const [armed, setArmed] = useState<string>('')
  const [note, setNote] = useState('')
  const [into, setInto] = useState('')
  const [busy, setBusy] = useState(false)

  const press = async (kind: Act) => {
    const step = nextPress(armed, kind)
    setArmed(step.armed)
    if (!step.act) return
    if (NEEDS_WORDS.includes(kind) && !note.trim()) {
      setArmed(kind)
      toast({ type: 'warning', title: 'Say why first', body: 'The words go to the person.' })
      return
    }
    setBusy(true)
    try {
      await act(kind, refId, { note, into })
      toast({ type: 'success', title: `${LABELS[kind]} — ${refId}`, body: 'Recorded.' })
      setNote('')
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was changed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2" data-time-off-actions="">
      {(actions.includes('deny') || actions.includes('cancel') || actions.includes('discard') || actions.includes('merge')) && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
          aria-label="Words for the person"
          placeholder="Words for the person (required to deny, cancel or discard)"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[12.5px] text-text-1 outline-none focus:border-primary" />
      )}
      {actions.includes('merge') && (
        <input value={into} onChange={(e) => setInto(e.target.value.toUpperCase())} placeholder="Merge into TO…"
          aria-label="Merge into"
          className="h-8 rounded-md border border-border bg-surface px-3 text-[12.5px] text-text-1 outline-none focus:border-primary" />
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a} type="button" disabled={busy} onClick={() => void press(a)} data-act={a}
            className={cn(BTN, armed === a ? 'bg-danger text-white'
              : a === 'approve' || a === 'confirm' ? 'bg-primary text-on-primary hover:bg-primary-hover'
                : 'border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1',
              focus === a && armed !== a && 'ring-2 ring-primary ring-offset-1')}>
            {busy && armed === '' ? <Loader2 size={12} className="animate-spin" /> : null}
            {armed === a ? `${LABELS[a]} — press again` : LABELS[a]}
          </button>
        ))}
        {armed && <button type="button" onClick={() => setArmed('')} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>}
      </div>
    </div>
  )
}

/** The person's own Withdraw under an approved request that has not started (the server's `may.withdraw`), pressed twice. */
function ApprovedWithdraw({ refId, onDone }: { refId: string; onDone: () => void }) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const press = async () => {
    const step = nextPress(armed, 'withdraw')
    setArmed(step.armed)
    if (!step.act) return
    setBusy(true)
    try {
      await act('withdraw', refId, { note: '' })
      toast({ type: 'success', title: `${LABELS.withdraw} — ${refId}`, body: 'Recorded.' })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was changed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => void press()} data-act="withdraw"
        className={cn(BTN, armed ? 'bg-danger text-white' : 'border border-border bg-surface text-text-2 hover:bg-surface-2 hover:text-text-1')}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : null}
        {armed ? `${LABELS.withdraw} — press again` : LABELS.withdraw}
      </button>
      {armed && !busy && <button type="button" onClick={() => setArmed('')} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>}
      {armed && (
        <p className="w-full text-[12px] leading-5 text-text-3">
          Both approvals are dropped. OPEN or R/O squares already staged on the house calendar stay until the house
          manager changes them.
        </p>
      )}
    </div>
  )
}

/** The whole record: the halves, the timeline, what scheduling did, and the reader's actions. */
export function RecordPanel({ refId, d, failed, focus, onClose, onDone, onBack }: {
  refId: string
  d: Detail | null
  failed: string
  focus: 'approve' | 'deny' | ''
  onClose: () => void
  onDone: () => void
  /** the request's record, opened by Edit: back to its panel */
  onBack?: () => void
}) {
  const actions: Act[] = actionsFor(d?.may)

  return (
    <SidePanel open onClose={onClose} label="Time off request" badge={d ? <StatusPill status={statusOf(d)} /> : undefined}
      title={d ? `Time off · ${d.person}` : 'Time off'}>
      <div className="mt-0.5 mb-3" data-time-off-record={refId}>
        <p className="font-mono text-[11px] text-text-3">{refId}</p>
        {d && <p className="text-[12.5px] text-text-2">{spanWords(d.start, d.end)} · {daysWords(d.days)}</p>}
        {onBack && (
          <button type="button" onClick={onBack} data-act="back"
            className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary hover:underline">
            <ChevronLeft size={14} /> Back to the request
          </button>
        )}
      </div>

      {!d && !failed && <p className="flex items-center gap-2 text-[12.5px] text-text-3"><Loader2 size={13} className="animate-spin" /> Reading…</p>}
      {failed && (
        <p className="rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 px-3 py-2 text-[12.5px] text-text-1">
          This request could not be read — {failed}
        </p>
      )}

      {d && (
        <div className="grid gap-3">
          <StepBar row={d} />
          {d.status_why && <p className="text-[12.5px] text-text-2">{d.status_why}</p>}
          {d.unplaced > 0 && (
            <p className="flex items-start gap-2 rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 px-3 py-2 text-[12.5px] font-semibold text-text-1">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#8b0000]" />
              {d.unplaced} shift{d.unplaced === 1 ? '' : 's'} had no free OPEN row and still show{d.unplaced === 1 ? 's' : ''} the
              person's name — move {d.unplaced === 1 ? 'it' : 'them'} in Calendar Builder → Builder.
            </p>
          )}

          <Section title="Who may approve each half, and why">
            <p>{legLine('House manager', d.hm)}{d.hm.note ? ` — "${d.hm.note}"` : ''}</p>
            {d.hm.why && <p className="text-text-3">{d.hm.why}</p>}
            <p>{legLine('Director', d.dir)}{d.dir.note ? ` — "${d.dir.note}"` : ''}</p>
            <p className={d.directors_readable === false ? 'font-semibold text-danger' : 'text-text-3'}>{directorsLine(d)}</p>
            {d.why_not && !d.leg && d.status === 'pending' && <p className="text-text-3">For you: {d.why_not}</p>}
          </Section>

          <Section title="Timeline">
            {d.timeline.map((t, i) => (
              <p key={`${t.what}-${i}`}><span className="text-text-3">{t.at ? ohioDateTime(t.at) : '—'}</span> · {t.text}</p>
            ))}
          </Section>

          {(d.does || d.does_why) && (
            <Section title={d.status === 'scheduled' ? 'What scheduling did, and still covers' : 'What approving does'}>
              {d.does_why && <p className="text-[#8b0000]">{d.does_why}</p>}
              {d.does?.shifts.map((s) => (
                <p key={`${s.location}|${s.col_iso}|${s.claim ? 'c' : 'r'}`}>
                  {dayWords(s.col_iso)} {s.value} at {s.label} {s.claim
                    ? 'is a shift they took: it is put back up as an open shift'
                    : 'becomes an open draft for the house manager'}
                </p>
              ))}
              {d.does?.applications.map((a) => <p key={a.id}>The application for {a.value} at {a.house} on {dayWords(a.col_iso)} is withdrawn</p>)}
              {d.does?.handoffs.map((h) => <p key={h.id}>The transfer of {h.value} at {h.house} on {dayWords(h.col_iso)} from {h.from} ends</p>)}
              {d.does?.trainings.map((t) => <p key={`${t.house}|${t.col_iso}`}>They train {t.trainee} at {t.house} on {dayWords(t.col_iso)} — who trains is asked again</p>)}
              {d.does && !d.does.shifts.length && !d.does.applications.length && !d.does.handoffs.length && !d.does.trainings.length && (
                <p>Nothing on the calendars is held by them in these days.</p>
              )}
              {(d.effects.staged ?? []).filter((s) => s.moved_to).map((s) => (
                <p key={`st-${s.location}|${s.col_iso}`}>Staged: {dayWords(s.col_iso)} {s.value} moved to {s.moved_to}</p>
              ))}
              {(d.effects.released_claims ?? []).map((s) => (
                <p key={`rc-${s.location}|${s.col_iso}`}>Given back: {dayWords(s.col_iso)} {s.value} is open again</p>
              ))}
              {(d.effects.unplaced ?? []).map((u) => (
                <p key={`un-${u.location}|${u.col_iso}`} className="font-semibold text-[#8b0000]">{dayWords(u.col_iso)} {u.value}: {u.why}</p>
              ))}
            </Section>
          )}

          {d.reason_visible && (
            <Section title="Reason">
              {d.reason_why ? <p className="text-[#8b0000]">{d.reason_why}</p> : <p>{d.reason || 'No reason was given.'}</p>}
            </Section>
          )}

          {d.others_off && (
            <Section title="Others off at the same house those days">
              {d.others_off.length ? d.others_off.map((o) => (
                <p key={o.ref}>{o.person} · {spanWords(o.start, o.end)} · {o.status === 'pending' ? 'waiting' : 'scheduled'}</p>
              )) : <p>Nobody else.</p>}
            </Section>
          )}

          {actions.length > 0 && (
            <Section title="Actions">
              <ActionButtons refId={refId} actions={actions} focus={focus} onDone={onDone} />
            </Section>
          )}
        </div>
      )}
    </SidePanel>
  )
}
