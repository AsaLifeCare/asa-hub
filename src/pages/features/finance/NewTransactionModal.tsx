// New transaction — the form, rebuilt.
// The original asked for the same facts and asked for them badly: one long scroll where the fields that matter for…
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Receipt, ShoppingCart, Upload, Wallet, X } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import { ohioToday } from '@/lib/ohio'

export type FinClient = { name: string; house?: string; houseManager?: string }

type Props = {
  clients: FinClient[]
  initialClient?: string
  vocab: { fundTypes: string[]; categories: string[]; txnTypes: string[] }
  onClose: () => void
  onSaved: () => void
}

type TxnType = 'Spending' | 'Deposit' | 'Withdraw'

const TYPE_META: Record<TxnType, { icon: typeof Wallet; hint: string; sign: string }> = {
  Spending: { icon: ShoppingCart, hint: 'Money left the account for something bought', sign: '−' },
  Deposit: { icon: Wallet, hint: 'Money came in', sign: '+' },
  Withdraw: { icon: Receipt, hint: 'Cash taken out, not yet spent', sign: '−' },
}

const field = 'h-10 w-full rounded-md border border-border bg-surface px-3 text-[13.5px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'
const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-text-3'

// Today on OHIO's calendar — a transaction typed from anywhere lands on the company's day, not the reader's…
const todayLocal = ohioToday

