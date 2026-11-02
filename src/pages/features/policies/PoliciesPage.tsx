// Policies (and the contact list) — the documents, put back together.
// They live in the Hub's own tabs ONE ROW PER SECTION, because a spreadsheet cell stops at 50 000 characters and…
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { ExternalLink, FileDown } from 'lucide-react'
import { gasAction } from '@/features/hiring/shared'
import { toast } from '@/stores/useToastStore'
import DocumentsTemplate from '@/engine/templates/documents'
import EmptyState from '@/components/shared/EmptyState'
import Card from '@/components/shared/Card'
import Skeleton from '@/components/shared/Skeleton'
import { api } from '@/lib/api'
import type { Doc, DocBlock, PageSchema } from '@/engine/types'

type Row = {
  id?: string
  doc_id?: string
  title?: string
  collection?: string
  updatedAt?: string
  driveUrl?: string
  seq?: string | number
  heading?: string
  text?: string
  /** the server keeps this policy's original (the app on Python): it opens from there, never from Drive */
  originalKept?: boolean
}

const str = (v: unknown) => String(v ?? '').trim()
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Rows (already in sheet order) → one Doc per doc_id. */
function foldDocuments(rows: Row[]): Doc[] {
  const byDoc = new Map<string, { meta: Row; body: DocBlock[]; words: number; lastHeading: string }>()
  for (const r of rows) {
    const id = str(r.doc_id) || str(r.id)
    if (!id) continue
    const entry = byDoc.get(id) ?? { meta: r, body: [], words: 0, lastHeading: '' }
    const heading = str(r.heading)
    if (heading && heading !== entry.lastHeading) {
      entry.body.push({ kind: 'h2', text: heading, id: `${id}-${slug(heading) || entry.body.length}` })
      entry.lastHeading = heading
    }
    for (const para of str(r.text).split('\n')) {
      const p = para.trim()
      if (!p) continue
      entry.body.push({ kind: 'p', text: p })
      entry.words += p.split(/\s+/).length
    }
    byDoc.set(id, entry)
  }
  return [...byDoc.entries()].map(([id, e]) => ({
    id,
    title: str(e.meta.title) || id,
    excerpt: (e.body.find((b) => b.kind === 'p') as { text?: string } | undefined)?.text?.slice(0, 220) ?? '',
    collection: str(e.meta.collection) || 'policies',
    cover: '',
    authorIds: [],
    updatedAt: str(e.meta.updatedAt),
    readMinutes: Math.max(1, Math.round(e.words / 200)),
    body: e.body,
  }))
}

/** A policy's original off the server's own copy, handed to the browser to open or keep. */
function openOriginal(docId: string, title: string) {
  gasAction<{ b64?: string; mime?: string; name?: string }>('policyDocFile', { doc_id: docId }, { timeoutMs: 120000 })
    .then((got) => {
      const raw = atob(got?.b64 || '')
      const bytes = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes], { type: got?.mime || 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = got?.name || title
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    })
    .catch((e: unknown) => toast({ type: 'danger', title: 'Not opened',
      body: e instanceof Error ? e.message : 'The original could not be opened.' }))
}

export default function PoliciesPage() {
  // one component, both pages — /app/policy-acks/documents and …/contacts
  const { pageId } = useParams()
  const contacts = pageId === 'contacts'
  const resource = contacts ? 'contactLists' : 'policies'

  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    setError(null)
    api
      .list<Row>(resource as never)
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'The documents did not load.'))
    return () => {
      alive = false
    }
  }, [resource])

  const docs = useMemo(() => foldDocuments(rows ?? []), [rows])

  // The folded text is readable by EVERYONE — no Google account needed, and it is what the search box searches.
  const originals = useMemo(() => {
    const seen = new Map<string, { url: string; docId: string; kept: boolean }>()
    for (const r of rows ?? []) {
      const t = str(r.title)
      const u = str(r.driveUrl)
      if (t && (u || r.originalKept) && !seen.has(t)) seen.set(t, { url: u, docId: str(r.doc_id), kept: !!r.originalKept })
    }
    return [...seen.entries()]
  }, [rows])

  const schema = useMemo<PageSchema>(
    () => ({
      id: contacts ? 'contacts' : 'policies',
      type: 'documents',
      title: contacts ? 'Contact list' : 'Policies',
      icon: contacts ? 'phone' : 'shield',
      dataSource: { resource },
      config: {},
    }),
    [contacts, resource],
  )

  if (error) {
    return (
      <Card>
        <EmptyState title="The documents did not load" body={error} />
      </Card>
    )
  }
  if (rows === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    )
  }
  if (docs.length === 0) {
    return (
      <Card>
        <EmptyState
          title={contacts ? 'No contact list yet' : 'No policies yet'}
          body="Settings → Data → Import policies pulls them from the Drive folder into the Hub's own tab."
        />
      </Card>
    )
  }

  return (
    <>
      {originals.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-3">
          <span>Originals:</span>
          {originals.map(([title, o]) => (o.kept ? (
            <button
              key={title}
              type="button"
              onClick={() => openOriginal(o.docId, title)}
              className="inline-flex items-center gap-1 font-medium text-primary underline decoration-border underline-offset-2 transition-colors hover:text-primary-hover"
            >
              <FileDown size={11} /> {title}
            </button>
          ) : (
            <a
              key={title}
              href={o.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary underline decoration-border underline-offset-2 transition-colors hover:text-primary-hover"
            >
              <ExternalLink size={11} /> {title}
            </a>
          )))}
        </div>
      )}
    <DocumentsTemplate
      config={{
        cardStyle: 'cover',
        collections: contacts
          ? [{ id: 'contacts', label: 'Contact lists', icon: 'phone', tint: 'blue' }]
          : [{ id: 'policies', label: 'Policies & procedures', icon: 'shield', tint: 'peach' }],
        reader: { showToc: true, showMeta: true, allowPrint: true },
      }}
      data={docs}
      schema={schema}
    />
    </>
  )
}
