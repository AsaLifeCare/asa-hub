// Inventory · Supplies — THE COMPANY'S PROCUREMENT RECORD.
// The screen was not working: the old platform is the base to look at, and the same sources it uses are the sources to use…
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Paperclip, Plus, ReceiptText, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fileToBase64, gasAction, humanSize, inferMime, MAX_UPLOAD_BYTES } from '@/features/hiring/shared'
import { useAuthStore } from '@/auth/useAuthStore'
import { openFile, toEmbedUrl } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'
import { TASK_ATTACH_ACCEPT } from '@/lib/taskAttachments'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import SearchInput from '@/components/shared/SearchInput'
import SheetEditor from '@/components/shared/SheetEditor'
import { Badge } from '@/components/shared/Badge'
import { EASE_OUT_EXPO, staggerContainer } from '@/engine/motion'
import { SummaryStrip } from '@/features/ops/inventory/shared'
import { useDraftGuard } from '@/lib/useDraftGuard'
import { cn } from '@/lib/utils'

type SupplyItem = {
  id: string
  name: string
  vendor: string
  category: string
  kind: string
  invoice_no: string
  amount: number | null
  doc_date: string
  link: string
  updated_at: string
}
type SupplyCategory = { category: string; count: number; spend: number; last: string }
type SupplyVendor = { vendor: string; count: number; spend: number }
type SuppliesData = {
  items: SupplyItem[]
  categories: SupplyCategory[]
  vendors: SupplyVendor[]
  purchase_count: number
  total_spend: number
}

const TINTS = ['mint', 'blue', 'lavender', 'amber', 'peach', 'pink'] as const

