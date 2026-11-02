// THE LIST — the left half of the inbox.
// One calm row per call or record: who, when, the number, what it was, and one line of what was said.
import { memo, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Phone, PhoneOutgoing } from 'lucide-react'
import Card from '@/components/shared/Card'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { rowDomId, type CallItem, type IndexState, type Item, type RecordItem, type ScreenItem, type TabId } from './items'
import { cell, durationText, stampLabel } from './join'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ModalityPill, Pill, QuietPill, WhoFace } from './ui'
import {
  LINE, callOffTypeTint, queueStatusTint, screenResultTint, shiftPill, shownState, stateWords, urgencyTint,
} from './vocabulary'

/** The hint on a row's call mark — why a row filed from a call does or does not open it. */
const CALL_MARK: Record<IndexState, string> = {
  live: 'Filed from a call that is not in the calls index',
  kept: 'Filed from a call that is not in the copy this browser kept — it may open once the calls index answers',
  loading: 'Filed from a call — the calls index has not answered yet',
  failed: 'Filed from a call — the calls index could not be read just now',
  refused: 'Filed from a call — the calls are not open to this session',
}

function HotlineList({
  tab,
  items,
  total,
  selectedKey,
  today,
  indexState,
  screensRead,
  onSelect,
  onShowMore,
  empty,
}: {
  tab: TabId
  /** the rows to draw — already filtered and capped */
  items: Item[]
  /** how many rows the filter matched before the cap */
  total: number
  selectedKey: string
  today: string
  indexState: IndexState
  /** whether the hiring lane's screens were read — a missing screen is otherwise not known */
  screensRead: boolean
  onSelect: (key: string, open: boolean) => void
  onShowMore: () => void
  /** the sentence an empty list says */
  empty: ReactNode
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (!items.length) return
    e.preventDefault()
    const at = items.findIndex((i) => i.key === selectedKey)
    const next = e.key === 'ArrowDown'
      ? Math.min(items.length - 1, at < 0 ? 0 : at + 1)
      : Math.max(0, at < 0 ? 0 : at - 1)
    const key = items[next].key
    onSelect(key, false)
    document.getElementById(rowDomId(key))?.focus({ preventScroll: false })
  }

  if (!items.length) {
    return (
      <Card padded={false} className="overflow-hidden">
        <div className="px-5 py-10 text-center text-[13px] leading-[1.6] text-text-2">{empty}</div>
      </Card>
    )
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <ul role="listbox" aria-label="Calls and records" onKeyDown={onKeyDown}>
        {items.map((item) => (
          <li key={item.key} role="presentation" className="border-b border-border last:border-b-0">
            <button
              id={rowDomId(item.key)}
              type="button"
              role="option"
              aria-selected={item.key === selectedKey}
              onClick={() => onSelect(item.key, true)}
              className={cn(
                'group relative flex w-full items-start gap-3 px-4 py-3.5 text-left outline-none transition-colors duration-150',
                'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30',
                item.key === selectedKey && 'bg-surface-2',
              )}
            >
              {item.key === selectedKey && (
                <motion.span
                  layoutId="hotline-rail"
                  className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r-full bg-primary"
                  transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                />
              )}
              {item.type === 'call' && <CallLine item={item} tab={tab} today={today} screensRead={screensRead} />}
              {item.type === 'record' && <RecordLine item={item} today={today} indexState={indexState} />}
              {item.type === 'screen' && <ScreenLine item={item} today={today} />}
            </button>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-[12px] text-text-3">
            Showing <span className="font-stat">{items.length.toLocaleString()}</span> of{' '}
            <span className="font-stat">{total.toLocaleString()}</span>, newest first
          </span>
          <button
            type="button"
            onClick={onShowMore}
            className="h-8 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2"
          >
            Show more
          </button>
        </div>
      )}
    </Card>
  )
}

export default memo(HotlineList)

/* ------------------------------------------------------------------ */

function Top({ name, note, when }: { name: string; note?: string; when: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 truncate text-[13.5px] font-medium text-text-1">{name}</span>
      {note && <span className="shrink-0 text-[11px] text-text-3">{note}</span>}
      <span className="ml-auto shrink-0 pl-2 font-stat text-[11.5px] text-text-3">{when || 'no date'}</span>
    </div>
  )
}

function Preview({ text }: { text: string }) {
  return text ? <p className="mt-1 truncate text-[12.5px] leading-[1.5] text-text-2">{text}</p> : null
}

function CallLine({ item, tab, today, screensRead }: { item: CallItem; tab: TabId; today: string; screensRead: boolean }) {
  const { call, who } = item
  const st = shownState(call.hotline)
  const loud = st === 'waiting' || st === 'filing' || st === 'blocked'
  const screening = call.line_key === 'screening'
  const result = cell(item.screen?.row, 'final_result')
  return (
    <>
      <WhoFace name={who.name} source={who.source} />
      <div className="min-w-0 flex-1">
        <Top name={who.name} note={who.source === 'stated' ? 'as stated' : undefined} when={stampLabel(item.stamp, today)} />
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-text-3">
          {call.direction === 'outgoing' && <PhoneOutgoing size={11} className="shrink-0" aria-label="outgoing" />}
          <span className="truncate font-stat">{call.caller.phone ? formatPhoneDisplay(call.caller.phone) : 'no number'}</span>
          {tab === 'calls' && <><span aria-hidden>·</span><span className="shrink-0 font-stat">{LINE[call.line_key].short}</span></>}
          <span aria-hidden>·</span>
          <span className="shrink-0 font-stat">{durationText(call.duration_sec)}</span>
        </div>
        {(screening || item.modalities.length > 0 || loud || item.preview) && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            {screening
              ? (item.screen
                ? (result
                  ? <Pill label={result} tint={screenResultTint(result)} className="shrink-0" />
                  : <ModalityPill modality="screening" label="Phone screen" className="shrink-0" />)
                : <QuietPill label={screensRead ? 'No screen filed' : 'Screen not known'} className="shrink-0" />)
              : item.modalities.map((m) => <ModalityPill key={m} modality={m} className="shrink-0" />)}
            {loud && st && <Pill label={stateWords(st).label} tint={stateWords(st).tint} className="shrink-0" />}
            {item.preview && <span className="min-w-0 truncate text-[12.5px] text-text-2">{item.preview}</span>}
          </div>
        )}
      </div>
    </>
  )
}

