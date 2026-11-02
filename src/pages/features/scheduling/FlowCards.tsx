// Two cards above the grid: what is waiting on the viewer's answer (the same items My Work lists), and the viewer's…
// A row only opens its right panel: the answer (Approve / Decline) and Withdraw are given there, never in the list.
import { useState } from 'react'
import { ChevronRight, Inbox, ListChecks, Undo2 } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DecisionPanel, { type DecisionWord } from '@/components/shared/DecisionPanel'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import {
  exchangeLine, flowLabel, flowOpen, flowSteps, houseLabel, itemFlow, mayWithdraw,
  type Board, type Flow, type InboxItem, type WriteAnswer,
} from './schedulingModel'
import { answerItem, saidOf, withdrawFlow } from './schedulingLane'
import { Muted, OUTLINE_BTN, Refusal, StepBar, TwoPress } from './SchedulingParts'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

const CARD = 'rounded-[16px] border border-border bg-surface p-4 shadow-1'
const ROW = 'flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-2'

export const TEST_MODE_ITEM = 'Made while test mode was on: its texts were held.'

export function flowStateWords(f: Pick<Flow, 'state' | 'replacement' | 'kind'>): string {
  if (f.kind === 'training') {
    return ({
      waiting: 'Waiting on the house manager and a director', approved: 'Approved — a training with the house manager',
      declined: 'Not approved — the shift went to an OPEN row', expired: 'Stood as a training', withdrawn: 'Taken off the calendar',
      cancelled: 'Cancelled — an editor changed the shift',
    } as Record<string, string>)[f.state] ?? f.state
  }
  return ({
    outreach_1: 'Texting the house', outreach_wait: 'Waiting before texting all staff', outreach_2: 'Texting all staff',
    done: 'Done', covered: 'Covered', stopped: 'Stopped', waiting: 'Waiting on a director', approved: 'Approved',
    approved_future: 'Approved — applied when that period is made', declined: 'Declined', withdrawn: 'Withdrawn',
    cancelled: 'Cancelled — an editor changed the shift',
    expired: 'Expired', waiting_staff: `Waiting on ${f.replacement || 'the replacement'}`,
    waiting_manager: 'Waiting on the house manager', waiting_director: 'Waiting on a director',
    needs_human: 'Needs a person', opened: 'Opened',
  } as Record<string, string>)[f.state] ?? f.state
}

const itemWhere = (board: Board, i: InboxItem) =>
  [i.house_label || houseLabel(board, i.house_code), i.date, i.shift_text].filter(Boolean).join(' · ')

const flowWhere = (board: Board, f: Flow) => {
  const here = [houseLabel(board, f.house_code), f.date_to && f.date_to !== f.date ? `${f.date} → ${f.date_to}` : f.date, f.shift_text]
    .filter(Boolean).join(' · ')
  const back = exchangeLine(board, f)
  return back ? `${here} ⇄ ${back}` : here
}

const testModeOn = (v: string | boolean | undefined) => v === true || ['yes', 'on', 'true'].includes(String(v ?? '').toLowerCase())

/** The answers given from this screen: an item leaves at once, and comes back with the refusal when it is refused. */
export function useItemAnswers(onAnswered: () => void) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState('')
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({})
  const answer = async (item: InboxItem, word: DecisionWord, note: string): Promise<boolean> => {
    if (busy) return false
    setBusy(item.id)
    setGone((g) => new Set(g).add(item.id))
    setRefused((r) => ({ ...r, [item.id]: '' }))
    try {
      const got = await answerItem(item.id, word, note.trim())
      toast(got.changed === false
        ? { type: 'info', title: 'Already answered', body: got.said || undefined }
        : { type: 'success', title: word === 'approve' ? 'Approved' : 'Declined', body: got.said || undefined })
      onAnswered()
      return true
    } catch (err) {
      setGone((g) => {
        const n = new Set(g)
        n.delete(item.id)
        return n
      })
      setRefused((r) => ({ ...r, [item.id]: saidOf(err) }))
      toast({ type: 'danger', title: 'Not answered', body: saidOf(err) })
      return false
    } finally {
      setBusy('')
    }
  }
  return { gone, busy, refused, answer }
}

