// One alert in the right side panel: what happened, its level, the way to its app, and — on an alert addressed to…
// The answer goes to the source's own door (supportInboxAnswer or Scheduling's schedulingAnswer), never to the read…
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { gasAction } from '@/features/hiring/shared'
import { cn } from '@/lib/utils'
import { actDoneLine, actPayload, alertWhen, levelPill, type AlertAct, type AlertItem, type Tone } from './myInboxModel'
import { useTestWarningsHidden, withoutTestWords } from '@/lib/myWorkHides'

const PILL_TONE: Record<Tone, string> = {
  good: 'bg-[var(--status-green-soft)] text-[var(--status-green)]',
  warning: 'bg-tint-amber text-tint-fg-amber',
  danger: 'bg-tint-pink text-danger',
  muted: 'bg-surface-2 text-text-2',
}

/** How long a first press stays armed. */
export const ARM_MS = 4000

export type ActAnswer = { ok?: boolean; changed?: boolean; said?: string; state?: string }

/** The act through its own door, each by its literal name. */
export function answerAct(act: AlertAct): Promise<ActAnswer> {
  const payload = actPayload(act)
  return act.action === 'schedulingAnswer'
    ? gasAction<ActAnswer>('schedulingAnswer', payload, { retry: false })
    : gasAction<ActAnswer>('supportInboxAnswer', payload, { retry: false })
}

export const ACTING_LINE = 'Answered from your own account only — not in a switched session.'

export default function AlertPanel({ item, acting, onClose, onAnswered }: {
  item: AlertItem | null
  /** a switched session answers nothing */
  acting: boolean
  onClose: () => void
  /** the door took it: the page holds it as answered until its mirror says so */
  onAnswered: (item: AlertItem, said: string) => void
}) {
  return (
    <SidePanel open={Boolean(item)} onClose={onClose} label={item?.level === 'warning' ? 'Warning' : 'Alert'} title={item?.title ?? ''}>
      {item && <AlertPanelBody key={item.id} item={item} acting={acting} onAnswered={onAnswered} />}
    </SidePanel>
  )
}

export function AlertPanelBody({ item, acting, onAnswered, answer = answerAct }: {
  item: AlertItem
  acting: boolean
  onAnswered: (item: AlertItem, said: string) => void
  answer?: (act: AlertAct) => Promise<ActAnswer>
}) {
  const navigate = useNavigate()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // Settings › My Work hides every test mode warning from anyone but the master: the body's "Test mode" part too
  const noTest = useTestWarningsHidden()
  const body = noTest && item.body ? withoutTestWords(item.body) : item.body
  const pill = levelPill(item)
  const act = item.act

  const press = async () => {
    if (!act) return
    if (timer.current) clearTimeout(timer.current)
    if (!armed) {
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), ARM_MS)
      return
    }
    setArmed(false)
    setBusy(true)
    setRefusal('')
    try {
      const got = await answer(act)
      onAnswered(item, String(got?.said ?? ''))
    } catch (err) {
      setRefusal((err instanceof Error ? err.message : String(err)) || 'It was not recorded. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 grid gap-4" data-alert-panel={item.id}>
      <div className="flex flex-wrap items-center gap-2">
        {pill && (
          <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold', PILL_TONE[pill.tone])} data-level-pill={item.level}>
            {pill.text}
          </span>
        )}
        <span className="text-[12px] text-text-3">{alertWhen(item.at)}</span>
      </div>
      {body && <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1">{body}</p>}
      {item.link?.href && (
        <button type="button" onClick={() => navigate(item.link!.href)} data-open-link=""
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 hover:bg-surface-2">
          {item.link.label || 'Open'} <ArrowUpRight size={13} />
        </button>
      )}
      {act && (
        <div className="border-t border-border pt-3" data-act={act.kind}>
          {act.done ? (
            <p className="text-[12.5px] text-text-2" data-act-done="">{actDoneLine(act)}</p>
          ) : acting ? (
            <p className="text-[12.5px] text-text-3" data-act-acting="">{ACTING_LINE}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void press()} disabled={busy} data-act-press={act.kind} data-armed={armed ? '' : undefined}
                className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold disabled:opacity-50',
                  armed ? 'bg-danger text-white'
                    : act.kind === 'aware' ? 'border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-surface text-danger hover:bg-tint-danger'
                      : 'border border-border bg-surface text-text-1 hover:bg-surface-2')}>
                {busy && <Loader2 size={13} className="animate-spin" />}
                {armed ? `Press again — ${act.label || (act.kind === 'aware' ? 'I’m aware' : 'Seen')}` : act.label || (act.kind === 'aware' ? 'I’m aware' : 'Seen')}
              </button>
              {armed && <button type="button" onClick={() => setArmed(false)} className="text-[12px] text-text-3 hover:text-text-1">Not yet</button>}
            </div>
          )}
          {refusal && <p role="alert" className="mt-2 text-[12px] leading-5 text-danger" data-act-refusal="">{refusal}</p>}
        </div>
      )}
      {!act && item.level === 'warning' && (
        <p className="text-[12px] text-text-3" data-act-none="">This warning is answered by the person it is addressed to.</p>
      )}
    </div>
  )
}
