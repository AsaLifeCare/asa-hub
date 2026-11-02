// Smart Shopper — a personal watchlist.
// One column of cards, because the list IS the app: what you mean to buy, what you are willing to pay, and roughly…
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import { Badge } from '@/components/shared/Badge'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import { askConfirm } from '@/stores/useDialogStore'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

type Estimate = { id: string; source: string; estimate: number; title: string; model: string; foundAt: string }
type Item = {
  id: string; name: string; category: string; targetPrice: number; notes: string
  status: string; estimates: Estimate[]; bestEstimate: number
  worthChecking: boolean; checkedAt: string
  /** the REAL side — typed by the buyer, never by a model */
  paidPrice: number; paidVendor: string; boughtAt: string
}
/** one of the company's own priced purchase documents (invoices/receipts) */
type CompanyPurchase = {
  name: string; vendor: string; category: string; kind: string
  amount: number | null; doc_date: string; link: string
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const field = 'h-9 rounded-md border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

export default function ShopperPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', category: '', targetPrice: '', notes: '' })
  /** the "Bought it" mini-form: which item is being closed, and the facts */
  const [buying, setBuying] = useState<{ id: string; paid: string; vendor: string } | null>(null)
  const [purchases, setPurchases] = useState<CompanyPurchase[] | null>(null)
  const [purchasesOpen, setPurchasesOpen] = useState(false)

  // THE REAL RECEIPTS: managers also see what the company itself has actually paid — documents, not estimates.
  useEffect(() => {
    let alive = true
    gasAction<{ purchases: CompanyPurchase[] }>('shopPurchases', {})
      .then((d) => { if (alive) setPurchases(d.purchases ?? []) })
      .catch(() => { if (alive) setPurchases(null) })
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await gasAction<{ items: Item[]; categories: string[] }>('shopList', {})
      setItems(r.items)
      setCategories(r.categories)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The list could not be read.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const watching = useMemo(() => (items ?? []).filter((i) => i.status === 'watching'), [items])
  const done = useMemo(() => (items ?? []).filter((i) => i.status !== 'watching'), [items])
  const flagged = useMemo(() => watching.filter((i) => i.worthChecking).length, [watching])

  const save = async () => {
    if (!draft.name.trim()) return
    setBusy('add')
    try {
      await gasAction('shopSave', {
        name: draft.name.trim(), category: draft.category || 'Other',
        targetPrice: draft.targetPrice, notes: draft.notes.trim(),
      })
      setDraft({ name: '', category: '', targetPrice: '', notes: '' })
      setAdding(false)
      await load()
    } catch (e) {
      toast({ type: 'danger', title: 'Not added', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  const setStatus = async (it: Item, status: string) => {
    setBusy(it.id)
    try {
      await gasAction('shopSave', { id: it.id, name: it.name, category: it.category,
                                    targetPrice: it.targetPrice, notes: it.notes, status })
      await load()
    } finally { setBusy('') }
  }

  const remove = async (it: Item) => {
    const ok = await askConfirm({
      title: `Remove “${it.name}” from your list?`,
      body: 'It comes off the list, with any estimates saved for it.',
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(it.id)
    try { await gasAction('shopRemove', { id: it.id }); await load() } finally { setBusy('') }
  }

  const estimate = async (it: Item) => {
    setBusy(it.id)
    try {
      const r = await gasAction<{ kept: number; via: string; advice: string; items: Item[] }>(
        'shopEstimate', { id: it.id })
      setItems(r.items)
      toast({
        type: 'info',
        title: `${r.kept} estimate(s) — ${r.via}`,
        // The advice is the useful half, and the warning travels with it.
        body: r.advice || 'These are typical prices from general knowledge, not live listings.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'No estimate', body: e instanceof Error ? e.message : 'Try again.' })
    } finally { setBusy('') }
  }

  return (
    <div className="w-full px-5 py-6">
      <PageHeader title="Smart Shopper" subtitle="What you mean to buy, and roughly what it costs." />

      {error && <p className="mb-4 rounded-md bg-tint-pink px-3 py-2 text-[12.5px] font-medium text-tint-fg-pink">{error}</p>}

      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => setAdding((a) => !a)}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover">
          {adding ? <X size={14} /> : <Plus size={14} />} {adding ? 'Cancel' : 'Add something'}
        </button>
        {flagged > 0 && (
          <span className="text-[12.5px] text-text-2">
            <strong className="text-tint-fg-mint">{flagged}</strong> under your target — worth checking
          </span>
        )}
      </div>

      {adding && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}>
          <Card className="mb-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <input autoFocus value={draft.name} placeholder="What is it?"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void save() }} className={field} />
              <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                className={cn(field, !draft.category && 'text-text-3')}>
                <option value="">Category…</option>
                {categories.map((c) => <option key={c} value={c} className="text-text-1">{c}</option>)}
              </select>
              <input value={draft.targetPrice} inputMode="decimal" placeholder="Target $"
                onChange={(e) => setDraft((d) => ({ ...d, targetPrice: e.target.value }))} className={field} />
            </div>
            <input value={draft.notes} placeholder="Anything that narrows it — size, brand, why"
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} className={cn(field, 'w-full')} />
            <div className="flex justify-end">
              <button onClick={() => void save()} disabled={!draft.name.trim() || busy === 'add'}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-40">
                {busy === 'add' && <Loader2 size={13} className="animate-spin" />} Add to list
              </button>
            </div>
          </Card>
        </motion.div>
      )}

      {!items ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : watching.length === 0 && done.length === 0 ? (
        <Card><p className="py-10 text-center text-[13px] text-text-3">Nothing on your list yet.</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {watching.map((it) => (
            <Card key={it.id} className={cn('space-y-2.5', it.worthChecking && 'border-tint-mint')}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-text-1">{it.name}</p>
                  {it.notes && <p className="text-[12px] text-text-3">{it.notes}</p>}
                </div>
                {it.category && <Badge label={it.category} tint="lavender" className="text-[10px]" />}
                {it.targetPrice > 0 && (
                  <span className="text-[12.5px] text-text-2">target <strong className="tabular-nums">{money(it.targetPrice)}</strong></span>
                )}
              </div>

              {it.estimates.length > 0 && (
                <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
                    Typical prices — estimated, not live listings
                  </p>
                  <div className="space-y-0.5">
                    {it.estimates.map((e) => (
                      <div key={e.id} className="flex items-baseline gap-2 text-[12.5px]">
                        <span className="tabular-nums font-semibold text-text-1">{money(e.estimate)}</span>
                        <span className="min-w-0 flex-1 truncate text-text-2">{e.title || e.source}</span>
                        <span className="shrink-0 text-[11px] text-text-3">{e.source}</span>
                      </div>
                    ))}
                  </div>
                  {/* WHO SAID IT. An estimate with no author becomes a fact. */}
                  <p className="mt-1.5 text-[11px] text-text-3">
                    From {it.estimates[0].model || 'a model'}’s general knowledge — check before you buy.
                  </p>
                </div>
              )}

              {it.worthChecking && (
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-tint-fg-mint">
                  <Sparkles size={13} /> Around {money(it.bestEstimate)} — under your target, worth checking.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
                <button onClick={() => void estimate(it)} disabled={busy === it.id}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-1 transition-colors hover:bg-surface-2 disabled:opacity-40">
                  {busy === it.id ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  {it.estimates.length ? 'Ask again' : 'What does it cost?'}
                </button>
                <button onClick={() => setBuying(buying?.id === it.id ? null : { id: it.id, paid: '', vendor: '' })} disabled={busy === it.id}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-40">
                  <Check size={12} /> Bought it
                </button>
                <button onClick={() => void remove(it)} disabled={busy === it.id} aria-label="Remove"
                  className="ml-auto grid h-8 w-8 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-40">
                  <Trash2 size={13} />
                </button>
              </div>

              {/* THE FACT, RECORDED: buying is the one moment a
                  REAL price exists — capture it, optional but asked. */}
              {buying?.id === it.id && (
                <div className="space-y-2 rounded-md border border-tint-mint bg-tint-mint/40 p-2.5">
                  <p className="text-[11.5px] font-semibold text-tint-fg-mint">What actually happened? (optional, but this is the real number)</p>
                  <div className="flex flex-wrap gap-2">
                    <input value={buying.paid} inputMode="decimal" placeholder="Paid $"
                      onChange={(e) => setBuying((b) => b && ({ ...b, paid: e.target.value }))}
                      className={cn(field, 'w-24')} />
                    <input value={buying.vendor} placeholder="Where (store)"
                      onChange={(e) => setBuying((b) => b && ({ ...b, vendor: e.target.value }))}
                      className={cn(field, 'min-w-0 flex-1')} />
                    <button
                      onClick={async () => {
                        setBusy(it.id)
                        try {
                          await gasAction('shopSave', {
                            id: it.id, name: it.name, category: it.category,
                            targetPrice: it.targetPrice, notes: it.notes, status: 'bought',
                            paidPrice: buying.paid, paidVendor: buying.vendor.trim(),
                          })
                          setBuying(null)
                          await load()
                        } finally { setBusy('') }
                      }}
                      disabled={busy === it.id}
                      className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-40"
                    >
                      {busy === it.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {done.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Done</p>
              <div className="space-y-1.5">
                {done.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[12.5px]">
                    <Check size={13} className="text-tint-fg-mint" />
                    <span className="min-w-0 flex-1 truncate text-text-2 line-through">{it.name}</span>
                    {it.paidPrice > 0 && (
                      <span className="shrink-0 text-[11.5px] text-text-2">
                        paid <strong className="tabular-nums">{money(it.paidPrice)}</strong>
                        {it.paidVendor ? ` at ${it.paidVendor}` : ''}
                      </span>
                    )}
                    <button onClick={() => void setStatus(it, 'watching')} className="text-[11.5px] text-text-3 underline hover:text-text-1">
                      put back
                    </button>
                    <button onClick={() => void remove(it)} aria-label="Remove"
                      className="grid h-6 w-6 place-items-center rounded-sm text-text-3 hover:text-danger">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── WHAT THE COMPANY ITSELF HAS PAID — real documents, never in the
             same breath as an estimate (managers; the door fails closed) ── */}
      {purchases !== null && purchases.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setPurchasesOpen((o) => !o)}
            className="mb-2 flex items-center gap-2 text-[13px] font-bold text-text-1">
            <span>{purchasesOpen ? '▾' : '▸'}</span>
            What the company itself has paid
            <span className="font-normal text-text-3">· {purchases.length} priced documents, from real invoices</span>
          </button>
          {purchasesOpen && (
            <Card padded={false} className="overflow-hidden">
              <div className="scroll-thin max-h-[340px] overflow-y-auto">
                {purchases.map((pRow, i) => (
                  <div key={i} className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2 text-[12.5px] last:border-0">
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-text-1" title={pRow.name}>{pRow.vendor || pRow.name}</span>
                      {pRow.vendor && pRow.name !== pRow.vendor && <span className="clamp-1 block text-[11px] text-text-3" title={pRow.name}>{pRow.name}</span>}
                    </span>
                    {pRow.category && <Badge label={pRow.category.replace(/_/g, ' ')} tint="blue" className="shrink-0 text-[10px]" />}
                    <span className="shrink-0 text-[11px] text-text-3">{pRow.doc_date || ''}</span>
                    <span className="shrink-0 tabular-nums font-semibold text-text-1">{pRow.amount != null ? money(pRow.amount) : '—'}</span>
                  </div>
                ))}
              </div>
              <p className="border-t border-border px-3 py-2 text-[11px] text-text-3">
                From the company's own invoice catalog — documents with a parsed amount only. A different truth from the estimates above, kept apart on purpose.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
