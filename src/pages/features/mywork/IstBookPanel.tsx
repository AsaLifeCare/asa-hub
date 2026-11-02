// THE CLIENT TRAINING (IST) BOOKING PANEL of My Work — the one right panel at its standard width, never a visit to
// Workforce Compliance: the client and the staff member as the IST record names them, the training's date, confirmed
// or declined, and Send, which keeps the booking and puts it in front of the directors and above.
import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import SidePanel from '@/components/shared/SidePanel'
import { gasAction } from '@/features/hiring/shared'
import { Field, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import {
  IST_ANSWERS, istBookPayload, istBookReady, type IstAnswer, type IstBookAnswer, type IstBookItem,
} from './myWorkModel'

export const IST_PANEL_LABEL = 'Client training'
const READ_ONLY = 'flex min-h-9 items-center rounded-sm border border-border bg-surface-2 px-3 text-[13px] text-text-1'
const CHOICE = 'inline-flex h-9 flex-1 items-center justify-center rounded-full border text-[12.5px] font-semibold transition-colors'
const SEND = 'inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-semibold text-white ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-3'

export default function IstBookPanel({ item, onClose, onSent }: {
  /** the owed record the panel books; null keeps it closed */
  item: IstBookItem | null
  onClose: () => void
  /** a Send landed: the server's sentence */
  onSent: (said: string) => void
}) {
  return (
    <SidePanel open={Boolean(item)} onClose={onClose} label={IST_PANEL_LABEL}
      title={item?.client ? `Book training · ${item.client}` : 'Book training'}>
      {item && <IstBookBody key={item.id} item={item} onSent={onSent} />}
    </SidePanel>
  )
}

export function IstBookBody({ item, onSent }: { item: IstBookItem; onSent: (said: string) => void }) {
  const [date, setDate] = useState('')
  const [answer, setAnswer] = useState<IstAnswer | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState('')
  const ready = istBookReady(date, answer) && !busy
  const send = async () => {
    if (!ready) return
    setBusy(true)
    setRefusal('')
    try {
      // a write: never re-sent on a garbled answer, or the directors would be asked twice
      const got = await gasAction<IstBookAnswer>('myWorkIstBook', istBookPayload(item, date, answer, note), { retry: false })
      const said = String(got?.said ?? '').trim() || 'Sent to the directors for approval.'
      toast({ type: 'success', title: 'Training sent', body: said })
      onSent(said)
    } catch (e) {
      const why = e instanceof Error && e.message ? e.message : 'Try again.'
      setRefusal(why)
      toast({ type: 'danger', title: 'Not sent', body: why })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-4" data-ist-book={item.id}>
      <Field label="Client"><div className={READ_ONLY} data-ist-client="">{item.client || '—'}</div></Field>
      <Field label="Staff"><div className={READ_ONLY} data-ist-staff="">{item.staff || '—'}</div></Field>
      {item.house && <Field label="House"><div className={READ_ONLY}>{item.house}</div></Field>}
      <Field label="Training date" required>
        <input type="date" className={inputCls} value={date} aria-label="Training date" data-ist-date=""
          onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Confirmation" required>
        <div className="flex gap-2" role="radiogroup" aria-label="Confirm or decline">
          {IST_ANSWERS.map((a) => (
            <button key={a.value} type="button" role="radio" aria-checked={answer === a.value} data-ist-answer={a.value}
              className={cn(CHOICE, answer === a.value
                ? a.value === 'confirmed' ? 'border-primary bg-primary text-white' : 'border-danger bg-danger text-white'
                : 'border-border text-text-1 hover:bg-surface-2')}
              onClick={() => setAnswer(a.value)}>
              {a.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note">
        <textarea value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — the directors read it" aria-label="Note for the directors"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SEND} disabled={!ready} data-ist-send="" onClick={() => void send()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
        </button>
        <span className="text-[12px] text-text-3">The directors and above approve it in My Work.</span>
      </div>
      {refusal && <p role="alert" className="text-[12px] leading-5 text-danger">{refusal}</p>}
    </div>
  )
}
