// My Loans: the session's own loans and payments, read-only, with Add Payment on its own approved loans in the…
// Drawn only when there is something to show; read again when the relay rings `staff-profiles`.
import { useCallback, useEffect, useState } from 'react'
import SidePanel from '@/components/shared/SidePanel'
import { onLiveEvent } from '@/lib/snapshotClient'
import { LOANS_LIVE_EVENT, loansOf, readMyLoans, type LoansView } from '@/pages/features/employeeloans/loansModel'
import { LoansBody, PayButton, PaymentForm, RESTRICTED_LINE } from '@/pages/features/employeeloans/LoanParts'

export default function MyLoans() {
  const [view, setView] = useState<LoansView | null>(null)
  const [failed, setFailed] = useState('')
  const [paying, setPaying] = useState(false)
  const load = useCallback(() => {
    readMyLoans()
      .then((raw) => { setView(loansOf(raw)); setFailed('') })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => onLiveEvent(LOANS_LIVE_EVENT, () => load()), [load])

  if (!view) {
    return failed ? <p className="mt-5 text-[12px] text-text-3" data-my-loans="failed">Your loans could not be read: {failed}</p> : null
  }
  if (!view.ready || (!view.history.length && !view.requests.length)) return null
  const canPay = view.can_pay && view.payable.length > 0
  return (
    <div className="mt-5 grid gap-3" data-my-loans="">
      <h2 className="font-display text-[17px] font-bold leading-6 text-text-1">My Loans</h2>
      <LoansBody view={view} extra={canPay ? <PayButton onPress={() => setPaying(true)} /> : undefined} />
      <SidePanel open={paying} onClose={() => setPaying(false)} label="Loan Payment" title="Add Payment">
        {paying && (
          <div className="grid gap-3">
            <p className="-mt-1 text-[12.5px] text-text-3">Your loans · {RESTRICTED_LINE}</p>
            <PaymentForm payable={view.payable} onDone={() => setPaying(false)} onFiled={() => load()} />
          </div>
        )}
      </SidePanel>
    </div>
  )
}
