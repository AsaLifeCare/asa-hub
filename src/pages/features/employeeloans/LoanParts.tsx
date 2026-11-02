// The loan pieces Staff (Employee Pay, the right panel) and My Profile share: the loan request form, the payment…
// Each form files on the second press.
import { useState, type ReactNode } from 'react'
import { Banknote } from 'lucide-react'
import { Field, TintChip, inputCls } from '@/pages/features/clientops/OpsPageShell'
import { DraftButtons, SectionCard } from '@/pages/features/locations/LocationParts'
import { dayWords } from '@/pages/features/locations/locationModel'
import { nextPress } from '@/pages/features/timeoff/timeOffModel'
import { ohioToday } from '@/lib/ohio'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/useToastStore'
import {
  PAY_METHODS, STATE_WORDS, addPayment, centsOf, money, payableLabel, requestLoan, type LoansView, type Payable, type PayMethod,
} from './loansModel'

const TEXTAREA = 'min-h-[96px] w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'Try again.'

function MoneyInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text-3">$</span>
      <input id={id} inputMode="decimal" placeholder="0.00" value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'pl-7')} />
    </div>
  )
}

export const RESTRICTED_LINE = 'restricted payroll record'

/** New Employee Loan: a request the directors answer in My Work; nothing is outstanding until one approves it. */
export function LoanRequestForm({ staff, name, onDone, onFiled }: {
  staff: string
  name: string
  onDone: () => void
  onFiled: (answer: unknown) => void
}) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(ohioToday())
  const [purpose, setPurpose] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const cents = centsOf(amount)
  const ok = cents !== null && cents > 0 && !!date

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await requestLoan({ staff, amount, date, purpose: purpose.trim() })
      onFiled(got)
      toast({ type: 'success', title: 'Loan requested', body: got?.said || `${name} · ${money(String((cents ?? 0) / 100))}` })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not requested', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-loan-form="">
      <p className="text-[13px] text-text-2">
        Sent to the directors through Smart Comms and waiting in their My Work; the first answer decides. Nothing is
        outstanding until it is approved.
      </p>
      <Field label="Loan amount" required>
        <MoneyInput id="loan-amount" value={amount} disabled={busy} onChange={(v) => { setAmount(v); setArmed('') }} />
      </Field>
      <Field label="Disbursement date" required>
        <input id="loan-date" type="date" value={date} disabled={busy} className={inputCls}
          onChange={(e) => { setDate(e.target.value); setArmed('') }} />
      </Field>
      <Field label="Purpose (optional)">
        <textarea id="loan-purpose" value={purpose} disabled={busy} maxLength={300} placeholder="Add a short reason or description"
          onChange={(e) => { setPurpose(e.target.value); setArmed('') }} className={TEXTAREA} />
      </Field>
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!ok} label="Add Loan" armedLabel="Send request — press again"
        onPress={() => void file()} onDisarm={() => setArmed('')} onCancel={onDone} />
    </div>
  )
}

