// The IST form a house's editor fills in: the trainee, the client, the training day and the trainer's confirmation —
// the pair's IST record marked trained in Postgres (locationIstTrain), the house's staff read again.
import { useState } from 'react'
import type { HouseRow } from '@/pages/features/houses/houseModel'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { ohioToday } from '@/lib/ohio'
import { toast } from '@/stores/useToastStore'
import { REREAD, recordIstTraining } from './useLocation'
import { DraftButtons } from './LocationParts'
import ApplyStrip, { useApply } from './ApplyStrip'

const LABEL = 'text-[12px] font-semibold text-text-2'
const INPUT = 'h-10 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none focus:border-primary'
export const IST_CONFIRM_WORDS = 'By checking this box you confirm that you trained the individual above on the client selected.'

export default function IstTrainForm({ house, employees, clients, staff, client, onDone }: {
  house: HouseRow
  /** every active employee, the trainees offered */
  employees: string[]
  /** the house's current clients */
  clients: string[]
  staff: string
  client: string
  onDone: () => void
}) {
  const [trainee, setTrainee] = useState(staff)
  const [who, setWho] = useState(client)
  const [day, setDay] = useState(ohioToday())
  const [confirmed, setConfirmed] = useState(false)
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = useApply(house.code)
  const today = ohioToday()
  const ready = !!trainee && !!who && !!day && day <= today && confirmed
  const trainees = employees.includes(staff) || !staff ? employees : [staff, ...employees]

  const send = async () => {
    if (!ready) return
    const press = nextPress(armed, 'train')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      await apply.run(() => recordIstTraining({ house: house.code, staff: trainee, client: who, trained_on: day, confirmed: true }),
        [REREAD.staff(house.code)])
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  if (apply.state.phase === 'done') return <div className="grid gap-3" data-ist-form=""><ApplyStrip state={apply.state} onDone={onDone} /></div>
  return (
    <div className="grid gap-4" data-ist-form="">
      <label className="grid gap-1.5">
        <span className={LABEL}>Trainee</span>
        <select value={trainee} onChange={(e) => { setTrainee(e.target.value); setArmed('') }} disabled={busy} className={INPUT}
          data-ist-field="trainee">
          <option value="">Choose an active employee…</option>
          {trainees.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className={LABEL}>Client IST</span>
        <select value={who} onChange={(e) => { setWho(e.target.value); setArmed('') }} disabled={busy} className={INPUT}
          data-ist-field="client">
          <option value="">Choose a client…</option>
          {clients.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className={LABEL}>Training Date</span>
        <input type="date" value={day} max={today} onChange={(e) => { setDay(e.target.value); setArmed('') }} disabled={busy}
          className={INPUT} data-ist-field="date" />
      </label>
      <div className="grid gap-1.5">
        <span className={LABEL}>Trainer Confirmation</span>
        <label className="flex items-start gap-2.5 rounded-md border border-border bg-surface-2/50 p-3 text-[13px] leading-5 text-text-1">
          <input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); setArmed('') }} disabled={busy}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" data-ist-field="confirm" />
          {IST_CONFIRM_WORDS}
        </label>
      </div>
      <ApplyStrip state={apply.state} onAgain={apply.reset} />
      <DraftButtons armed={armed === 'train'} busy={busy} disabled={!ready} label="Record training" armedLabel="Press again to record"
        onPress={() => void send()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}
