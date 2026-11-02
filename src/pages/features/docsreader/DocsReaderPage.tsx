// Docs — the operational library, as REGISTERED BY THE ADMIN.
// It used to ship ten invented playbooks with invented authors.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { onSliceChange } from '@/lib/snapshotClient'
import { openFile, toEmbedUrl } from '@/stores/useFileViewerStore'
import { useAuthStore } from '@/auth/useAuthStore'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import SearchInput from '@/components/shared/SearchInput'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import type { TintName } from '@/engine/types'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'

type DocRow = { id: string; title: string; url: string; category: string }

const str = (v: unknown) => String(v ?? '').trim()

/** Same tint for the same category on every visit — no palette to maintain. */
const TINTS: TintName[] = ['mint', 'pink', 'amber', 'lavender', 'blue', 'peach']
function tintFor(category: string): TintName {
  let h = 0
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0
  return TINTS[h % TINTS.length]
}

/** "…/report.pdf" → PDF. Only ever a hint on the card. */
function kindOf(url: string): string {
  const m = url.toLowerCase().match(/\.(pdf|docx?|xlsx?|pptx?|csv|txt)(\?|#|$)/)
  if (m) return m[1].toUpperCase()
  if (/docs\.google\.com\/document/.test(url)) return 'DOC'
  if (/docs\.google\.com\/spreadsheets/.test(url)) return 'SHEET'
  if (/docs\.google\.com\/presentation/.test(url)) return 'SLIDES'
  if (/drive\.google\.com/.test(url)) return 'DRIVE'
  return 'LINK'
}

export default function DocsReaderPage() {
  const [rows, setRows] = useState<DocRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin'

  const load = useCallback(() => {
    let alive = true
    setError(null)
    api
      .list<Record<string, unknown>>('documents' as never)
      .then((r) => {
        if (!alive) return
        setRows(
          (Array.isArray(r) ? r : [])
            .map((x, i) => ({
              id: str(x.id) || `doc-${i}`,
              title: str(x.title),
              url: str(x.url) || str(x.link) || str(x.fileUrl),
              category: str(x.category) || str(x.collection) || 'Uncategorised',
            }))
            .filter((x) => x.title && x.url),
        )
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'The library did not load.')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => load(), [load])
  useEffect(() => onSliceChange((r) => r === 'documents' && load()), [load])

  const categories = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.category))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) =>
        (category === 'all' || r.category === category) &&
        (!q || r.title.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)),
    )
  }, [rows, query, category])

  const open = (doc: DocRow) => {
    if (toEmbedUrl(doc.url).embeddable) {
      openFile({ title: doc.title, subtitle: doc.category, url: doc.url, icon: 'file-text' })
      return
    }
    window.open(doc.url, '_blank', 'noopener,noreferrer')
  }

  if (error) {
    return (
      <div className="w-full">
        <PageHeader title="Docs" subtitle="Operational playbooks & guides" />
        <Card>
          <EmptyState title="The library did not load" body={error} />
        </Card>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="w-full space-y-3">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Docs"
        subtitle={
          rows.length
            ? `${rows.length} document${rows.length === 1 ? '' : 's'} · ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`
            : 'Operational playbooks & guides'
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No documents registered yet"
            body={
              isAdmin
                ? 'Settings → Docs is where they go in: a category, a name and a link to the PDF or Doc.'
                : 'An administrator has not added any documents to this library yet.'
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search documentation…"
              className="w-full sm:w-80"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {['all', ...categories].map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'h-8 rounded-full px-3 text-[12px] font-medium transition-colors duration-150',
                    category === c
                      ? 'bg-primary-soft text-primary-strong'
                      : 'bg-surface-2 text-text-3 hover:text-text-2',
                  )}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState title="Nothing matches" body="Try another search, or a different category." />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visible.map((doc, i) => {
                const tint = tintFor(doc.category)
                return (
                  <motion.button
                    key={doc.id}
                    initial={i < 10 ? { opacity: 0, y: 8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 10) * 0.03, duration: 0.22, ease: EASE_OUT_EXPO }}
                    onClick={() => open(doc)}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-1 transition-shadow duration-150 hover:shadow-2"
                  >
                    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-md', TINT_BG[tint], TINT_FG[tint])}>
                      <FileText size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TINT_BG[tint], TINT_FG[tint])}>
                          {doc.category}
                        </span>
                        <span className="font-mono text-[10.5px] font-semibold text-text-3">{kindOf(doc.url)}</span>
                      </span>
                      <span className="mt-1.5 block truncate text-[15px] font-semibold text-text-1">{doc.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-text-3">{doc.url}</span>
                    </span>
                    <ExternalLink
                      size={14}
                      className="mt-1 shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </motion.button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
