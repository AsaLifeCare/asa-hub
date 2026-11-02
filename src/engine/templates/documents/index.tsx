/**
 * `documents` template (page-types.md §4) — doc library + immersive reader.
 * One route, internal state: library view (collection rail + cover grid,
 * search/sort) ↔ reader view (hero, sticky scroll-spy TOC, rich typography,
 * reading progress hairline, print action). Templates stay generic — all
 * content comes from `data` + `config`.
 *
 * Wave-2 (Knowledge): review fixes (reader keyed per document so spy/progress/
 * feedback state can't leak between docs, TOC dot no longer shifts rows,
 * scroll-spy lockout after TOC clicks, library scroll restored on remount,
 * drafts visible to editors only) + course docs (kind 'course' with modules[],
 * module sidebar with locally-persisted per-user progress, "% complete" card
 * chip, Create → Document/Course flow) + global bookmarks.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
// updated-at is an instant → Ohio wall-clock for every viewer
import { ohioDayYear } from '@/lib/ohio'
import { AnimatePresence, motion } from 'framer-motion'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import { useCan } from '@/auth/permissions'
import { personById } from '@/lib/people-lookup'
import ContextBanner from '@/components/shared/ContextBanner'
import { useContextStore } from '@/stores/useContextStore'
import { focusFromRow, inferFocusDrag, rowFocusTier } from '@/lib/focus'
import type { ExportColumn } from '@/lib/exportTable'
import type { Doc } from '@/engine/types'
import type { CollectionCfg, ReaderCfg, SortKey } from './types'
import { collectionsFromRecords, ext, recordToDoc, type DocMap } from './utils'
import { useCourseProgress } from './use-course-progress'
import { useSheetOrdering } from '@/engine/templates/sheet/use-sheet-ordering'
import { mulberry32 } from '@/engine/templates/sheet/ordering'
import { Reader } from './Reader'
import { NewDocModal } from './NewDocModal'
import { NewCourseModal } from './NewCourseModal'
import { ToolbarActions } from './ToolbarActions'
import { CollectionRail } from './CollectionRail'
import { NewCollectionModal } from './NewCollectionModal'
import { EditDocModal } from './EditDocModal'
import EditRecordModal, { type EditSpec } from '@/components/shared/EditRecordModal'
import { DEFAULT_COVER } from './covers'
import { docFromFile, docFromLink, fileToBase64 } from './importDoc'
import { ImportLinkModal } from './ImportLinkModal'
import { api } from '@/lib/api'
import { gasAction } from '@/features/hiring/shared'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { people } from '@/lib/seed'
import { useAuthStore } from '@/auth/useAuthStore'
import { toast } from '@/stores/useToastStore'
import { LibraryGrid } from './LibraryGrid'

// Part of this module's public API (was exported by DocumentsTemplate.tsx).
export type { CourseModule } from './types'

export default function DocumentsTemplate({ config, data, schema, onRows }: TemplateProps) {
  // A page may hand the library real Doc rows, or hand it any resource plus a `docMap` describing how its fields…
  const docMap = config.docMap as DocMap | undefined
  // saved edits ride over the fetched rows until the next load
  const [recordPatches, setRecordPatches] = useState<Record<string, any>>({})
  const baseDocs = useMemo(
    () =>
      docMap
        ? (data as any[]).map((r) => recordToDoc(recordPatches[String(r.id)] ?? r, docMap))
        : (data as Doc[]),
    [data, docMap, recordPatches],
  )
  const derivedCollections = useMemo(
    () => (docMap ? collectionsFromRecords(data as any[], docMap, config.collectionStyle as any) : []),
    [data, docMap, config.collectionStyle],
  )
  // Memoised: a fresh array every render changed the identity of `collections` below, which re-ran the effects that…
  const configuredCollections = useMemo(
    () => [...((config.collections ?? []) as CollectionCfg[]), ...derivedCollections],
    [config.collections, derivedCollections],
  )
  const readerCfg = (config.reader ?? {}) as ReaderCfg
  const [created, setCreated] = useState<Doc[]>([])
  const [collection, setCollection] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [openId, setOpenId] = useState<string | null>(null)
  const [createKind, setCreateKind] = useState<'doc' | 'course' | null>(null)
  const user = useAuthStore((st) => st.user)
  // Collections come from two places: the app registry ships the defaults, the rest are added from the screen…
  const [extraCollections, setExtraCollections] = useState<CollectionCfg[]>([])
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [importLinkOpen, setImportLinkOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<string | null>(null)
  const resourceName = (schema.dataSource?.resource as string) ?? schema.id
  /** An edit form straight from the map: one textarea per section it renders. */
  const recordEditSpec = useMemo<EditSpec | undefined>(() => {
    if (!docMap) return undefined
    return {
      title: `Edit ${String(config.entity?.[0] ?? 'record')}`,
      description: 'Saved straight to the row this document was built from.',
      resource: resourceName,
      perm: (config.editPerm as any) ?? 'knowledge.edit',
      submitLabel: 'Save',
      fields: [
        { key: docMap.title, label: 'Title', required: true },
        ...docMap.sections.map((sec) => ({ key: sec.field, label: sec.heading, type: 'textarea' as const })),
      ],
    }
  }, [docMap, resourceName, config.entity, config.editPerm])
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null)
  const [editedDocs, setEditedDocs] = useState<Record<string, Doc>>({})
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  useEffect(() => {
    if (useApiConfigStore.getState().driver !== 'apps-script') return
    let alive = true
    gasAction<{ collections?: CollectionCfg[] }>('collectionsList', {})
      .then((r) => alive && setExtraCollections(Array.isArray(r?.collections) ? r.collections : []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const collections = useMemo(() => {
    const seen = new Set(configuredCollections.map((c) => c.id))
    return [...configuredCollections, ...extraCollections.filter((c) => !seen.has(c.id))]
  }, [configuredCollections, extraCollections])
  const savedScroll = useRef(0)
  const canEdit = useCan('knowledge.edit')
  const { mine: courseProgress, toggle: toggleModule, pctOf } = useCourseProgress()

  // Local edits/deletes ride over the fetched rows so the library reacts at once; the sheet is the source of truth…
  const docs = useMemo(
    () =>
      [...baseDocs, ...created]
        .filter((d) => !deletedIds.includes(d.id))
        .map((d) => editedDocs[d.id] ?? d),
    [baseDocs, created, editedDocs, deletedIds],
  )
  // drafts are working copies — only editors see them (and their pills)
  const visibleDocs = useMemo(() => docs.filter((d) => canEdit || ext(d).status !== 'draft'), [docs, canEdit])

  // sweep: Person Focus Mode — config.scopeBy (field key or key array) scopes the library to docs linked to the…
  const scopeByKeys = useMemo(() => {
    const s = config.scopeBy as string | string[] | undefined
    return Array.isArray(s) ? s : s ? [s] : []
  }, [config.scopeBy])
  const focus = useContextStore((s) => s.focus)
  const docTiers = useMemo(
    () => visibleDocs.map((d: any) => (focus && scopeByKeys.length > 0 ? rowFocusTier(d, scopeByKeys, focus) : 0)),
    [visibleDocs, focus, scopeByKeys],
  )
  const bestDocTier = useMemo(() => {
    let best: 0 | 1 | 2 | 3 = 0
    for (const t of docTiers) if (t !== 0 && (best === 0 || t < best)) best = t
    return best
  }, [docTiers])
  const scopeFiltered = Boolean(focus && scopeByKeys.length > 0 && bestDocTier !== 0)
  const scopedDocs = useMemo(() => {
    if (!focus || scopeByKeys.length === 0 || bestDocTier === 0) return visibleDocs
    return visibleDocs.filter((_: any, i: number) => docTiers[i] === bestDocTier)
  }, [visibleDocs, focus, scopeByKeys, docTiers, bestDocTier])

  // THE ROWS THIS LIBRARY HOLDS, for a header drawn over it: saved edits, adds and deletes, the drafts this reader…
  const heldRows = useMemo(() => {
    if (!docMap) return scopedDocs as unknown as Record<string, unknown>[]
    const recordOf = new Map<string, Record<string, unknown>>()
    ;(data as Record<string, unknown>[]).forEach((r, i) => {
      const doc = baseDocs[i]
      if (doc) recordOf.set(doc.id, recordPatches[String(r.id)] ?? r)
    })
    // a document added here has no record behind it; it is still on the page
    return scopedDocs.map((d) => recordOf.get(d.id) ?? (d as unknown as Record<string, unknown>))
  }, [docMap, data, baseDocs, recordPatches, scopedDocs])
  const focusName = scopeFiltered && focus ? focus.name : ''
  useEffect(() => {
    onRows?.({ rows: heldRows, scope: focusName || undefined })
  }, [onRows, heldRows, focusName])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    scopedDocs.forEach((d) => m.set(d.collection, (m.get(d.collection) ?? 0) + 1))
    return m
  }, [scopedDocs])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = collection === 'all' ? scopedDocs : scopedDocs.filter((d) => d.collection === collection)
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q))
    return [...list].sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'read'
          ? a.readMinutes - b.readMinutes
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }, [scopedDocs, collection, query, sort])

  // The library gets the ordering the tables already have: A→Z, Z→A, a seeded shuffle, or a manual order you drag…
  const orderKey = `asa-lib-order-v1:${resourceName}`
  const allIds = useMemo(() => searched.map((d) => d.id), [searched])
  const { ordering, setOrdering, shuffleSeed, setShuffleSeed, orderSensors, effectiveOrder, onOrderDragEnd } =
    useSheetOrdering(orderKey, allIds)

  // Who a document is about.
  const libFocusDrag = useMemo(
    () => (docMap ? inferFocusDrag(resourceName, data as any[], docMap.title) : undefined),
    [docMap, resourceName, data],
  )
  const focusForDoc = useMemo(() => {
    if (!libFocusDrag || ordering === 'manual') return undefined
    const byId = new Map((data as any[]).map((r) => [String(r.id), r]))
    return (d: Doc) => {
      const rec = byId.get(d.id)
      return rec ? focusFromRow(rec, libFocusDrag) : null
    }
  }, [data, libFocusDrag, ordering])

  const filtered = useMemo(() => {
    if (ordering === 'az') return [...searched].sort((a, b) => a.title.localeCompare(b.title))
    if (ordering === 'za') return [...searched].sort((a, b) => b.title.localeCompare(a.title))
    if (ordering === 'random') {
      const rnd = mulberry32(shuffleSeed)
      return [...searched]
        .map((d) => ({ d, k: rnd() }))
        .sort((x, y) => x.k - y.k)
        .map((x) => x.d)
    }
    if (ordering === 'manual') {
      const pos = new Map(effectiveOrder.map((id, i) => [id, i]))
      return [...searched].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    }
    return searched
  }, [searched, ordering, shuffleSeed, effectiveOrder])

  const openDoc = visibleDocs.find((d) => d.id === openId)

  // sheet-core: library export (default-on, opt out with `export: false`) — exports the CURRENT filtered + sorted…
  const exportColumns = useMemo<ExportColumn[]>(
    () => [
      { key: 'title', label: 'Title' },
      {
        key: 'collection',
        label: 'Collection',
        accessor: (d: Doc) => collections.find((c) => c.id === d.collection)?.label ?? d.collection,
      },
      { key: 'authorIds', label: 'Authors', accessor: (d: Doc) => d.authorIds.map((id) => personById(id)?.name ?? id) },
      { key: 'updatedAt', label: 'Updated', accessor: (d: Doc) => ohioDayYear(d.updatedAt) },
      { key: 'readMinutes', label: 'Read (min)' },
      { key: 'excerpt', label: 'Excerpt' },
    ],
    [collections],
  )

  // Import: read the file, parse it into blocks, persist it like any other document and open it.
  const targetCollection = () => (collection !== 'all' ? collection : (collections[0]?.id ?? 'policies'))

  const importFile = async (file: File) => {
    try {
      // A PDF is not text to be parsed — it is a file to be kept and read.
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        await importPdf(file)
        return
      }
      const text = await file.text()
      const doc = docFromFile({
        filename: file.name,
        source: text,
        collection: targetCollection(),
        cover: DEFAULT_COVER,
        authorId: user?.id ?? people[0]?.id ?? 'p-01',
      })
      await api.create('documents', doc).catch(() => {})
      setCreated((prev) => [...prev, doc])
      toast({ type: 'success', title: 'Document imported', body: `${doc.title} · ${doc.readMinutes} min read` })
      openReader(doc.id)
    } catch (err) {
      toast({
        type: 'danger',
        title: 'Could not import that file',
        body: err instanceof Error ? err.message : 'Try a .md, .txt or .pdf file.',
      })
    }
  }

  const importPdf = async (file: File) => {
    if (useApiConfigStore.getState().driver !== 'apps-script') {
      toast({ type: 'warning', title: 'PDF import needs the live backend', body: 'Switch the data source to the live backend first.' })
      return
    }
    toast({ type: 'info', title: 'Uploading PDF…', body: file.name })
    const base64 = await fileToBase64(file)
    const res = await gasAction<{ file_url: string; file_name: string }>('libraryUpload', {
      base64,
      filename: file.name,
      mime_type: file.type || 'application/pdf',
    })
    const doc = docFromLink({
      title: file.name.replace(/\.pdf$/i, ''),
      url: res.file_url,
      collection: targetCollection(),
      cover: DEFAULT_COVER,
      authorId: user?.id ?? people[0]?.id ?? 'p-01',
      note: 'PDF stored in the platform library folder.',
    })
    await api.create('documents', doc).catch(() => {})
    setCreated((prev) => [...prev, doc])
    toast({ type: 'success', title: 'PDF added to the library', body: doc.title })
    openReader(doc.id)
  }

  // Import a Google Doc / Drive link — the file stays where it is; the library gains an entry that opens it inside…
  const importLink = async ({ title, url }: { title: string; url: string }) => {
    const doc = docFromLink({
      title,
      url,
      collection: targetCollection(),
      cover: DEFAULT_COVER,
      authorId: user?.id ?? people[0]?.id ?? 'p-01',
      note: 'Lives in Google Drive — opens inside the platform.',
    })
    await api.create('documents', doc).catch(() => {})
    setCreated((prev) => [...prev, doc])
    setImportLinkOpen(false)
    toast({ type: 'success', title: 'Link added to the library', body: doc.title })
    openReader(doc.id)
  }

  const openReader = (id: string) => {
    savedScroll.current = document.getElementById('main-scroll')?.scrollTop ?? 0
    setOpenId(id)
  }
  // prev/next inside the reader: do NOT overwrite the library scroll position
  const openFromReader = (id: string) => setOpenId(id)
  const closeReader = () => setOpenId(null)
  // the library remounts after the reader's exit animation (mode="wait") — a bare rAF fires too early, so restore…
  const restoreLibraryScroll = (el: HTMLDivElement | null) => {
    if (!el) return
    const s = document.getElementById('main-scroll')
    if (s && savedScroll.current > 0) s.scrollTop = savedScroll.current
  }

  return (
    <div className="w-full">
      <AnimatePresence mode="wait">
        {openDoc ? (
          <Reader
            key={openDoc.id}
            doc={openDoc}
            docs={visibleDocs}
            collections={collections}
            readerCfg={readerCfg}
            courseChecked={courseProgress[openDoc.id] ?? []}
            onToggleModule={(mid) => toggleModule(openDoc.id, mid)}
            coursePct={pctOf(openDoc)}
            onBack={closeReader}
            docKind={(config.feedbackKind as string) ?? (docMap ? (schema.dataSource?.resource as string) : 'doc')}
            onEditDoc={canEdit ? (d) => (docMap ? setEditingRecord(d.id) : setEditingDoc(d)) : undefined}
            onDeleteDoc={
              canEdit
                ? (d) => {
                    setDeletedIds((prev) => [...prev, d.id])
                    api.remove(docMap ? resourceName : 'documents', d.id).catch(() => {})
                    toast({ type: 'info', title: 'Document deleted', body: d.title })
                    closeReader()
                  }
                : undefined
            }
            onOpen={openFromReader}
          />
        ) : (
          <motion.div
            key="library"
            ref={restoreLibraryScroll}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.16 }}
          >
            <PageHeader
              title={schema.title}
              subtitle={`${visibleDocs.length} documents · ${collections.length} collections`}
              actions={
                <ToolbarActions
                  config={config}
                  schema={schema}
                  query={query}
                  setQuery={setQuery}
                  sort={sort}
                  setSort={setSort}
                  exportColumns={exportColumns}
                  filtered={filtered}
                  canEdit={canEdit}
                  setCreateKind={setCreateKind}
                  onImportFile={importFile}
                  onImportLink={() => setImportLinkOpen(true)}
                  ordering={ordering}
                  setOrdering={setOrdering}
                  reshuffle={() => setShuffleSeed((n) => n + 1)}
                />
              }
            />

            {/* sweep: Person Focus Mode context banner (config.scopeBy + focus) */}
            {focus && scopeByKeys.length > 0 && <ContextBanner filtered={scopeFiltered} />}

            <div className="flex flex-col gap-5 md:flex-row md:items-start">
              {/* collection rail (stacks above the grid on phones) */}
              <CollectionRail
                collections={collections}
                collection={collection}
                setCollection={setCollection}
                counts={counts}
                visibleDocs={visibleDocs}
                onNewCollection={() =>
                  canEdit
                    ? setNewCollectionOpen(true)
                    : toast({ type: 'warning', title: 'Requires knowledge.edit — ask an admin' })
                }
              />

              {/* document grid */}
              <LibraryGrid
                focusFor={focusForDoc}
                sortable={ordering === 'manual'}
                sensors={orderSensors}
                onOrderDragEnd={onOrderDragEnd}
                filtered={filtered}
                collections={collections}
                config={config}
                query={query}
                setQuery={setQuery}
                pctOf={pctOf}
                openReader={openReader}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {createKind === 'doc' && (
          <NewDocModal
            collections={collections}
            canEdit={canEdit}
            onClose={() => setCreateKind(null)}
            onCreate={(d) => {
              setCreated((prev) => [...prev, d])
              setCreateKind(null)
              openReader(d.id)
            }}
          />
        )}
        {editingDoc && (
          <EditDocModal
            doc={editingDoc}
            collections={collections}
            onClose={() => setEditingDoc(null)}
            onSaved={(d) => setEditedDocs((prev) => ({ ...prev, [d.id]: d }))}
          />
        )}
        {/* Mapped libraries (docMap) edit the record they were built from.
            The form is derived from the map, so any resource rendered as a
            library is editable without a bespoke form. */}
        {editingRecord && recordEditSpec && (
          <EditRecordModal
            open
            onOpenChange={(o) => !o && setEditingRecord(null)}
            record={(data as any[]).find((r) => String(r.id) === editingRecord)}
            spec={recordEditSpec}
            onSaved={(row) => {
              setRecordPatches((prev) => ({ ...prev, [String(row.id)]: row }))
              setEditingRecord(null)
              toast({ type: 'success', title: 'Saved' })
            }}
          />
        )}
        {newCollectionOpen && (
          <NewCollectionModal
            onClose={() => setNewCollectionOpen(false)}
            onCreate={(c) => setExtraCollections((prev) => [...prev, c])}
          />
        )}
        <ImportLinkModal open={importLinkOpen} onOpenChange={setImportLinkOpen} onImport={importLink} />
        {createKind === 'course' && (
          <NewCourseModal
            collections={collections}
            canEdit={canEdit}
            onClose={() => setCreateKind(null)}
            onCreate={(d) => {
              setCreated((prev) => [...prev, d])
              setCreateKind(null)
              openReader(d.id)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