export default function NewTransactionModal({ clients, initialClient, vocab, onClose, onSaved }: Props) {
  const [client, setClient] = useState(initialClient ?? '')
  const [date, setDate] = useState(todayLocal())
  const [type, setType] = useState<TxnType>('Spending')
  const [fundType, setFundType] = useState('')
  const [vendor, setVendor] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [receipt, setReceipt] = useState<{ name: string; mime: string; base64: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const amountNumber = useMemo(() => {
    const n = Number(amount.replace(/[,$\s]/g, ''))
    return isFinite(n) ? n : 0
  }, [amount])

  // Stated rather than left to the reader: the sign is the single fact that decides whether a balance goes up or…
  const effect = amountNumber > 0
    ? `${TYPE_META[type].sign}$${amountNumber.toFixed(2)} ${type === 'Deposit' ? 'into' : 'from'} ${fundType || 'the fund'}`
    : ''

  const missing: string[] = []
  if (!client) missing.push('client')
  if (!date) missing.push('date')
  if (!fundType) missing.push(type === 'Spending' ? 'payment type' : 'fund')
  if (!(amountNumber > 0)) missing.push('an amount above zero')
  if (type === 'Spending' && !vendor.trim()) missing.push('vendor')
  if (type === 'Spending' && !category) missing.push('category')

  const pickFile = (f: File | null) => {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) {
      toast({ type: 'warning', title: 'That photo is very large', body: 'Under 8 MB, please — anything bigger times out on the way up.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result ?? '')
      setReceipt({ name: f.name, mime: f.type || 'image/jpeg', base64: s.slice(s.indexOf(',') + 1) })
    }
    reader.readAsDataURL(f)
  }

  const submit = async () => {
    if (missing.length || saving) return
    setSaving(true)
    try {
      await gasAction('finSubmitTransaction', {
        client, date, type, fundType,
        amount: amountNumber,
        vendor: type === 'Spending' ? vendor.trim() : '',
        category: type === 'Spending' ? category : '',
        description: description.trim(),
        receiptBase64: receipt?.base64 ?? '',
        receiptMime: receipt?.mime ?? '',
        receiptFileName: receipt?.name ?? '',
      })
      toast({
        type: 'success',
        title: 'Transaction recorded',
        body: receipt || type !== 'Spending' ? 'Saved.' : 'Saved, and flagged as waiting on a receipt.',
      })
      onSaved()
      onClose()
    } catch (err) {
      toast({ type: 'danger', title: 'Not recorded', body: err instanceof Error ? err.message : 'Nothing was written — try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-[15px] font-bold text-text-1">New transaction</p>
            <p className="text-[12px] text-text-3">Written straight to the client ledger.</p>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* THE AMOUNT FIRST, and large. It is the fact the row exists for. */}
          <div className="rounded-lg border border-border bg-surface px-4 py-3.5">
            <label className={label} htmlFor="fin-amount">Amount</label>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-semibold text-text-3">$</span>
              <input
                id="fin-amount" inputMode="decimal" value={amount} placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
                className="font-stat w-full bg-transparent text-[30px] font-bold leading-9 text-text-1 outline-none placeholder:text-text-3/50"
              />
            </div>
            {effect && <p className="mt-1 text-[12px] font-medium text-text-2">{effect}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="fin-client">Client</label>
              <select id="fin-client" value={client} onChange={(e) => setClient(e.target.value)} className={field}>
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="fin-date">Date</label>
              <input id="fin-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
            </div>
          </div>

          <div>
            <p className={label}>What kind of transaction</p>
            <div className="grid grid-cols-3 gap-2">
              {(vocab.txnTypes as TxnType[]).map((t) => {
                const M = TYPE_META[t] ?? TYPE_META.Spending
                const on = type === t
                return (
                  <button
                    key={t} type="button" onClick={() => { setType(t); setFundType(''); }}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[13px] font-semibold transition-colors',
                      on ? 'border-primary bg-tint-blue text-tint-fg-blue' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
                    )}
                  >
                    <M.icon size={17} />
                    {t}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11.5px] text-text-3">{TYPE_META[type].hint}.</p>
          </div>

          <div className="rounded-lg border border-border bg-surface-2/40 px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className={type === 'Spending' ? '' : 'sm:col-span-2'}>
                <label className={label} htmlFor="fin-fund">
                  {type === 'Spending' ? 'Paid with' : type === 'Deposit' ? 'Into which fund' : 'Out of which fund'}
                </label>
                <select id="fin-fund" value={fundType} onChange={(e) => setFundType(e.target.value)} className={field}>
                  <option value="">Select…</option>
                  {vocab.fundTypes.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              {type === 'Spending' && (
                <>
                  <div>
                    <label className={label} htmlFor="fin-vendor">Vendor</label>
                    <input id="fin-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)}
                      placeholder="Walmart, Dollar Tree, Giant Eagle…" className={field} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={label} htmlFor="fin-category">Category</label>
                    <select id="fin-category" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                      <option value="">Select…</option>
                      {vocab.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <p className={label}>Receipt</p>
                    <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden
                      onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                    {receipt ? (
                      <div className="flex items-center gap-2 rounded-md border border-tint-mint bg-tint-mint px-3 py-2.5 text-[12.5px] font-medium text-tint-fg-mint">
                        <Receipt size={14} />
                        <span className="min-w-0 flex-1 truncate">{receipt.name}</span>
                        <button type="button" onClick={() => setReceipt(null)} className="shrink-0 underline">remove</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => fileRef.current?.click()}
                        className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border-strong px-3 py-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2">
                        <Upload size={14} /> Take a photo or choose a file
                      </button>
                    )}
                    {/* Said plainly, because the old form lied by making it required. */}
                    <p className="mt-1.5 text-[11.5px] leading-4 text-text-3">
                      You can record this without one — it will show as <strong>waiting on a receipt</strong> until the
                      photo arrives, and the house manager gets it on their reminder.
                    </p>
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <label className={label} htmlFor="fin-desc">Description</label>
                <input id="fin-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional — what this was for" className={field} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-5 py-4">
          {/* The button says WHAT IS MISSING instead of sitting greyed out with
              no explanation — the commonest way a form wastes somebody's minute. */}
          <p className="min-w-0 flex-1 text-[11.5px] leading-4 text-text-3">
            {missing.length ? `Still needed: ${missing.join(', ')}.` : 'Ready to record.'}
          </p>
          <button onClick={onClose} disabled={saving}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={!!missing.length || saving}
            className="flex h-9 items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40">
            {saving && <Loader2 size={14} className="animate-spin" />} Record transaction
          </button>
        </div>
      </div>
    </div>
  )
}
