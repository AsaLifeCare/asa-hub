// THE WORDS, AS A CONVERSATION — the platform's chat bubbles.
// Our line on the left in the neutral surface bubble, the other party on the right in the primary bubble, anybody…
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Copy, RotateCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import Skeleton from '@/components/shared/Skeleton'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { TINT_FG } from '@/lib/tints'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { CallRow, TranscriptTurn, TurnRole } from './hotlineApi'
import { type Who } from './join'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { NotOnFile, SectionLabel } from './ui'
import type { DetailState } from './useCallDetail'

type Group = { role: TurnRole; speaker: string; turns: TranscriptTurn[] }

function groupTurns(turns: TranscriptTurn[]): Group[] {
  const out: Group[] = []
  for (const t of turns) {
    const last = out[out.length - 1]
    if (last && last.role === t.role && last.speaker === t.speaker) last.turns.push(t)
    else out.push({ role: t.role, speaker: t.speaker, turns: [t] })
  }
  return out
}

/** Which side of the conversation a speaker's run stands on. */
const SIDE: Record<TurnRole, 'left' | 'right' | 'centre'> = { agent: 'left', caller: 'right', other: 'centre' }

/** The bubble each side wears — ChatLiveView's own: the other party's primary, ours the neutral surface. */
const BUBBLE: Record<TurnRole, string> = {
  agent: 'border border-border bg-surface-2 text-text-1',
  caller: 'bg-primary text-on-primary',
  other: 'border border-dashed border-border bg-surface text-text-2',
}

const STAMP: Record<TurnRole, string> = {
  agent: 'text-text-3', caller: 'text-on-primary/70', other: 'text-text-3',
}