export function WaitingCard({ board, gone, openId, onOpen }: {
  board: Board
  gone: ReadonlySet<string>
  openId: string
  onOpen: (item: InboxItem) => void
}) {
  const items = board.waiting_on_me.filter((i) => !gone.has(i.id))
  if (!items.length) return null
  return (
    <section className={CARD} aria-label="Waiting on you" data-waiting-on-you="">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-1"><Inbox size={14} /> Waiting on you</h3>
      <ul className="mt-2 grid gap-2">
        {items.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onOpen(i)} data-item={i.id} className={cn(ROW, openId === i.id && 'bg-surface-2')}>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-text-1">{i.title}</span>
                <span className="block text-[11.5px] text-text-3">{itemWhere(board, i)}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-primary">Open <ChevronRight size={14} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The decision panel of an item waiting on the viewer: what is asked, the steps when the flow is known, the answer. */
export function ItemPanel({ board, item, onClose, busy, refusal, onAnswer }: {
  board: Board
  item: InboxItem | null
  onClose: () => void
  busy: boolean
  refusal: string
  onAnswer: (item: InboxItem, word: DecisionWord, note: string) => void
}) {
  const flow = item ? itemFlow(board, item) : null
  const steps = flow ? flowSteps(flow) : []
  return (
    <DecisionPanel open={Boolean(item)} onClose={onClose} itemKey={item?.id} label="Approval" title={item?.title ?? ''}
      who={flow?.person || undefined} whoLine={flow ? flowLabel(flow) : undefined}
      facts={item ? [
        { label: 'House', value: item.house_label || houseLabel(board, item.house_code) },
        { label: 'Day', value: item.date }, { label: 'Shift', value: item.shift_text },
        ...(flow?.replacement ? [{ label: flow.exchange ? 'Swapped with' : 'Replacement', value: flow.replacement }] : []),
        ...(flow && exchangeLine(board, flow) ? [{ label: 'Their shift', value: exchangeLine(board, flow) }] : []),
      ] : []}
      body={item?.body} steps={steps.length ? <StepBar steps={steps} /> : undefined}
      testMode={item && testModeOn(item.test_mode) ? TEST_MODE_ITEM : undefined}
      busy={busy} refusal={refusal} onAnswer={(word, note) => { if (item) onAnswer(item, word, note) }} />
  )
}

export function MineCard({ board, openId, onOpen }: { board: Board; openId: string; onOpen: (flow: Flow) => void }) {
  const flows = [...board.mine].sort((a, b) => Number(flowOpen(b)) - Number(flowOpen(a)) || String(b.created_at).localeCompare(String(a.created_at)))
  if (!flows.length) return null
  return (
    <section className={CARD} aria-label="Your requests" data-your-requests="">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text-1"><ListChecks size={14} /> Your requests</h3>
      <ul className="mt-2 grid gap-2">
        {flows.slice(0, 8).map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onOpen(f)} data-flow-row={f.id}
              className={cn(ROW, !flowOpen(f) && 'opacity-70', openId === f.id && 'bg-surface-2')}>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-text-1">
                  <span className="font-semibold">{flowLabel(f)}</span>{' · '}{flowWhere(board, f)}
                </span>
                <span className="block text-[11.5px] text-text-3">{flowStateWords(f)}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-primary">Open <ChevronRight size={14} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One of the viewer's own requests: where it stands, step by step, and Withdraw (pressed twice) while it waits. */
export function FlowPanel({ board, flow, onClose, onWrite }: {
  board: Board
  flow: Flow | null
  onClose: () => void
  onWrite: (answer: WriteAnswer, close: boolean) => void
}) {
  return (
    <SidePanel open={Boolean(flow)} onClose={onClose} label="Your request" title={flow ? flowLabel(flow) : ''}
      footer={<button type="button" onClick={onClose} className={cn(OUTLINE_BTN, 'w-full')}>Close</button>}>
      {flow && <FlowBody key={flow.id} board={board} flow={flow} onWrite={onWrite} />}
    </SidePanel>
  )
}

function FlowBody({ board, flow, onWrite }: { board: Board; flow: Flow; onWrite: (answer: WriteAnswer, close: boolean) => void }) {
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const noTest = useTestWarningsHidden()
  const withdraw = async () => {
    setBusy(true)
    setRefusal('')
    try {
      onWrite(await withdrawFlow(flow.id), true)
    } catch (err) {
      setRefusal(saidOf(err))
    } finally {
      setBusy(false)
      setArmed('')
    }
  }
  const steps = flowSteps(flow)
  return (
    <div data-flow-panel={flow.id}>
      {flow.person && (
        <div className="mt-2 flex items-center gap-2.5">
          <Avatar name={flow.person} size="md" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-text-1">{flow.person}</p>
            <p className="truncate text-[12px] text-text-3">{flowWhere(board, flow)}</p>
          </div>
        </div>
      )}
      {!flow.person && <p className="mt-1 text-[12px] text-text-3">{flowWhere(board, flow)}</p>}
      <div className="mt-3 grid gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[12.5px] text-text-1" data-flow={flow.kind}>
        <p className="font-semibold">{flowStateWords(flow)}</p>
        {flow.replacement && <p className="text-[12px] text-text-2">With {flow.replacement}</p>}
        {exchangeLine(board, flow) && (
          <p className="text-[12px] text-text-2" data-exchange="">In exchange for {exchangeLine(board, flow)}</p>
        )}
        {steps.length > 0 && <StepBar steps={steps} />}
        {flow.reason && <p className="text-[12px] text-text-2">Your reason: {flow.reason}</p>}
        {flow.note && <p className="text-[12px] text-text-2">{flow.note}</p>}
        {testModeOn(flow.test_mode) && !noTest && <Muted>{TEST_MODE_ITEM}</Muted>}
      </div>
      {mayWithdraw(board, flow) && (
        <div className="mt-3 grid gap-1.5 rounded-lg border border-border bg-surface p-3" data-withdraw="">
          <TwoPress id="withdraw" armed={armed} busy={busy} tone="outline" icon={<Undo2 size={13} />} label="Withdraw" armedLabel="Withdraw it"
            onArm={(a, act) => { setArmed(a); if (act) void withdraw() }} />
          <Muted>Withdrawn, it stops here: nobody is asked any more and the shift stays as it is.</Muted>
          <Refusal>{refusal}</Refusal>
        </div>
      )}
    </div>
  )
}
