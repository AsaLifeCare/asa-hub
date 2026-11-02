// Employee Pay: the restricted payroll record — the outstanding amount, the loan requests and the loan history…
// Read whole by the master, every badge App Control's staff-profiles.employeePay row names (the operator's sheet,
// confirmed 2026-10-29) and the person; a loan is filed only by the master and the Scheduling directors.
import { useEffect } from 'react'
import { Lock } from 'lucide-react'
import { onLiveEvent } from '@/lib/snapshotClient'
import { LOANS_LIVE_EVENT, loansOf, readLoans } from '@/pages/features/employeeloans/loansModel'
import { LoanRequestForm, LoansBody, PayButton, PaymentForm, RESTRICTED_LINE } from '@/pages/features/employeeloans/LoanParts'
import { NOT_PUBLISHED, type RosterRow, type StaffAsk } from '../staffModel'
import { readKey, staffWrote, useStaffRead } from '../useStaffRead'
import { EmptyNote, ReadLine } from '../StaffParts'

const UNSET_WORDS = 'Employee loans are not set up yet: their store has not been created.'

function useLoans(staff: string) {
  const read = useStaffRead(readKey('employeeLoanList', staff), () => readLoans(staff), loansOf)
  const { reload } = read
  useEffect(() => onLiveEvent(LOANS_LIVE_EVENT, () => reload()), [reload])
  return read
}

export default function EmployeePaySection({ row, onAsk }: { row: RosterRow; onAsk: (ask: StaffAsk) => void }) {
  const read = useLoans(row.key)
  const v = read.data
  return (
    <div className="grid gap-5" data-employee-pay="">
      <div className="flex items-start gap-3 rounded-[16px] border border-tint-amber bg-tint-amber px-4 py-3.5 text-tint-fg-amber" data-restricted="">
        <Lock size={17} className="mt-0.5 shrink-0" />
        <p className="text-[13px] leading-5"><span className="font-semibold">Restricted payroll record.</span> Loans start as a request the directors approve.</p>
      </div>
      <ReadLine state={read} what="the loans" onRetry={read.reload} />
      {v && !v.ready && <EmptyNote kind="missing">{UNSET_WORDS}</EmptyNote>}
      {v && v.ready && !v.full && <p className="text-[12.5px] leading-5 text-text-3" data-read="refused">{NOT_PUBLISHED}</p>}
      {v && v.ready && v.full && (
        <LoansBody view={v} extra={v.can_pay && v.payable.length > 0 ? <PayButton onPress={() => onAsk({ kind: 'payment' })} /> : undefined} />
      )}
    </div>
  )
}

function Whose({ name }: { name: string }) {
  return <p className="-mt-1 text-[12.5px] text-text-3" data-whose="">{name} · {RESTRICTED_LINE}</p>
}

/** The panel's New Employee Loan. */
export function LoanBody({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  return (
    <div className="grid gap-3">
      <Whose name={row.name} />
      <LoanRequestForm staff={row.key} name={row.name} onDone={onDone} onFiled={(got) => staffWrote(row.key, got)} />
    </div>
  )
}

/** The panel's Add Payment: the person's approved loans with an amount outstanding. */
export function PaymentBody({ row, onDone }: { row: RosterRow; onDone: () => void }) {
  const read = useLoans(row.key)
  const v = read.data
  return (
    <div className="grid gap-3">
      <Whose name={row.name} />
      <ReadLine state={read} what="the loans" onRetry={read.reload} />
      {v && !v.ready && <EmptyNote kind="missing">{UNSET_WORDS}</EmptyNote>}
      {v && v.ready && !v.can_pay && <p className="text-[12.5px] text-text-3">{NOT_PUBLISHED}</p>}
      {v && v.ready && v.can_pay && (
        <PaymentForm key={v.payable.map((p) => p.id).join()} staff={row.key} payable={v.payable} onDone={onDone}
          onFiled={(got) => staffWrote(row.key, got)} />
      )}
    </div>
  )
}