export default function Transcript({ call, who, state, retry, title, meta, agentLabel }: {
  call: CallRow
  who: Who
  state: DetailState
  retry: () => void
  /** the header's title; without it the plain "Transcript" section label is drawn */
  title?: ReactNode
  /** the header's facts — day and clock, length, direction, line — each said once */
  meta?: string[]
  /** what our side is called: the line's name, else "ASA · <number>" */
  agentLabel?: string
}) {
  const [copied, setCopied] = useState(false)

  const agentName = agentLabel || (call.line_key === 'screening' ? 'Screening agent' : 'Hotline agent')
  const callerName = who.source === 'roster' || who.source === 'stated' || who.source === 'candidate' ? who.name : 'Caller'
  const nameOf = (g: { role: TurnRole; speaker: string }) =>
    g.role === 'agent' ? agentName : g.role === 'caller' ? callerName : (formatPhoneDisplay(g.speaker) || g.speaker || 'Another voice')

  const transcript = state.phase === 'ok' ? state.detail.transcript : null
  const text = transcript
    ? transcript.turns.length
      ? transcript.turns.map((t) => `[${t.at}] ${nameOf(t)}: ${t.text}`).join('\n')
      : transcript.plain
    : ''

  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast({ type: 'warning', title: 'Not copied', body: 'The browser would not copy the transcript — select the words and copy them instead.' })
    }
  }

  const copyButton = text ? (
    <button
      type="button"
      onClick={() => void copy()}
      data-copy-transcript=""
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[11.5px] font-medium text-text-2 transition-colors hover:bg-surface-2"
    >
      {copied ? <Check size={12} className={TINT_FG.mint} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy transcript'}
    </button>
  ) : null

  const facts = (meta ?? []).filter(Boolean)

  return (
    <section className="min-w-0" data-transcript="">
      {title ? (
        <header className="mb-4 flex min-w-0 items-start justify-between gap-3 border-b border-border pb-3" data-transcript-header="">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-[14px] font-semibold leading-5 text-text-1">{title}</h3>
            {facts.length > 0 && (
              <p className="mt-0.5 break-words text-[12px] leading-[18px] text-text-3" data-transcript-meta="">{facts.join(' · ')}</p>
            )}
          </div>
          {copyButton}
        </header>
      ) : (
        <SectionLabel extra={copyButton}>Transcript</SectionLabel>
      )}

      {!call.has_transcript ? (
        <NotOnFile>The call has no words on file — a hang-up, or a call that ended before anybody spoke, leaves none.</NotOnFile>
      ) : state.phase === 'loading' || state.phase === 'off' ? (
        <div className="space-y-3" aria-label="Loading the transcript">
          <Skeleton className="h-12 w-3/4 rounded-lg" />
          <Skeleton className="ml-auto h-9 w-1/2 rounded-lg" />
          <Skeleton className="h-16 w-4/5 rounded-lg" />
          <Skeleton className="ml-auto h-9 w-2/5 rounded-lg" />
        </div>
      ) : state.phase === 'error' ? (
        <div className="flex flex-wrap items-start gap-2.5 rounded-[12px] border border-border bg-surface-2 px-3.5 py-3">
          <AlertTriangle size={14} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
          <p className="min-w-0 flex-1 text-[12.5px] leading-[1.55] text-text-2">
            {state.status === 404
              ? 'This call is no longer in the calls index, so its words cannot be asked for.'
              : state.message || 'The transcript could not be read right now.'}
            {' '}Nothing about the call itself is known to be missing.
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[11.5px] font-medium text-text-2 transition-colors hover:bg-surface-3"
          >
            <RotateCw size={12} /> Retry
          </button>
        </div>
      ) : !transcript ? (
        <NotOnFile>No transcript is on file for this call — neither the transcript inbox nor the webhook calls house holds its words.</NotOnFile>
      ) : transcript.turns.length === 0 ? (
        transcript.plain ? (
          <div className="min-w-0" data-transcript-block="">
            <p className="mb-2 text-[11.5px] text-text-3">
              The speaker labels could not be read, so the words are shown as one block.
            </p>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13.5px] leading-5 text-text-1 [overflow-wrap:anywhere]">
              {transcript.plain}
            </p>
          </div>
        ) : (
          <NotOnFile>The transcript on file holds no words.</NotOnFile>
        )
      ) : (
        <motion.ol
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          className="min-w-0 space-y-3"
          data-conversation=""
        >
          {groupTurns(transcript.turns).map((g, gi) => {
            const side = SIDE[g.role]
            return (
              <li
                key={gi}
                data-side={side}
                className={cn(
                  'flex min-w-0 flex-col gap-1',
                  side === 'left' && 'items-start',
                  side === 'right' && 'items-end',
                  side === 'centre' && 'items-center',
                )}
              >
                <span data-speaker="" className="max-w-[80%] truncate px-1 text-[11px] font-medium text-text-3">{nameOf(g)}</span>
                {g.turns.map((t, ti) => (
                  <div
                    key={ti}
                    data-bubble={side}
                    className={cn('min-w-0 max-w-[80%] rounded-lg px-3 py-2 text-[13.5px] leading-5', BUBBLE[g.role])}
                  >
                    <p className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere]', g.role === 'other' && 'italic')}>
                      {t.text || '…'}
                    </p>
                    {t.at && (
                      <p data-stamp="" className={cn('mt-1 font-stat text-[10.5px] tabular-nums', STAMP[g.role], side === 'right' && 'text-right')}>
                        {t.at}
                      </p>
                    )}
                  </div>
                ))}
              </li>
            )
          })}
        </motion.ol>
      )}

      {transcript?.source === 'calls_house' && (
        <p className="mt-3 text-[11.5px] text-text-3">
          Read from the webhook calls house — the transcript inbox held no words for this call.
        </p>
      )}
      {transcript?.source === 'webhook' && (
        <p className="mt-3 text-[11.5px] text-text-3">
          <span className="font-medium text-text-2">Live copy</span> — the words OpenPhone sent the platform as the call
          ended, read before the transcript inbox had the call.
        </p>
      )}
    </section>
  )
}
