// THE FINANCES DRIVE FOLDER, INDEXED: the company's own finance papers — taxes, vendor invoices, billing, franchise…
// The extractor's PII law travels with the data: W-2s and bank statements were link-only at the source, so what…
import { useEffect, useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import Card from '@/components/shared/Card'
import { gasAction } from '@/features/hiring/shared'
import { openFile, toEmbedUrl } from '@/stores/useFileViewerStore'
import { cn } from '@/lib/utils'

type FinDoc = {
  name: string
  vendor: string
  doc_date: string
  amount: number | null
  currency: string
  category: string
  link: string
  mime: string
  /** the paper's Drive id, and whether the server keeps its own copy (the app on Python): it opens from there */
  id?: string
  kept?: boolean
}
type FinFolder = { subfolder: string; count: number; docs: FinDoc[] }

/** A paper the server keeps, opened in the platform's viewer from its own copy. */
function openKept(d: FinDoc, subfolder: string) {
  gasAction<{ b64?: string; mime?: string; name?: string }>('finDocFile', { id: d.id }, { timeoutMs: 120000 })
    .then((got) => {
      const raw = atob(got?.b64 || '')
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: got?.mime || d.mime || 'application/pdf' }))
      openFile({ title: d.name, subtitle: subfolder, url, icon: 'file-text' })
    })
    .catch(() => { if (d.link) window.open(d.link, '_blank', 'noreferrer') })
}

const usd = (n: number | null) =>
  n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function FinanceDocs() {
  const [folders, setFolders] = useState<FinFolder[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState('')

  useEffect(() => {
    let alive = true
    gasAction<{ folders: FinFolder[] }>('finDocs', {})
      .then((d) => {
        if (!alive) return
        setFolders(d.folders ?? [])
        if ((d.folders ?? []).length > 0) setOpen(d.folders[0].subfolder)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'The document index could not be read.') })
    return () => { alive = false }
  }, [])

  if (error) return <Card><p className="py-6 text-center text-[13px] text-text-2">{error}</p></Card>
  if (folders === null) {
    return (
      <Card>
        <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Opening the folder index…
        </p>
      </Card>
    )
  }
  if (folders.length === 0) {
    return <Card><p className="py-6 text-center text-[13px] italic text-text-3">The Finances folder is empty or not shared with the platform account yet.</p></Card>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {folders.map((f) => (
          <button
            key={f.subfolder}
            onClick={() => setOpen(f.subfolder)}
            className={cn('rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
              open === f.subfolder ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-surface text-text-2 hover:bg-surface-2')}
          >
            <FolderOpen size={11} className="mr-1 inline" />{f.subfolder} · {f.count}
          </button>
        ))}
      </div>

      {folders.filter((f) => f.subfolder === open).map((f) => (
        <Card key={f.subfolder} padded={false} className="overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-3">
                  <th className="px-4 py-2.5">Document</th>
                  <th className="px-4 py-2.5">Vendor</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {f.docs.map((d, i) => (
                  <tr key={d.name + i} className="border-b border-border/60 last:border-0 hover:bg-surface-2">
                    <td className="max-w-[320px] px-4 py-2">
                      {d.link || d.kept ? (
                        <button
                          onClick={() => {
                            if (d.kept && d.id) openKept(d, f.subfolder)
                            else if (toEmbedUrl(d.link).embeddable) openFile({ title: d.name, subtitle: f.subfolder, url: d.link, icon: 'file-text' })
                            else window.open(d.link, '_blank', 'noreferrer')
                          }}
                          className="clamp-1 block max-w-full text-left font-medium text-text-1 hover:underline"
                          title={d.name}
                        >
                          {d.name}
                        </button>
                      ) : (
                        <span className="clamp-1 block text-text-1" title={d.name}>{d.name}</span>
                      )}
                    </td>
                    <td className="max-w-[160px] px-4 py-2"><span className="clamp-1 block text-text-2">{d.vendor || '—'}</span></td>
                    <td className="whitespace-nowrap px-4 py-2 text-text-2">{d.doc_date || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-stat font-semibold text-text-1">{usd(d.amount) || '—'}</td>
                  </tr>
                ))}
                {f.count > f.docs.length && (
                  <tr><td colSpan={4} className="px-4 py-2 text-center text-[11px] text-text-3">
                    {f.count - f.docs.length} more in this folder — the newest 120 are listed.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <p className="px-1 text-[11.5px] text-text-3">
        Listed live from the company's Finances folder in Drive — the folders themselves, nobody's copy. Amounts and dates read from the filenames where stated.
      </p>
    </div>
  )
}
