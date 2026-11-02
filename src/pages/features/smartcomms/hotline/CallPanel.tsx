// ONE CALL, OPENED — the right half of the inbox.
// who, the number, the line, when, how long SUMMARY OpenPhone's own words and next steps FILED FROM THIS CALL the…
import { memo, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowLeft, Ban, BellRing, Clock, FileText, Headphones, Mail, Phone, PhoneIncoming, PhoneOutgoing, Timer,
} from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { TINT_FG } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { CallsIndex, HotlineRead } from './hotlineApi'
import type { CallItem, IndexState } from './items'
import { cell, durationText, isCallOffType, parseStamp, stampLong, unlinkedKinds } from './join'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { FiledCard, ScreenCard } from './RecordCards'
import Transcript from './Transcript'
import { NotOnFile, Pill, SectionLabel, WhoFace } from './ui'
import { useCallDetail } from './useCallDetail'
import {
  KIND_LABEL, KIND_LANES, LANE_IDS, LINE, MODALITY, TRIGGERED, TRIGGERED_REQUEST_UNREAD, shownState, stateWords,
  type LaneId, type Modality,
} from './vocabulary'

// What a panel knows about the reads behind it — so a missing row can say whether it is missing or merely unread.
export type PanelReads = {
  sources: CallsIndex['sources'] | null
  laneErrors: Partial<Record<LaneId, string>>
  lanesUnread: LaneId[]
  /** how fresh each lane's rows are, in ms — 0 when the lane has not answered */
  laneFresh: Record<LaneId, number>
  screensRead: boolean
  candidatesRead: boolean
  indexState: IndexState
  // the relay says its fast path is armed and this tab hears it ring — only then is a call said to be read as it…
  live: boolean
}

function whoNote(item: CallItem, reads: PanelReads): string {
  const { who, call, screen } = item
  const c = call.caller
  const rosterDown = !!reads.sources?.roster && !reads.sources.roster.ok
  switch (who.source) {
    case 'roster':
      return 'On the roster — named from the number.'
    case 'stated':
      if (c.who === 'shared' || c.kind === 'company_line') return 'As stated on the call. The number is a shared line, so it names nobody.'
      if (!c.phone) return 'As stated on the call. The call carried no readable number.'
      return rosterDown
        ? 'As stated on the call. The roster could not be read, so the number was not checked against it.'
        : 'As stated on the call. The number is not on the roster.'
    case 'candidate':
      return screen?.candidate ? 'The candidate this screen is filed under.' : 'The one candidate on file with this number.'
    case 'shared':
      return c.kind === 'company_line'
        ? `A company line${c.line_name ? ` (OpenPhone calls it “${c.line_name}”)` : ''} — shared, so it names nobody.`
        : 'A shared line — it names nobody.'
    default:
      if (!c.phone) return 'The call carried no readable number.'
      return rosterDown ? 'The roster could not be read, so the number names nobody for now.' : 'This number is not on the roster.'
  }
}

