// One client's month in Client Finances — the ledger pane, drawn by the app beside its client picker and by the…
// One pane, so the two can never disagree.
import { useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight,
  Loader2, Lock, Plus, Receipt, Paperclip, FileX2,
} from 'lucide-react'
import { Badge } from '@/components/shared/Badge'
import Skeleton from '@/components/shared/Skeleton'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { cn } from '@/lib/utils'
import NewTransactionModal, { type FinClient } from './NewTransactionModal'
import Pane from './Pane'
import { dayLabel, money, monthLabel, shiftMonth } from './financeMonth'
import { useLedger, useMayCloseMonth, type Ledger } from './useLedger'

export type { Fund, Ledger, Txn } from './useLedger'
export type Vocab = { fundTypes: string[]; categories: string[]; txnTypes: string[]; exemptReasons: string[] }

export default function FinanceLedger({ client, clients, vocab, month, onMonth, onChanged, flat = false }: {
  /** the ledger's key is the client's NAME — Finance.gs keeps no client id */
  client: string
  /** who the New transaction form may name; the client record passes only its own */
  clients: FinClient[]
  vocab: Vocab
  month: string
  onMonth: (month: string) => void
  /** a receipt or an exemption landed — Client Finances refreshes its picker's counts */
  onChanged?: () => void
  /** drawn inside another card (the client record): flat boxes, not cards in a card */
  flat?: boolean
}) {
  const isAdmin = useMayCloseMonth()
  const { ledger, loading, error, reload } = useLedger(client, month)
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState('')

  // No receipt chase is sent from here: outstanding receipts are shown, and nobody is texted.

  // The receipt usually arrives AFTER the purchase was entered — this is the door that empties the chase list, so…
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachTo, setAttachTo] = useState('')
  const [exemptFor, setExemptFor] = useState('')

  const sendReceipt = async (f: File | null) => {
    const id = attachTo
    setAttachTo('')
    if (!f || !id) return
    if (f.size > 8 * 1024 * 1024) {
      toast({ type: 'warning', title: 'That photo is very large', body: 'Under 8 MB, please.' })
      return
    }
    setBusy('attach')
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => { const v = String(r.result ?? ''); res(v.slice(v.indexOf(',') + 1)) }
        r.onerror = () => rej(new Error('The file could not be read.'))
        r.readAsDataURL(f)
      })
      const out = await gasAction<{ verdict: string; note: string }>('finAttachReceipt', {
        id, receiptBase64: b64, receiptMime: f.type || 'image/jpeg', receiptFileName: f.name,
      })
      // The VERDICT is the message.
      toast({
        type: out.verdict === 'MISMATCH' ? 'danger' : out.verdict === 'MATCH' ? 'success' : 'warning',
        title: out.verdict === 'MATCH' ? 'Receipt matches' : out.verdict === 'MISMATCH' ? 'Receipt does NOT match' : 'Receipt saved, not verified',
        body: out.note,
      })
      reload()
      onChanged?.()
    } catch (e) {
      toast({ type: 'danger', title: 'Not attached', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const markExempt = async (id: string, reason: string) => {
    setExemptFor('')
    if (!reason) return
    setBusy('exempt')
    try {
      await gasAction('finMarkNoReceipt', { id, reason })
      toast({ type: 'success', title: 'Recorded as exempt', body: `${reason} — your name is on it.` })
      reload()
      onChanged?.()
    } catch (e) {
      toast({ type: 'danger', title: 'Not recorded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const closeMonth = async () => {
    if (!ledger) return
    // THE SERVER SAYS WHAT CLOSING WOULD DO, and it is asked before the question is put to a person.
    setBusy('close')
    let warn: string | undefined
    try {
      const pre = await gasAction<{ warnings: string[] }>('finCloseOutPreview', { client, month })
      if (pre.warnings.length) warn = pre.warnings.map((w) => '• ' + w).join('\n')
    } catch (e) {
      setBusy('')
      toast({ type: 'danger', title: 'Could not check the month', body: e instanceof Error ? e.message : 'Nothing was closed.' })
      return
    }
    const ok = await askConfirm({
      title: `Close ${monthLabel(month)} for ${client}?`,
      body: 'This cannot be undone from here.',
      detail: warn,
      confirmLabel: 'Close the month',
      tone: 'danger',
    })
    if (!ok) {
      setBusy('')
      return
    }
    try {
      await gasAction('finCloseMonth', { client, month })
      toast({ type: 'success', title: `${monthLabel(month)} closed`, body: 'Next month opens with these closing balances.' })
      reload()
    } catch (e) {
      toast({ type: 'danger', title: 'Not closed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  return (
    <>
      <LedgerView
        ledger={ledger}
        loading={loading}
        error={error}
        month={month}
        vocab={vocab}
        canCompose={!!client}
        isAdmin={isAdmin}
        busy={busy}
        exemptFor={exemptFor}
        onMonth={onMonth}
        onCompose={() => setComposing(true)}
        onCloseMonth={() => void closeMonth()}
        onAttach={(id) => { setAttachTo(id); fileRef.current?.click() }}
        onExemptAsk={setExemptFor}
        onExemptPick={(id, reason) => void markExempt(id, reason)}
        onExemptCancel={() => setExemptFor('')}
        flat={flat}
      />

      <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden
        onChange={(e) => { void sendReceipt(e.target.files?.[0] ?? null); e.target.value = '' }} />

      {composing && (
        <NewTransactionModal
          clients={clients}
          initialClient={client}
          vocab={vocab}
          onClose={() => setComposing(false)}
          onSaved={reload}
        />
      )}
    </>
  )
}

/** The pane as drawn — every figure is the ledger's; nothing is read or written here. */
export function LedgerView({
  ledger, loading, error, month, vocab, canCompose, isAdmin, busy, exemptFor,
  onMonth, onCompose, onCloseMonth, onAttach, onExemptAsk, onExemptPick, onExemptCancel, flat = false,
}: {
  ledger: Ledger | null
  loading: boolean
  /** the last read's failure — never drawn as an empty month */
  error: string
  month: string
  vocab: Vocab
  canCompose: boolean
  /** closing a month is the admin's alone (Finance.gs refuses anyone else) */
  isAdmin: boolean
  busy: string
  exemptFor: string
  onMonth: (month: string) => void
  onCompose: () => void
  onCloseMonth: () => void
  onAttach: (id: string) => void
  onExemptAsk: (id: string) => void
  onExemptPick: (id: string, reason: string) => void
  onExemptCancel: () => void
  /** drawn inside another card: flat boxes instead of cards */
  flat?: boolean
}) {
  const totalLeft = (ledger?.funds ?? []).reduce((s, f) => s + f.closing, 0)
  // no fund means no transaction and no balance closed into the month: one sentence, not three empty boxes
  const blank = !!ledger && ledger.funds.length === 0 && ledger.transactions.length === 0
  return (
    <div className={flat ? 'space-y-3' : 'space-y-4'}>
      <Pane flat={flat} padded={!flat} className={cn('flex flex-wrap items-center gap-3', flat && 'px-2 py-2')}>
        <div className="flex items-center gap-1">
          <button onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month"
            className={cn('grid h-8 w-8 place-items-center rounded-md text-text-2 transition-colors', flat ? 'hover:bg-surface-3' : 'hover:bg-surface-2')}>
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[150px] text-center text-[14px] font-bold text-text-1">{monthLabel(month)}</span>
          <button onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month"
            className={cn('grid h-8 w-8 place-items-center rounded-md text-text-2 transition-colors', flat ? 'hover:bg-surface-3' : 'hover:bg-surface-2')}>
            <ChevronRight size={16} />
          </button>
        </div>
        {ledger?.closed && (
          <Badge label="Closed" tint="mint" className="text-[10.5px]" />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={onCompose} disabled={!canCompose}
            className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
            <Plus size={14} /> New transaction
          </button>
          {isAdmin && (
            <button onClick={onCloseMonth} disabled={!canCompose || !ledger || busy === 'close' || ledger.closed}
              title={ledger?.closed ? 'This month is already closed' : 'Finalise this month and carry the balance forward'}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40">
              {busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Close month
            </button>
          )}
        </div>
      </Pane>

      {/* The strip appears ONLY when something is outstanding. */}
      {!!ledger?.missingReceipts && (
        <div className="flex items-start gap-2.5 rounded-lg border border-tint-amber bg-tint-amber px-4 py-3 text-tint-fg-amber">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="text-[13px] font-medium leading-5">
            <strong>{ledger.missingReceipts}</strong> transaction{ledger.missingReceipts === 1 ? '' : 's'} in{' '}
            {monthLabel(month)} {ledger.missingReceipts === 1 ? 'has' : 'have'} no receipt on file.
            <span className="font-normal"> They are highlighted below — nobody is texted automatically yet.</span>
          </p>
        </div>
      )}

      {loading && !ledger ? (
        <Pane flat={flat}><Skeleton className="h-24 w-full" /></Pane>
      ) : !ledger ? (
        <Pane flat={flat}>
          <p className="py-8 text-center text-[13px] text-text-3">
            {error ? `The ledger could not be read — ${error}` : 'Pick a client to see their money.'}
          </p>
        </Pane>
      ) : blank ? (
        <Pane flat={flat}>
          <p className="py-6 text-center text-[13px] text-text-3">
            Nothing is on the ledger for {monthLabel(month)}: no transaction, and no balance closed into it
            from {monthLabel(shiftMonth(month, -1))}.
          </p>
        </Pane>
      ) : (
        <>
          {/* tracks sized by the pane, not the viewport: the record draws it in a narrower column */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
            {ledger.funds.map((f) => (
              <Pane flat={flat} key={f.fundType} className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">{f.fundType}</p>
                  <span className="text-[11px] text-text-3">{f.count} txn</span>
                </div>
                <p className="font-stat text-[26px] font-bold leading-8 text-text-1">{money(f.closing)}</p>
                <div className="space-y-1 border-t border-border pt-2 text-[12px]">
                  <div className="flex justify-between text-text-3">
                    <span>Opening</span>
                    <span className="tabular-nums text-text-2">{money(f.opening)}</span>
                  </div>
                  <div className="flex justify-between text-text-3">
                    <span className="flex items-center gap-1"><ArrowDownLeft size={11} /> Deposits</span>
                    <span className="tabular-nums text-tint-fg-mint">{money(f.deposits)}</span>
                  </div>
                  <div className="flex justify-between text-text-3">
                    <span className="flex items-center gap-1"><ArrowUpRight size={11} /> Spending</span>
                    <span className="tabular-nums text-text-2">{money(f.spending)}</span>
                  </div>
                </div>
                {/* An opening balance nobody closed into is a GUESS, and the
                    card says so rather than showing a confident zero. */}
                {!f.openingKnown && (
                  <p className="text-[11px] leading-4 text-text-3">
                    {monthLabel(shiftMonth(month, -1))} was never closed, so this opens at zero.
                  </p>
                )}
              </Pane>
            ))}
          </div>

          <Pane flat={flat} padded={false} className={flat ? 'overflow-hidden' : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
              <p className="text-[13px] font-bold text-text-1">
                {ledger.transactions.length} transaction{ledger.transactions.length === 1 ? '' : 's'}
              </p>
              <p className="text-[12px] text-text-3">
                Left across all funds: <strong className="tabular-nums text-text-1">{money(totalLeft)}</strong>
              </p>
            </div>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Vendor / description</th>
                    <th className="px-4 py-2.5">Fund</th>
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Receipt</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.transactions.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-text-3">
                      Nothing recorded in {monthLabel(month)}.
                    </td></tr>
                  )}
                  {ledger.transactions.map((t) => (
                    <tr key={t.id} className={cn('border-b border-border last:border-0', t.needsReceipt && 'bg-tint-amber/30')}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-text-2">{dayLabel(t.date)}</td>
                      <td className="px-4 py-2.5">
                        <span className="block font-medium text-text-1">{t.vendor || t.type}</span>
                        {t.description && <span className="block text-[11.5px] text-text-3">{t.description}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-text-2">{t.fundType}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-text-3">{t.category || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {t.receiptName ? (
                          <span
                            title={t.receiptNote}
                            className={cn('inline-flex items-center gap-1 text-[12px]',
                              t.receiptVerdict === 'MISMATCH' ? 'font-semibold text-tint-fg-pink'
                              : t.receiptVerdict === 'MATCH' ? 'text-tint-fg-mint' : 'text-text-2')}
                          >
                            <Receipt size={12} />
                            {t.receiptVerdict === 'MATCH' ? 'matches'
                              : t.receiptVerdict === 'MISMATCH' ? 'does not match'
                              : t.receiptVerdict === 'UNREADABLE' ? 'unreadable'
                              : 'on file'}
                          </span>
                        ) : t.receiptVerdict === 'EXEMPT' ? (
                          <span className="text-[12px] text-text-3" title={t.receiptNote}>exempt</span>
                        ) : t.amount < 0 ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-tint-fg-amber">
                            <AlertTriangle size={12} /> missing
                          </span>
                        ) : (
                          <span className="text-[12px] text-text-3">—</span>
                        )}
                      </td>
                      <td className={cn('whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums',
                        t.amount < 0 ? 'text-text-1' : 'text-tint-fg-mint')}>
                        {money(t.amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        {t.needsReceipt && (
                          exemptFor === t.id ? (
                            // A reason from a CLOSED list.
                            <select
                              autoFocus
                              defaultValue=""
                              onBlur={onExemptCancel}
                              onChange={(e) => onExemptPick(t.id, e.target.value)}
                              className="h-8 rounded-md border border-border bg-surface px-2 text-[12px] text-text-1 outline-none focus:border-primary"
                            >
                              <option value="" disabled>Why is there none?</option>
                              {vocab.exemptReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <span className="inline-flex gap-1">
                              <button
                                type="button" disabled={!!busy}
                                onClick={() => onAttach(t.id)}
                                title="Attach the receipt"
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40"
                              >
                                <Paperclip size={12} /> Attach
                              </button>
                              <button
                                type="button" disabled={!!busy}
                                onClick={() => onExemptAsk(t.id)}
                                title="Record that no receipt is coming, and why"
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
                              >
                                <FileX2 size={12} /> None
                              </button>
                            </span>
                          )
                        )}
                        {!t.needsReceipt && t.receiptVerdict === 'EXEMPT' && (
                          <span className="text-[11.5px] text-text-3" title={t.receiptNote}>exempt</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Pane>

          <p className="flex items-center gap-1.5 px-1 text-[11.5px] text-text-3">
            <CalendarDays size={12} />
            Every figure here is recomputed from the transactions themselves — never from a stored total.
          </p>
        </>
      )}
    </div>
  )
}