/** Add Payment: one of the person's approved loans, at most what it has outstanding. */
export function PaymentForm({ staff, payable, onDone, onFiled }: {
  /** the staff key, when filed from Staff; My Profile files on the session's own loans */
  staff?: string
  payable: Payable[]
  onDone: () => void
  onFiled: (answer: unknown) => void
}) {
  const [loan, setLoan] = useState(payable[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(ohioToday())
  const [method, setMethod] = useState<PayMethod>('manual')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = payable.find((p) => p.id === loan)
  const cents = centsOf(amount)
  const max = chosen ? Math.round(Number(chosen.outstanding) * 100) : 0
  const over = cents !== null && cents > max
  const ok = !!chosen && cents !== null && cents > 0 && !over && !!date

  const file = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await addPayment({ loan_id: loan, amount, date, method, ...(staff ? { staff } : {}) })
      onFiled(got)
      toast({ type: 'success', title: 'Payment recorded', body: got?.said || '' })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!payable.length) {
    return <p className="pt-1 text-[13px] text-text-3" data-payment-form="none">There is no approved loan with an amount outstanding.</p>
  }
  const reset = () => setArmed('')
  return (
    <div className="grid gap-4 pt-1" data-payment-form="">
      <Field label="Loan" required>
        <select id="pay-loan" value={loan} disabled={busy} className={inputCls} onChange={(e) => { setLoan(e.target.value); reset() }}>
          {payable.map((p) => <option key={p.id} value={p.id}>{payableLabel(p)}</option>)}
        </select>
      </Field>
      <Field label="Payment amount" required>
        <MoneyInput id="pay-amount" value={amount} disabled={busy} onChange={(v) => { setAmount(v); reset() }} />
      </Field>
      {over && <p className="-mt-2 text-[12px] text-[var(--danger)]">At most {money(chosen?.outstanding ?? '')} is outstanding.</p>}
      <Field label="Payment date" required>
        <input id="pay-date" type="date" value={date} disabled={busy} className={inputCls}
          onChange={(e) => { setDate(e.target.value); reset() }} />
      </Field>
      <Field label="Payment method" required>
        <select id="pay-method" value={method} disabled={busy} className={inputCls}
          onChange={(e) => { setMethod(e.target.value as PayMethod); reset() }}>
          {PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <DraftButtons armed={armed === 'file'} busy={busy} disabled={!ok} label="Add Payment" armedLabel="Record payment — press again"
        onPress={() => void file()} onDisarm={reset} onCancel={onDone} />
    </div>
  )
}

const STATE_TINT = { requested: 'warning', approved: 'mint', declined: 'slate' } as const
const HEAD = 'px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const CELL = 'px-3 py-3 align-top text-[13px] text-text-1'

/** Outstanding amount, the requests not yet part of the history, and the history newest first. */
export function LoansBody({ view, extra }: { view: LoansView; extra?: ReactNode }) {
  return (
    <div className="grid gap-5" data-loans="">
      <section className="flex items-center gap-4 rounded-[20px] border border-border bg-surface p-5 shadow-1 sm:p-6" data-outstanding="">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-tint-blue text-tint-fg-blue"><Banknote size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3">Outstanding amount</p>
          <p className="font-display text-[26px] font-bold leading-8 text-text-1">{money(view.outstanding)}</p>
        </div>
        {extra}
      </section>

      {view.requests.length > 0 && (
        <SectionCard title="Requests">
          <ul className="divide-y divide-border" data-requests="">
            {view.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 text-text-1">{r.label}<span className="block text-[11px] text-text-3">{r.id}</span></span>
                <span className="text-text-2">{dayWords(r.date)}</span>
                <span className="font-semibold text-text-1">{money(r.amount)}</span>
                <TintChip label={STATE_WORDS[r.state]} tint={STATE_TINT[r.state]} className="normal-case" />
                {r.answered_by && <span className="w-full text-[12px] text-text-3">By {r.answered_by}{r.note ? ` · ${r.note}` : ''}</span>}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Loan History">
        {view.history.length === 0
          ? <p className="py-4 text-center text-[13px] text-text-3">No approved loan yet.</p>
          : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse" data-history="">
                <thead>
                  <tr className="border-b border-border">
                    <th className={HEAD}>Date</th><th className={HEAD}>Loan</th><th className={HEAD}>Type</th>
                    <th className={HEAD}>Amount</th><th className={HEAD}>Balance after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {view.history.map((h) => (
                    <tr key={h.id} data-type={h.type}>
                      <td className={cn(CELL, 'whitespace-nowrap text-text-2')}>{dayWords(h.date)}</td>
                      <td className={CELL}>{h.label}<span className="block text-[11px] text-text-3">{h.loan_id}</span></td>
                      <td className={CELL}>
                        <TintChip label={h.type === 'payment' ? 'Payment' : 'Disbursement'} tint={h.type === 'payment' ? 'mint' : 'blue'} />
                        {h.method && <span className="mt-1 block text-[11px] text-text-3">{h.method}</span>}
                      </td>
                      <td className={cn(CELL, 'whitespace-nowrap')}>{money(h.amount)}</td>
                      <td className={cn(CELL, 'whitespace-nowrap text-text-2')}>{money(h.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className="mt-3 text-[12px] text-text-3">Payroll deductions are not connected yet, so the payments shown are the ones recorded here.</p>
      </SectionCard>
    </div>
  )
}

export function PayButton({ onPress }: { onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} data-add-payment=""
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2">
      Add Payment
    </button>
  )
}