function Meta({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-text-2">
      <span className="shrink-0 text-text-3">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="border-t border-border px-5 py-4 sm:px-6">{children}</div>
}

const listWords = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

// WHY A FILED KIND HAS NO ROW HERE — asked of the reads, in this order, and never answered with a guess: its lane…
function leftoverSentences(landed: string[], item: CallItem, reads: PanelReads): { lanes: LaneId[]; text: string }[] {
  const counts = new Map<string, number>()
  for (const k of landed) counts.set(k, (counts.get(k) ?? 0) + 1)
  const filed = Date.parse(item.call.hotline?.at ?? '')
  const filedAt = parseStamp(item.call.hotline?.at ?? '')?.time ?? ''
  const out: { lanes: LaneId[]; text: string }[] = []
  for (const [kind, n] of counts) {
    const lanes = KIND_LANES[kind] ?? []
    const label = `Filed as ${KIND_LABEL[kind] ?? kind}${n > 1 ? ` (${n} of them)` : ''}`
    const lane = lanes[0]
    if (!lane) {
      out.push({ lanes, text: `${label} — this screen does not know that kind of row.` })
      continue
    }
    const name = MODALITY[lane].label
    if (reads.laneErrors[lane]) {
      out.push({ lanes, text: `${label} — ${name} could not be read, so the row is not shown here.` })
    } else if (reads.lanesUnread.includes(lane)) {
      out.push({ lanes, text: `${label} — ${name} is still being read.` })
    } else if (Number.isFinite(filed) && reads.laneFresh[lane] > 0 && filed > reads.laneFresh[lane]) {
      out.push({ lanes, text: `${label}${filedAt ? ` at ${filedAt}` : ''}, after ${name} was last read here — Refresh to show it.` })
    } else if (kind === 'DailyNote') {
      out.push({ lanes, text: `${label} — no Daily Notes row carries this call’s id.` })
    } else if (kind === 'Incident') {
      out.push({ lanes, text: `${label} — incident rows carry no call id, and no incident row was filed within two minutes of this call alone, so it cannot be shown beside the call.` })
    } else {
      out.push({ lanes, text: `${label} — the row was written before rows carried their call id, so it cannot be shown beside the call.` })
    }
  }
  return out
}

function CallPanel({
  item,
  focusKey,
  reads,
  today,
  onBack,
}: {
  item: CallItem
  /** the record the reader came from — its card is drawn in focus */
  focusKey: string
  reads: PanelReads
  today: string
  onBack: () => void
}) {
  const { call, who } = item
  const { state, retry } = useCallDetail(
    call.call_id,
    call.has_transcript,
    call.hotline ? `${call.hotline.state}${call.hotline.stage ? `:${call.hotline.stage}` : ''}` : '',
  )
  const detail = state.phase === 'ok' && state.detail.summary
    ? { text: state.detail.summary.text, next_steps: state.detail.summary.next_steps }
    : null
  // THE KEPT COPY HOLDS A SUMMARY'S FIRST SENTENCE ONLY.
  const kept = reads.indexState === 'kept'
  const summary = kept ? detail ?? call.summary : call.summary ?? detail
  const partial = kept && !detail && !!call.summary
  const hasSummary = !!summary && (!!summary.text || summary.next_steps.length > 0)
  const st = shownState(call.hotline)

  const linked = [...item.linked].sort((a, b) => LANE_IDS.indexOf(a.lane) - LANE_IDS.indexOf(b.lane))
  const { landed, failed } = call.line_key === 'hotline' ? unlinkedKinds(call, item.linked) : { landed: [], failed: [] }
  const leftovers = leftoverSentences(landed, item, reads)
  const explained = leftovers.flatMap((l) => l.lanes)

  return (
    <div>
      {/* ── who ─────────────────────────────────────────────── */}
      <div className="px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2 lg:hidden"
        >
          <ArrowLeft size={13} /> Back to the list
        </button>
        <div className="flex items-start gap-3.5">
          <WhoFace name={who.name} source={who.source} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate font-display text-[18px] font-semibold leading-6 text-text-1">{who.name}</h2>
              {st && <Pill label={stateWords(st).label} tint={stateWords(st).tint} />}
            </div>
            <p className="mt-0.5 text-[12.5px] leading-[1.5] text-text-3">{whoNote(item, reads)}</p>
          </div>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2">
          <Meta icon={<Phone size={13} />}>
            <span className="font-stat">{call.caller.phone ? formatPhoneDisplay(call.caller.phone) : 'No number'}</span>
          </Meta>
          <Meta icon={<Headphones size={13} />} title={formatPhoneDisplay(LINE[call.line_key].number)}>
            <span className="font-stat">{LINE[call.line_key].short}</span> {LINE[call.line_key].label}
          </Meta>
          <Meta icon={<Clock size={13} />}>
            <span className="font-stat">{stampLong(item.stamp) || 'No readable time'}</span>
          </Meta>
          <Meta icon={<Timer size={13} />}><span className="font-stat">{durationText(call.duration_sec)}</span></Meta>
          {call.direction && (
            <Meta icon={call.direction === 'outgoing' ? <PhoneOutgoing size={13} /> : <PhoneIncoming size={13} />}>
              {call.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}
            </Meta>
          )}
        </div>
      </div>

      {/* ── summary ─────────────────────────────────────────── */}
      <Section>
        <SectionLabel>Summary</SectionLabel>
        {hasSummary && summary ? (
          <>
            {summary.text
              ? <p className="whitespace-pre-wrap text-[13.5px] leading-[1.65] text-text-1">{summary.text}</p>
              : <p className="text-[12.5px] leading-[1.55] text-text-3">OpenPhone wrote next steps for this call and no summary text.</p>}
            {summary.next_steps.length > 0 && (
              <div className="mt-3">
                <p className="text-[11.5px] font-medium text-text-3">Next steps</p>
                <ul className="mt-1.5 space-y-1.5">
                  {summary.next_steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-[1.55] text-text-2">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-3" />
                      <span className="min-w-0">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2.5 text-[11px] text-text-3">
              OpenPhone&apos;s own summary of the call.
              {partial ? ' Only its first sentence — the copy this browser kept holds no more; the rest opens once the calls index answers.' : ''}
            </p>
          </>
        ) : state.phase === 'loading' ? (
          // the index held no summary; the call's own read may still bring one
          <div className="space-y-2" aria-label="Loading the summary">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        ) : reads.sources?.recaps && !reads.sources.recaps.ok ? (
          <NotOnFile>The summaries house could not be read, so whether OpenPhone wrote a summary for this call is not known.</NotOnFile>
        ) : (
          <NotOnFile>OpenPhone wrote no summary for this call.</NotOnFile>
        )}
      </Section>

      {/* ── filed from this call ────────────────────────────── */}
      <Section>
        <SectionLabel>Filed from this call</SectionLabel>
        {call.line_key === 'screening'
          ? <ScreeningFiled item={item} reads={reads} today={today} />
          : (
            <div className="space-y-2.5">
              {linked.map((rec) => (
                <FiledCard key={rec.key} rec={rec} today={today} focused={rec.key === focusKey} />
              ))}
              {leftovers.map((l) => <NotOnFile key={l.text}>{l.text}</NotOnFile>)}
              {failed.length > 0 && (
                <p className="flex items-start gap-2 rounded-[12px] border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-[1.55] text-text-2">
                  <AlertTriangle size={14} className={cn('mt-0.5 shrink-0', TINT_FG.amber)} />
                  The read found {listWords(failed.map((k) => KIND_LABEL[k] ?? k))}, but the row did not land in its house.
                </p>
              )}
              <HotlineStateLine
                item={item}
                hasRows={linked.length > 0 || landed.length > 0}
                landing={landed.length > 0}
                live={reads.live}
              />
              <UnreadLanes reads={reads} explained={explained} />
            </div>
          )}
      </Section>

      {/* ── what it triggered ───────────────────────────────── */}
      <Section>
        <SectionLabel>What it triggered</SectionLabel>
        <Triggered item={item} reads={reads} requestUnread={landed.includes('Request')} />
      </Section>

      {/* ── transcript ──────────────────────────────────────── */}
      <Section>
        <Transcript call={call} who={who} state={state} retry={retry} />
      </Section>
    </div>
  )
}

// Drawn again only when the call, the reads or the day change — not on every tick of the page's clock, and not for…
export default memo(CallPanel)

/** A filing whose items have not been read yet — what it filed is not known, and is never "nothing". */
const filedUnread = (hot: HotlineRead) => hot.items === null || !Array.isArray(hot.kinds)

function HotlineStateLine({ item, hasRows, landing, live }: {
  item: CallItem
  hasRows: boolean
  /** a kind the read filed has no row on screen yet */
  landing: boolean
  live: boolean
}) {
  const hot = item.call.hotline
  if (!hot) {
    return hasRows ? null : <NotOnFile>The hotline read has no record of this call.</NotOnFile>
  }
  const shown = shownState(hot)
  switch (shown) {
    case 'waiting':
      return live
        ? <NotOnFile>Waiting for the hotline read. Calls are read as they end; a ten-minute pass is the safety net.</NotOnFile>
        : <NotOnFile>Waiting for the hotline read — it runs about every ten minutes.</NotOnFile>
    case 'filing':
      return <NotOnFile>Filing now — the call is being read as it ended.</NotOnFile>
    case 'blocked':
      return (
        <p className="flex items-start gap-2 rounded-[12px] border border-border bg-surface-2 px-3 py-2 text-[12.5px] leading-[1.55] text-text-2">
          <Ban size={14} className={cn('mt-0.5 shrink-0', TINT_FG.danger)} />
          <span className="min-w-0">
            The hotline read was blocked{hot.why ? <>: <span className="text-text-1">{hot.why}</span></> : ' and wrote no reason'}.
            The call stays unread and the next pass tries it again.
          </span>
        </p>
      )
    case 'no_words':
      return <NotOnFile>The call has no words to read, so nothing could be filed from it.</NotOnFile>
    case 'held':
      return <NotOnFile>Older than fourteen days when the hotline read found it — calls this old are left to the sealed backlog and are not filed.</NotOnFile>
    case 'legacy':
      return hasRows ? null : (
        <NotOnFile>An older processor marked this call processed and left no log line, so what it filed is not known here.</NotOnFile>
      )
    case 'unlogged':
      return (
        <NotOnFile>
          {hot.why || 'The processing log could not be read just now, so what the hotline read filed from this call is not known.'}
        </NotOnFile>
      )
    case 'filed':
      // THE RELAY'S WORD, before the log's row is read: what it has not read yet is said even beside rows, since…
      if (shown !== hot.state) {
        if (filedUnread(hot)) return <NotOnFile>Filed — what it filed is being read.</NotOnFile>
        if (hot.items === 0 || !hot.kinds.length) {
          return hasRows ? null : <NotOnFile>The hotline read opened this call and found no matter to file.</NotOnFile>
        }
        return landing ? <NotOnFile>Filed — the rows are landing.</NotOnFile> : null
      }
      if (hasRows) return null
      if (filedUnread(hot)) return <NotOnFile>Filed — what it filed is being read.</NotOnFile>
      return hot.items === 0 || !hot.kinds.length
        ? <NotOnFile>The hotline read opened this call and found no matter to file.</NotOnFile>
        : null
    default:
      // a stage the relay knows and this build does not — named, never guessed at
      return hasRows ? null : (
        <NotOnFile>The hotline read reports this call as “{stateWords(shown).label}”, a stage this screen does not know yet, so what it filed is not said here.</NotOnFile>
      )
  }
}

function UnreadLanes({ reads, explained }: { reads: PanelReads; explained: LaneId[] }) {
  const failed = LANE_IDS.filter((l) => reads.laneErrors[l] && !explained.includes(l))
  const unread = reads.lanesUnread.filter((l) => !reads.laneErrors[l] && !explained.includes(l))
  if (!failed.length && !unread.length) return null
  return (
    <p className="text-[11.5px] leading-[1.5] text-text-3">
      {failed.length > 0 && <>{listWords(failed.map((l) => MODALITY[l].label))} could not be read, so a row filed from this call may be missing here. </>}
      {unread.length > 0 && <>{listWords(unread.map((l) => MODALITY[l].label))} {unread.length === 1 ? 'is' : 'are'} still being read.</>}
    </p>
  )
}

function ScreeningFiled({ item, reads, today }: { item: CallItem; reads: PanelReads; today: string }) {
  if (item.screen) return <ScreenCard screen={item.screen} candidate={item.candidate} today={today} />
  if (!reads.screensRead) {
    return <NotOnFile>The hiring lane&apos;s screens could not be read, so whether a screen is filed for this call is not known.</NotOnFile>
  }
  return (
    <NotOnFile>
      No screen in the hiring lane is filed under this call.
      {item.candidate ? <> The number belongs to candidate <span className="text-text-2">{String(item.candidate.name ?? '')}</span>.</> : null}
    </NotOnFile>
  )
}

const TRIGGER_ICON: Record<Modality, ReactNode> = {
  calloffs: <BellRing size={14} />,
  queue: <FileText size={14} />,
  notes: <FileText size={14} />,
  incidents: <FileText size={14} />,
  screening: <Mail size={14} />,
}

/** The states whose call, with no row on file, filed nothing — any other says less. */
const NOTHING_FILED = new Set<string>(['filed', 'blocked', 'held', 'no_words'])

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="text-[12.5px] leading-[1.55] text-text-3">{children}</p>
)

// WHAT IT SET IN MOTION — said only as far as the rows that decide it were read.
function Triggered({ item, reads, requestUnread }: { item: CallItem; reads: PanelReads; requestUnread: boolean }) {
  const { call, modalities } = item
  const state = shownState(call.hotline)

  if (call.line_key === 'screening') {
    if (!item.screen) {
      return reads.screensRead
        ? <Quiet>Nothing — no screen is filed under this call, so no report is sent.</Quiet>
        : <Quiet>Not known — the hiring lane&apos;s screens could not be read, so whether a screen was filed, and a report sent, cannot be said.</Quiet>
    }
  } else if (!modalities.length) {
    return (
      <Quiet>
        {state === 'waiting'
          ? 'Nothing yet — nothing is sent until the hotline read files the call.'
          : state === 'filing'
            ? 'Filing — rows appear as they land.'
            : state === 'legacy'
              ? 'Not known — an older processor handled this call and left no record of what it filed or sent.'
              : state === 'unlogged'
                ? 'Not known — the processing log could not be read just now, so what this call filed, and what that sent, cannot be said.'
                : state === 'filed' && call.hotline && filedUnread(call.hotline)
                  ? 'Not known yet — what the hotline read filed from this call is still being read, so what it set in motion cannot be said.'
                  : !state || NOTHING_FILED.has(state)
                    ? 'Nothing — no row was filed from this call.'
                    : 'Not known yet — the hotline read is at a stage this screen does not know.'}
      </Quiet>
    )
  }

  const plainQueueRow = item.linked.some((r) => r.lane === 'queue' && !isCallOffType(cell(r.row, 'type_of_request')))
  const lines: { key: string; modality: Modality; label: string; text: string }[] = modalities.map((m) => ({
    key: m,
    modality: m,
    label: MODALITY[m].one,
    text: m === 'queue' && !plainQueueRow ? TRIGGERED_REQUEST_UNREAD : TRIGGERED[m],
  }))
  // a request beside the rows that were read, whose own row was not
  if (requestUnread && lines.some((l) => l.modality === 'queue' && l.text === TRIGGERED.queue)) {
    lines.push({ key: 'queue-unread', modality: 'queue', label: 'Another request', text: TRIGGERED_REQUEST_UNREAD })
  }

  return (
    <ul className="space-y-2">
      {lines.map((l) => (
        <li key={l.key} className="flex items-start gap-2.5">
          <span className="mt-[1px] grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 text-text-2">
            {TRIGGER_ICON[l.modality]}
          </span>
          <p className="min-w-0 text-[13px] leading-[1.55] text-text-2">
            <span className="font-medium text-text-1">{l.label}</span> — {l.text}
          </p>
        </li>
      ))}
    </ul>
  )
}
