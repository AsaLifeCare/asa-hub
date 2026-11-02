// SMS: the texts exchanged with the candidate on the company lines — the interview scheduling, the asks, any word…
// One counterpart at a time, switched on a horizontal strip, the thread scrolling inside its card; the Staff app's…
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { SectionCard } from '@/pages/features/locations/LocationParts'
import { ohioTime } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import {
  counterpartLabel, olderCursor, spanWords, textsOf, threadItems, threadOrder, type StaffTexts, type TextMessage,
} from '@/pages/features/staffprofiles/staffModel'
import { dateWords, readRefusal, type RosterRow } from '../candidateModel'
import { readKey, readTexts, useCandidateRead, type ReadState } from '../useCandidateRead'
import { EmptyNote, ReadLine, WhyLines } from '../CandidateParts'

type Older = { key: string; messages: TextMessage[]; more: boolean | null; busy: boolean; error: string }

export default function TextsSection({ row }: { row: RosterRow }) {
  const [picked, setPicked] = useState('')
  const texts = useCandidateRead(readKey('candidateProfileTexts', row.key, picked), () => readTexts(row.key, picked), textsOf)
  const current = texts.data?.with || picked
  const threadKey = `${row.key}|${current}`
  const [older, setOlder] = useState<Older>({ key: '', messages: [], more: null, busy: false, error: '' })
  const mine = useMemo<Older>(() => (older.key === threadKey ? older : { key: threadKey, messages: [], more: null, busy: false, error: '' }),
    [older, threadKey])

  const loadOlder = useCallback(() => {
    const held = [...(texts.data?.messages ?? []), ...mine.messages]
    const before = olderCursor(held)
    if (!before) return
    setOlder({ ...mine, busy: true, error: '' })
    readTexts(row.key, current, before)
      .then((raw) => {
        const page = textsOf(raw)
        setOlder((o) => (o.key === threadKey ? { ...o, messages: [...o.messages, ...page.messages], more: page.more, busy: false } : o))
      })
      .catch((err: unknown) => {
        setOlder((o) => (o.key === threadKey ? { ...o, busy: false, error: err instanceof Error ? err.message : String(err) } : o))
      })
  }, [texts.data, mine, row.key, current, threadKey])

  return (
    <TextsView name={row.name} texts={texts} older={mine.messages} more={mine.more ?? texts.data?.more ?? false} olderBusy={mine.busy}
      olderError={mine.error} onPick={(id) => setPicked(id)} onOlder={loadOlder} onRetry={texts.reload} />
  )
}

export function TextsView({ name, texts, older, more, olderBusy, olderError, onPick, onOlder, onRetry }: {
  name: string
  texts: ReadState<StaffTexts>
  older: TextMessage[]
  more: boolean
  olderBusy: boolean
  olderError: string
  onPick: (id: string) => void
  onOlder: () => void
  onRetry: () => void
}) {
  const t = texts.data
  const thread = t ? threadOrder(older, t.messages) : []
  const items = t ? threadItems(thread, t.coverage.gaps) : []
  const current = t?.counterparts.find((c) => c.id === t.with) ?? null
  return (
    <SectionCard title="SMS" sub={t && (t.coverage.from || t.coverage.to)
      ? `Texts on file from ${spanWords({ from: t.coverage.from, to: t.coverage.to })}.` : undefined}>
      <div className="grid gap-3">
        <ReadLine state={texts} what="the texts" onRetry={onRetry} />
        {t && <WhyLines why={t.why ? [t.why] : []} degraded={t.degraded} />}
        {t && t.coverage.gaps.length > 0 && (
          <div className="grid gap-1" data-text-gaps="">
            {t.coverage.gaps.map((g) => (
              <p key={`${g.from}-${g.to}`} className="rounded-md bg-tint-amber px-3 py-1.5 text-[12px] text-tint-fg-amber">
                No text is on file in any store from {spanWords(g)} — a gap in the record, not silence.
              </p>
            ))}
          </div>
        )}
        {t && t.counterparts.length === 0 && (
          <EmptyNote>
            No text on a company line names {name}&rsquo;s phone
            {t.phonesMatched === 0 ? ' — no phone of theirs is on file to match.' : '.'}
          </EmptyNote>
        )}
        {t && t.counterparts.length > 0 && (
          <>
            <div role="tablist" aria-label="Conversations" className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-counterparts="">
              {t.counterparts.map((c) => {
                const on = c.id === t.with
                return (
                  <button key={c.id} type="button" role="tab" aria-selected={on} onClick={() => onPick(c.id)} data-counterpart={c.id}
                    className={cn('flex min-w-[168px] shrink-0 flex-col items-start rounded-[14px] border px-3 py-2 text-left transition-colors',
                      on ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-2')}>
                    <span className={cn('clamp-1 text-[13px] font-semibold', on ? 'text-primary' : 'text-text-1')}>{counterpartLabel(c)}</span>
                    <span className="clamp-1 text-[11.5px] text-text-3">
                      {[c.owner, c.count !== null ? `${c.count} text${c.count === 1 ? '' : 's'}` : '', dateWords(c.lastAt)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="scroll-thin flex max-h-[520px] min-h-[240px] flex-col gap-2 overflow-y-auto rounded-[16px] border border-border bg-surface-2/40 p-3"
              data-thread={t.with}>
              {more && (
                <button type="button" onClick={onOlder} disabled={olderBusy} data-older=""
                  className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-60">
                  {olderBusy && <Loader2 size={12} className="animate-spin" />} Load earlier
                </button>
              )}
              {olderError && <p role="alert" className="text-center text-[12px] text-[var(--danger)]">Earlier texts could not be read: {readRefusal(olderError)}</p>}
              {thread.length === 0 && <p className="m-auto text-[12.5px] text-text-3">No text with {current ? counterpartLabel(current) : 'this line'} is on file.</p>}
              {items.map((it, i) => <ThreadLine key={it.kind === 'msg' ? it.msg.id : `${it.kind}-${i}`} item={it} />)}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

function ThreadLine({ item }: { item: ReturnType<typeof threadItems>[number] }): ReactNode {
  if (item.kind === 'day') {
    return <p className="my-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3" data-thread-day={item.day}>{dateWords(item.day)}</p>
  }
  if (item.kind === 'gap') {
    return (
      <p className="my-1 rounded-md bg-tint-amber px-3 py-1.5 text-center text-[11.5px] text-tint-fg-amber" data-thread-gap="">
        Nothing on file from {spanWords(item.gap)}
      </p>
    )
  }
  const m = item.msg
  const out = m.dir === 'out'
  return (
    <div className={cn('flex flex-col gap-0.5', out ? 'items-end' : 'items-start')} data-msg={m.dir}>
      <p className={cn('max-w-[82%] whitespace-pre-wrap break-words rounded-[16px] px-3.5 py-2 text-[13px] leading-5',
        out ? 'rounded-br-[6px] bg-primary-soft text-text-1' : 'rounded-bl-[6px] border border-border bg-surface text-text-1')}>
        {m.body || <span className="text-text-3">(no words — a picture or an empty text)</span>}
      </p>
      <span className="px-1 text-[10.5px] text-text-3">{[out ? m.by : '', ohioTime(m.at)].filter(Boolean).join(' · ')}</span>
    </div>
  )
}