function RecordLine({ item, today, indexState }: { item: RecordItem; today: string; indexState: IndexState }) {
  const { rec } = item
  const r = rec.row
  const note = rec.note
  return (
    <>
      <WhoFace name={item.who} source={item.face} />
      <div className="min-w-0 flex-1">
        <Top name={item.who} when={stampLabel(rec.stamp, today)} />
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {rec.lane === 'queue' && (
            <>
              <QuietPill label={cell(r, 'type_of_request') || 'Not typed'} />
              {cell(r, 'urgency') && <Pill label={cell(r, 'urgency')} tint={urgencyTint(cell(r, 'urgency'))} />}
              {cell(r, 'status') && <Pill label={cell(r, 'status')} tint={queueStatusTint(cell(r, 'status'))} />}
            </>
          )}
          {rec.lane === 'calloffs' && (
            <>
              <Pill label={cell(r, 'type') || 'Not typed'} tint={callOffTypeTint(cell(r, 'type'))} />
              {cell(r, 'how_late') && <QuietPill label={cell(r, 'how_late')} />}
            </>
          )}
          {note && (
            <>
              <QuietPill label={cell(r, 'kind_label')} />
              {note.client
                ? <QuietPill label={note.client_match === 'similar' ? `${note.client} · written “${note.written_as}”` : note.client} className="max-w-[240px]" />
                : note.written_as && <QuietPill label={`“${note.written_as}” · not a client on file`} className="max-w-[240px]" />}
              {cell(r, 'category_label') && <QuietPill label={cell(r, 'category_label')} />}
              {shiftPill(note.shift) && <QuietPill label={shiftPill(note.shift)} />}
            </>
          )}
          {rec.lane === 'incidents' && (
            <>
              {cell(r, 'client_name') && <QuietPill label={cell(r, 'client_name')} />}
              {cell(r, 'incident_category') && <QuietPill label={cell(r, 'incident_category')} className="max-w-[240px]" />}
            </>
          )}
          {rec.callKey && (
            <span
              title={item.call ? 'Filed from a call — open it to read the call' : CALL_MARK[indexState]}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
            >
              <Phone size={10.5} />
            </span>
          )}
        </div>
        <Preview text={item.preview} />
      </div>
    </>
  )
}

function ScreenLine({ item, today }: { item: ScreenItem; today: string }) {
  const r = item.screen.row
  const result = cell(r, 'final_result')
  return (
    <>
      <WhoFace name={item.who} source={item.screen.candidate ? 'record' : 'unknown'} />
      <div className="min-w-0 flex-1">
        <Top name={item.who} when={stampLabel(item.screen.stamp, today)} />
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <Pill label={result || 'No result written'} tint={screenResultTint(result)} />
          {cell(r, 'screen_status') && <QuietPill label={cell(r, 'screen_status')} />}
          {/^true$/i.test(cell(r, 'manual_screen')) && <QuietPill label="Manual screen" />}
        </div>
        <Preview text={item.preview} />
      </div>
    </>
  )
}