/** a category's stable tint — hashed, so a new category still gets a colour */
function catTint(cat: string): (typeof TINTS)[number] {
  let h = 0
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0
  return TINTS[Math.abs(h) % TINTS.length]
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** the catalog's free-text label, made human: software_saas → Software / SaaS */
function catLabel(cat: string): string {
  const words = cat.replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Uncategorized'
}

// A document entered by hand is kept on the server (Inventory on Python), named `hubfile:…` and read through
// inventorySupplyFile; any other link opens as it is (a Drive file from before).
const KEPT = 'hubfile:'

/** Opens a kept supply document in the platform viewer, as a blob of its bytes off the server. */
async function openKept(r: SupplyItem): Promise<void> {
  try {
    const got = await gasAction<{ b64: string; mime: string; name: string }>('inventorySupplyFile', { url: r.link },
      { timeoutMs: 120000 })
    const raw = atob(got?.b64 || '')
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const blob = new Blob([bytes], { type: got?.mime || 'application/octet-stream' })
    openFile({ url: URL.createObjectURL(blob), title: got?.name || r.name || 'Document', subtitle: r.vendor,
      icon: 'receipt-text' })
  } catch (e) {
    toast({ type: 'danger', title: 'Not opened', body: e instanceof Error ? e.message : 'Try again.' })
  }
}

const inputCls =
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors placeholder:text-text-3 focus:border-primary'

/** the Sheet view's first row — stable, so a drag-reorder survives re-renders */
const SHEET_COLUMNS = [
  { key: 'name', label: 'Purchase' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'category', label: 'Category' },
  { key: 'amount', label: 'Amount' },
  { key: 'doc_date', label: 'Doc date' },
  { key: 'invoice_no', label: 'Invoice no' },
  { key: 'doc', label: 'Document' },
]

/** the free-entry choice in the category select — not a real folder name */
const NEW_CATEGORY = '__new_category__'

// The add — a purchase the Finances folders do not carry yet, typed in by a manager.
function AddSupplyModal({ open, onOpenChange, categories, onAdded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: string[]
  onAdded: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [customCat, setCustomCat] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [nameMissing, setNameMissing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Unsaved-work reminder: anything typed (or a file picked) while the dialog is open survives a navigation as a…
  useDraftGuard({
    id: 'supply-purchase',
    label: 'An unsaved supply purchase',
    dirty: open && (file !== null || Object.values(values).some((v) => v.trim() !== '')),
  })

  const set = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }))
    if (k === 'name') setNameMissing(false)
  }

  const close = (o: boolean) => {
    if (!o) {
      setValues({})
      setCustomCat(false)
      setFile(null)
      setNameMissing(false)
    }
    onOpenChange(o)
  }

  // The same two gates the backend holds — checked here too so a wrong pick costs a toast, not a 15MB upload that…
  const onFilePicked = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]
    ev.target.value = ''
    if (!f) return
    const mime = inferMime(f)
    if (!(mime.startsWith('image/') || mime === 'application/pdf')) {
      toast({ type: 'warning', title: 'Images and PDFs only' })
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast({ type: 'warning', title: 'Too large', body: `${humanSize(f.size)} — up to 15MB.` })
      return
    }
    setFile(f)
  }

  const submit = async () => {
    const name = values.name?.trim()
    if (!name) {
      setNameMissing(true)
      toast({ type: 'warning', title: 'A name is required', body: 'Say what was bought — everything else is optional.' })
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name,
        vendor: values.vendor?.trim() ?? '',
        category: (customCat ? values.customCategory : values.category)?.trim() ?? '',
        kind: values.kind?.trim() ?? '',
        invoice_no: values.invoice_no?.trim() ?? '',
        amount: values.amount?.trim() ?? '',
        doc_date: values.doc_date ?? '',
      }
      if (file) {
        payload.base64 = await fileToBase64(file)
        payload.filename = file.name
        payload.mime = inferMime(file)
      }
      await gasAction('inventorySupplyAdd', payload, { timeoutMs: 120000 })
      toast({
        type: 'success',
        title: `${name} — added`,
        body: file ? `${file.name} landed in the Supplies Docs folder.` : 'The purchase is on the record.',
      })
      onAdded()
      close(false)
    } catch (e) {
      toast({ type: 'danger', title: 'Could not add the supply', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-surface sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display text-[17px] font-bold text-text-1">Add a supply purchase</DialogTitle>
          <DialogDescription className="text-[13px] text-text-2">
            A purchase the Finances folders do not carry yet. It joins the same catalog, recorded under your name.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-[12px] font-medium text-text-2">Purchase name<span className="text-danger"> *</span></span>
            <input
              type="text"
              value={values.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              placeholder="What was bought"
              className={cn(inputCls, nameMissing && 'border-danger')}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Vendor</span>
            <input type="text" value={values.vendor ?? ''} onChange={(e) => set('vendor', e.target.value)} placeholder="Who sold it" className={inputCls} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Category</span>
            {customCat ? (
              <>
                <input
                  type="text"
                  autoFocus
                  value={values.customCategory ?? ''}
                  onChange={(e) => set('customCategory', e.target.value)}
                  placeholder="New category name"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => { setCustomCat(false); set('customCategory', '') }}
                  className="justify-self-start text-[11px] text-text-3 hover:text-text-1"
                >
                  Back to the folder list
                </button>
              </>
            ) : (
              <select
                value={values.category ?? ''}
                onChange={(e) => {
                  if (e.target.value === NEW_CATEGORY) setCustomCat(true)
                  else set('category', e.target.value)
                }}
                className={cn(inputCls, !values.category && 'text-text-3')}
              >
                <option value="">General</option>
                {categories.filter((c) => c !== 'General').map((c) => (
                  <option key={c} value={c} className="text-text-1">{catLabel(c)}</option>
                ))}
                <option value={NEW_CATEGORY} className="text-text-1">New category…</option>
              </select>
            )}
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Amount (USD)</span>
            <input type="number" min="0" step="0.01" value={values.amount ?? ''} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" className={inputCls} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Document date</span>
            <input type="date" value={values.doc_date ?? ''} onChange={(e) => set('doc_date', e.target.value)} className={inputCls} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Invoice no</span>
            <input type="text" value={values.invoice_no ?? ''} onChange={(e) => set('invoice_no', e.target.value)} placeholder="If the paper names one" className={inputCls} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] font-medium text-text-2">Kind</span>
            <input type="text" value={values.kind ?? ''} onChange={(e) => set('kind', e.target.value)} placeholder="Invoice, receipt, quote…" className={inputCls} />
          </label>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-[12px] font-medium text-text-2">Document (optional)</span>
            <input ref={fileInput} type="file" accept={TASK_ATTACH_ACCEPT} className="hidden" onChange={onFilePicked} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
              >
                <Paperclip size={13} /> {file ? 'Replace the file' : 'Attach a file'}
              </button>
              {file && (
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-2">
                  <span className="truncate" title={file.name}>{file.name}</span>
                  <span className="shrink-0 text-text-3">{humanSize(file.size)}</span>
                  <button type="button" aria-label="Remove the file" onClick={() => setFile(null)} className="shrink-0 text-text-3 hover:text-text-1">
                    <X size={13} />
                  </button>
                </span>
              )}
            </div>
            <span className="text-[11px] text-text-3">A photo or PDF of the invoice — up to 15MB. It lands in the platform's own Supplies Docs folder.</span>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => close(false)}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving}
            className="h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add supply'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function InventorySuppliesPage() {
  const isManager = useAuthStore((s) => ['admin', 'manager'].includes(String(s.user?.role)))
  const [data, setData] = useState<SuppliesData | null>(null)
  const [failed, setFailed] = useState(false)
  const [qRaw, setQRaw] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  // 50 a page — fifty at most, with pagination
  const [page, setPage] = useState(0)
  const [asSheet, setAsSheet] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // bumped after a successful add — the write busted the server cache, so a re-fetch returns the catalog with the…
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!isManager) return
    let alive = true
    gasAction<SuppliesData>('inventorySupplies', {}, { timeoutMs: 60000 })
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [isManager, tick])

  useEffect(() => {
    const id = setTimeout(() => setQ(qRaw), 200)
    return () => clearTimeout(id)
  }, [qRaw])

  const allRows = useMemo(() => {
    let out = data?.items ?? []
    if (cat) out = out.filter((r) => r.category === cat)
    if (q) {
      const needle = q.toLowerCase()
      out = out.filter((r) => `${r.name} ${r.vendor} ${r.category} ${r.invoice_no}`.toLowerCase().includes(needle))
    }
    return out
  }, [data, q, cat])
  const pages = Math.max(1, Math.ceil(allRows.length / 50))
  const rows = useMemo(() => allRows.slice(page * 50, page * 50 + 50), [allRows, page])
  useEffect(() => { setPage(0) }, [q, cat])

  if (!isManager) {
    return <p className="py-10 text-center text-[13px] italic text-text-3">The procurement record is for admins and managers.</p>
  }

  if (failed) {
    // Text only, the FinanceDocs grammar — the empty-box drawing read as an X stamped over the screen, so no…
    return (
      <div className="w-full">
        <PageHeader title="Inventory · Supplies" subtitle="The company's procurement record" />
        <Card>
          <p className="py-6 text-center text-[13px] italic text-text-3">
            The source folders did not answer. This screen lists the company's own Finances folders in Drive —
            if they were never shared with the platform account, share them and this fills itself.
          </p>
        </Card>
      </div>
    )
  }

  if (data === null) {
    return (
      <div className="w-full space-y-2">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
        <Card padded={false} className="p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-12 w-full" />
          ))}
        </Card>
      </div>
    )
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="w-full">
      <PageHeader
        title="Inventory · Supplies"
        subtitle={`${data.purchase_count} documents, read live from the company's own Finances folders in Drive`}
      />

      <SummaryStrip
        stats={[
          { label: 'Documents on record', value: data.purchase_count, icon: 'receipt-text', tint: 'blue' },
          { label: 'Folders', value: data.categories.length, icon: 'boxes', tint: 'mint' },
          { label: 'With a stated amount', value: data.items.filter((i) => i.amount != null).length, icon: 'store', tint: 'lavender' },
          { label: 'Recorded spend', value: money(data.total_spend), icon: 'circle-dollar-sign', tint: 'amber' },
        ]}
      />

      {/* ── categories, as a shelf anyone can walk ── */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setCat('')}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
            cat === '' ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2',
          )}
        >
          Everything · {data.purchase_count}
        </button>
        {data.categories.map((c) => (
          <button
            key={c.category}
            onClick={() => setCat(cat === c.category ? '' : c.category)}
            title={`${c.count} purchases${c.spend ? ` · ${money(c.spend)}` : ''}`}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
              cat === c.category
                ? 'border-primary bg-primary-soft text-primary-strong'
                : cn('border-transparent', `bg-tint-${catTint(c.category)}`, `text-tint-fg-${catTint(c.category)}`),
            )}
          >
            {catLabel(c.category)} · {c.count}
          </button>
        ))}
      </div>

      {/* ── the add — its own row, right under the folder shelf ── */}
      <div className="mb-4">
        <button
          onClick={() => setAddOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus size={14} /> Add supply
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={qRaw} onChange={setQRaw} className="w-[300px] max-w-full" placeholder="Search purchases, vendors, invoices…" />
        <button
          onClick={() => setAsSheet((v) => !v)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 hover:bg-surface-2"
        >
          {asSheet ? 'Normal view' : 'Sheet view'}
        </button>
      </div>

      {/* ── the same rows as a spreadsheet — ALL filtered rows, not one page ── */}
      {asSheet && (
        <SheetEditor
          toolbar
          title="supplies — procurement record"
          columns={SHEET_COLUMNS}
          rows={allRows.map((r) => ({
            name: r.name,
            vendor: r.vendor,
            category: catLabel(r.category),
            amount: r.amount == null ? '' : r.amount,
            doc_date: r.doc_date,
            invoice_no: r.invoice_no,
            doc: r.link ? 'on file' : '',
          }))}
        />
      )}

      {!asSheet && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}>
          <Card padded={false} className="overflow-hidden">
            {rows.length === 0 ? (
              <p className="py-6 text-center text-[13px] italic text-text-3">
                {q || cat
                  ? 'No purchases match — clear the search or the folder chip.'
                  : 'Nothing in the catalog yet. The Finances folders in Drive fill this, and Add supply above records what they do not carry.'}
              </p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">
                      <th className="px-4 py-3">Purchase</th>
                      <th className="px-4 py-3">Vendor</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Doc date</th>
                      <th className="w-12 px-4 py-3" aria-label="Open" />
                    </tr>
                  </thead>
                  <motion.tbody key={`${q}-${cat}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
                    {rows.map((r, i) => (
                      <motion.tr
                        key={r.id || i}
                        initial={i < 12 ? { opacity: 0, y: 8 } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 12) * 0.02, duration: 0.2 }}
                        className="border-b border-border last:border-0 hover:bg-surface-2"
                        style={{ height: 52 }}
                      >
                        <td className="px-4">
                          <span className="clamp-1 text-[13px] font-medium text-text-1" title={r.name}>{r.name || '—'}</span>
                          {r.invoice_no && <span className="clamp-1 block text-[11px] text-text-3">Invoice {r.invoice_no}</span>}
                        </td>
                        <td className="max-w-[180px] px-4">
                          <span className="clamp-1 text-[12.5px] text-text-2" title={r.vendor}>{r.vendor || '—'}</span>
                        </td>
                        <td className="px-4">
                          <Badge label={catLabel(r.category)} tint={catTint(r.category)} />
                        </td>
                        <td className="px-4 text-right font-stat text-[13px] font-semibold text-text-1">{money(r.amount)}</td>
                        <td className="px-4 text-[12.5px] text-text-2">{r.doc_date || '—'}</td>
                        <td className="px-4">
                          {r.link && (
                            <button
                              aria-label="Open the document"
                              title="Open the document"
                              onClick={() => {
                                if (r.link.startsWith(KEPT)) void openKept(r)
                                else if (toEmbedUrl(r.link).embeddable) openFile({ title: r.name || 'Document', subtitle: r.vendor, url: r.link, icon: 'receipt-text' })
                                else window.open(r.link, '_blank', 'noreferrer')
                              }}
                              className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
                            >
                              <ReceiptText size={15} />
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </motion.tbody>
                </table>
              </div>
            )}
          </Card>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-[12.5px]">
              <button onClick={() => setPage((n) => Math.max(0, n - 1))} disabled={page === 0}
                className="rounded-md border border-border px-3 py-1 font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">Previous</button>
              <span className="text-text-3">page {page + 1} of {pages} · {allRows.length} documents</span>
              <button onClick={() => setPage((n) => Math.min(pages - 1, n + 1))} disabled={page >= pages - 1}
                className="rounded-md border border-border px-3 py-1 font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40">Next</button>
            </div>
          )}
        </motion.div>
      )}

      <AddSupplyModal
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={data.categories.map((c) => c.category)}
        onAdded={() => setTick((t) => t + 1)}
      />
    </motion.div>
  )
}
