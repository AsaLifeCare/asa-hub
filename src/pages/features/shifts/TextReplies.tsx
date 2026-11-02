/** Replies to the 5558 and 4040 and what the reply ear did (server/sms_ears.py); decides nothing. */
import { useMemo, useState } from 'react'
import { AlertTriangle, MessageSquare } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import { ohioDateTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import OnCalendar from './OnCalendar'
import RehearsalMark from './RehearsalMark'
import {
  REPLY_LABEL, REPLY_TINT, ackLabel, senderLabel, splitReplies, type Panels, type TextReply,
} from './requestsLogic'

const CHIP = 'rounded-full px-2 py-0.5 text-[11px] font-semibold'
const BTN = 'flex h-8 w-fit items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-all'

export default function TextReplies({ panels }: { panels: Panels | undefined }) {
  const [showAll, setShowAll] = useState(false)
  const { acted, notReplies } = useMemo(() => splitReplies(panels?.replies ?? []), [panels])
  if (!panels) return null
  const unread = panels.replies_readable === false
  return (
    <div className="grid gap-3">
      {unread && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500 bg-amber-500/[0.06] px-4 py-2.5 text-[12px] leading-[18px] text-text-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
          {panels.replies_why || 'The replies by text could not be read'}. This list is not saying
          nobody replied.
        </p>
      )}
      <p className="text-[12px] leading-[18px] text-text-3">
        Every text that reached the 5558 or the 4040 in the last two weeks, and what the platform did
        with it. A YES applies for a shift only when it names one — by its ref, or because exactly one
        call-off was open to the sender and nothing else was waiting on their answer; anything else is
        written down here and nothing is guessed. The house manager still decides every application.
      </p>
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex items-center gap-2 px-4 py-2.5">
          <MessageSquare size={14} className="text-text-3" />
          <h2 className="text-[13px] font-semibold text-text-1">Replies by text</h2>
          <span className="text-[12px] text-text-3">· {acted.length}</span>
        </header>
        {acted.length === 0 ? (
          !unread && (
            <p className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">
              No reply by text in the last two weeks.
            </p>
          )
        ) : (
          <ul className="border-t border-border">
            {acted.slice(0, 150).map((r) => <TextReplyRow key={r.id} r={r} />)}
          </ul>
        )}
      </section>
      {notReplies.length > 0 && (
        <button type="button" onClick={() => setShowAll((v) => !v)}
          className={cn(BTN, 'border border-border bg-surface text-text-2 hover:bg-surface-2')}>
          {showAll ? 'Hide' : 'Show'} the {notReplies.length}{' '}
          {notReplies.length === 1 ? 'text that was not a reply' : 'texts that were not replies'}
        </button>
      )}
      {showAll && notReplies.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border bg-surface">
          <ul>
            {notReplies.slice(0, 150).map((r) => <TextReplyRow key={r.id} r={r} />)}
          </ul>
        </section>
      )}
    </div>
  )
}

function TextReplyRow({ r }: { r: TextReply }) {
  const ack = ackLabel(r)
  const shift = [r.value && `${r.value} shift`, r.house && `at ${r.house}`, r.col_iso && `on ${r.col_iso}`]
    .filter(Boolean).join(' ')
  const tint = REPLY_TINT[r.outcome] ?? 'slate'
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 first:border-t-0">
      <Avatar name={r.sender === 'named' && r.person ? r.person : '?'} size="xs" />
      <span className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-text-2">
        <span className="font-medium text-text-1">{senderLabel(r)}</span>
        {' · to the '}{r.line}{' · '}{ohioDateTime(r.at) || r.at}
        {r.words && <span className="block text-[12px] leading-[18px] text-text-1">“{r.words}”</span>}
        {r.why && <span className="block text-[11.5px] leading-4 text-text-3">{r.why}</span>}
        {shift && (
          <span className="block text-[11px] leading-4 text-text-3">
            {shift}{r.ref ? ` · ref ${r.ref}` : ''}
          </span>
        )}
        {ack && <span className="block text-[11px] leading-4 text-text-3">{ack}</span>}
        <RehearsalMark on={r.rehearsal} words className="mt-0.5" />
      </span>
      <RehearsalMark on={r.rehearsal} />
      <span className={cn(CHIP, `bg-tint-${tint} text-tint-fg-${tint}`)}>
        {REPLY_LABEL[r.outcome] ?? r.outcome}
      </span>
      {r.location && r.ref && r.road !== 'handoff' && <OnCalendar location={r.location} shiftRef={r.ref} />}
    </li>
  )
}
