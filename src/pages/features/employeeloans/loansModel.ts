// EMPLOYEE LOANS — the shapes EmployeeLoans.gs answers (employeeLoanList, employeeLoanMine) and the doors that…
// Pure readers: a field the answer does not carry is '' or an empty list, never a made-up value.
import { gasAction } from '@/features/hiring/shared'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const str = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v).trim())
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : [])

export type LoanState = 'requested' | 'approved' | 'declined'
export type OpenLoan = { id: string; label: string; amount: string; outstanding: string; date: string; paid_off: boolean }
export type LoanRequest = { id: string; label: string; amount: string; date: string; state: LoanState; answered_by: string; note: string }
export type LoanEvent = {
  id: string; loan_id: string; label: string; date: string; type: 'disbursement' | 'payment'; amount: string
  balance_after: string; method: string
}
export type Payable = { id: string; label: string; outstanding: string }
export type LoansView = {
  ready: boolean; why: string; full: boolean; outstanding: string; loans: OpenLoan[]; requests: LoanRequest[]
  history: LoanEvent[]; payable: Payable[]; can_pay: boolean; can_request: boolean
}

export const PAY_METHODS = [
  { id: 'manual', label: 'Manual payment' },
  { id: 'payroll', label: 'Payroll deduction' },
] as const
export type PayMethod = (typeof PAY_METHODS)[number]['id']

export const STATE_WORDS: Record<LoanState, string> = { requested: 'Waiting on the directors', approved: 'Approved', declined: 'Declined' }

export function loansOf(raw: unknown): LoansView {
  const o = rec(raw)
  const state = (v: unknown): LoanState => (['requested', 'approved', 'declined'].includes(str(v)) ? str(v) as LoanState : 'requested')
  return {
    ready: o.ready === true, why: str(o.why), full: o.full === true, outstanding: str(o.outstanding) || '0.00',
    loans: list(o.loans).map((l) => ({ id: str(l.id), label: str(l.label), amount: str(l.amount), outstanding: str(l.outstanding),
      date: str(l.date), paid_off: l.paid_off === true })),
    requests: list(o.requests).map((l) => ({ id: str(l.id), label: str(l.label), amount: str(l.amount), date: str(l.date),
      state: state(l.state), answered_by: str(l.answered_by), note: str(l.note) })),
    history: list(o.history).map((h) => ({ id: str(h.id), loan_id: str(h.loan_id), label: str(h.label), date: str(h.date),
      type: str(h.type) === 'payment' ? 'payment' as const : 'disbursement' as const, amount: str(h.amount),
      balance_after: str(h.balance_after), method: str(h.method) })),
    payable: list(o.payable).map((p) => ({ id: str(p.id), label: str(p.label), outstanding: str(p.outstanding) }))
      .filter((p) => p.id && Number(p.outstanding) > 0),
    can_pay: o.can_pay === true, can_request: o.can_request === true,
  }
}

/** '1200.00' → '$1,200.00'; '' stays ''. */
export function money(v: string): string {
  const n = Number(v)
  if (v === '' || !Number.isFinite(n)) return ''
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Cents of a typed amount, or null when it is not one (two decimals at most). */
export function centsOf(v: string): number | null {
  const s = v.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100)
}

export const payableLabel = (p: Payable): string => `${p.label} · ${money(p.outstanding)} outstanding`

/* ---------- the doors ---------- */

const WRITE = { retry: false }
type Said = { said?: string }

export const readLoans = (staff: string) => gasAction<unknown>('employeeLoanList', { staff })
export const readMyLoans = () => gasAction<unknown>('employeeLoanMine', {})

export const requestLoan = (draft: { staff: string; amount: string; date: string; purpose: string }) =>
  gasAction<Said>('employeeLoanRequest', draft, WRITE)

export const addPayment = (draft: { loan_id: string; amount: string; date: string; method: PayMethod; staff?: string }) =>
  gasAction<Said>('employeeLoanPayment', draft, WRITE)

/** The relay's ring after a loan write landed (server/snapshot_service.py STAFF_PROFILES_EVENT). */
export const LOANS_LIVE_EVENT = 'staff-profiles'
