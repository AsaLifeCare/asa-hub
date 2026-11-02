// Transfer a shift: pick a name from server/shift_handoff.candidates.
// Transfer only offers it; the calendar changes once it is accepted and approved.
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Loader2, Search, ShieldCheck, X } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { cn } from '@/lib/utils'
import { lane, post } from './laneFetch'
import TrainingNote from './TrainingNote'
import { OFFER_PATH, candidatesUrl } from './handoffActions'
import {
  candidateTags, splitCandidates, type HandoffView, type TransferCandidate, type TransferList,
} from './requestsLogic'

export default function TransferPicker({
  location, colIso, fromStaff = '', dayLabel, onOffered, onCancel, initial,
}: {
  location: string
  colIso: string
  /** set only when the reader transfers somebody else's shift */
  fromStaff?: string
  dayLabel?: string
  onOffered: (offer: HandoffView) => void
  onCancel: () => void
  /** a list already read (the tests draw the picker with one) */
  initial?: TransferList
}) {
  const [list, setList] = useState<TransferList | null>(initial ?? null)
  const [failed, setFailed] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<TransferCandidate | null>(null)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [showBlocked, setShowBlocked] = useState(false)

  useEffect(() => {
    if (initial) return
    let live = true
    lane<TransferList>(candidatesUrl(location, colIso, fromStaff))
      .then((d) => { if (live) setList(d) })
      // A LIST THAT COULD NOT BE READ IS SAID — never drawn as "nobody can take it".
      .catch((err) => { if (live) setFailed(err instanceof Error ? err.message : 'the server did not answer') })
    return () => { live = false }
  }, [location, colIso, fromStaff, initial])

  const transfer = async () => {
    if (!picked || sending) return
    setSending(true)
    setRefusal('')
    try {
      const offer = await post<HandoffView>(OFFER_PATH, {
        location, col_iso: colIso, to_staff: picked.name, ...(fromStaff ? { from_staff: fromStaff } : {}),
      })
      onOffered(offer)
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : 'Try again.')
    } finally {
      setSending(false)
    }
  }

  if (failed) {
    return (
      <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
        <p className="flex items-start gap-1.5 text-[12px] leading-5 text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          This shift cannot be transferred now — {failed}.
        </p>
        <button onClick={onCancel}
          className="mt-2 h-8 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 hover:bg-surface-2">
          Close
        </button>
      </div>
    )
  }
  if (!list) {
    return (
      <p className="mt-3 flex items-center gap-2 text-[12px] text-text-3">
        <Loader2 size={13} className="animate-spin" /> Finding who can take it…
      </p>
    )
  }

  const { free, blocked } = splitCandidates(list.candidates, q)
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface p-3" aria-label="Transfer this shift">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Transfer to</p>
          <p className="text-[12.5px] text-text-1">
            <span className="font-semibold">{list.value}</span> · {list.house}{dayLabel ? ` · ${dayLabel}` : ''}
            {fromStaff ? <> · <span className="text-text-2">{list.giver}&apos;s shift</span></> : null}
          </p>
        </div>
        <button onClick={onCancel} aria-label="Cancel the transfer"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
          <X size={14} />
        </button>
      </div>

      {/* WHO APPROVES, before anybody presses anything — the relay's sentence. */}
      <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-4 text-text-2">
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-text-3" />
        <span>They accept, and {list.approval.why || 'the house manager approves'}.</span>
      </p>
      {!list.reachable_known && (
        <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
          {list.reachable_why || 'Who can be reached could not be read'} — nobody was left out for it.
        </p>
      )}
      {!list.ist.readable && (
        <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
          The IST record could not be read, so every name counts as a first shift here — a read that
          failed is not a trained person.
        </p>
      )}

      {list.candidates.length > 8 && (
        <div className="relative mt-2">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name…"
            className="h-8 w-full rounded-md border border-border bg-surface-2 pl-7 pr-2 text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
        </div>
      )}

      {free.length === 0 ? (
        <p className="mt-2 text-[12px] leading-5 text-text-2">
          {q ? 'Nobody by that name can take it.' : 'Nobody can take this shift right now.'}
        </p>
      ) : (
        <ul className="scroll-thin mt-2 grid max-h-[260px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5" role="listbox"
          aria-label="People who can take it">
          {free.map((c) => {
            const on = picked?.name === c.name
            return (
              <li key={c.name}>
                <button type="button" role="option" aria-selected={on}
                  onClick={() => { setPicked(on ? null : c); setRefusal('') }}
                  className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                    on ? 'border-primary bg-tint-primary' : 'border-border bg-surface hover:bg-surface-2')}>
                  <Avatar name={c.name} size="xs" />
                  <span className="min-w-0">
                    <span className="clamp-1 block text-[12px] font-medium text-text-1">{c.name}</span>
                    {candidateTags(c, list.house).map((t) => (
                      <span key={t} className={cn('clamp-1 block text-[10.5px] leading-[14px]',
                        t.startsWith('first shift') ? 'text-amber-700 dark:text-amber-400' : 'text-text-3')}>
                        {t}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {picked && (
        <div className="mt-2 border-t border-border pt-2">
          {picked.needs_training && (
            <>
              <p className="text-[11.5px] leading-4 text-amber-800 dark:text-amber-300">
                It is {picked.name.split(' ')[0]}&apos;s first shift at {list.house}, so it is the house
                manager&apos;s training: the approval takes it on.
              </p>
              <TrainingNote training={picked.training} className="mt-1" />
            </>
          )}
          <button onClick={() => void transfer()} disabled={sending}
            className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[13px] font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
            Transfer to {picked.name}
          </button>
          <p className="mt-1.5 text-[11px] leading-4 text-text-3">
            Nothing changes on the calendar yet: {picked.name.split(' ')[0]} has to accept and it has to be
            approved. Both are asked at once — here on the Hub, and by text whenever sending is on.
          </p>
        </div>
      )}
      {refusal && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Not transferred — {refusal}
        </p>
      )}

      {blocked.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <button type="button" onClick={() => setShowBlocked((v) => !v)}
            className="text-[11.5px] font-semibold text-text-2 hover:underline">
            {showBlocked ? 'Hide' : 'Show'} the {blocked.length} who cannot take it
          </button>
          {showBlocked && (
            <ul className="mt-1.5 grid gap-1">
              {blocked.map((c) => (
                <li key={c.name} className="flex items-start gap-2 text-[11px] leading-4 text-text-3">
                  <Avatar name={c.name} size="xs" />
                  <span><span className="font-medium text-text-2">{c.name}</span> — {c.why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
