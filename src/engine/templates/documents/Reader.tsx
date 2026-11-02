// Immersive reader view — hero cover, overlap title block, rich article body, reading-progress hairline…
import { useEffect, useMemo, useRef, useState } from 'react'
// updated-at is an instant → Ohio wall-clock for every viewer
import { ohioDayYear } from '@/lib/ohio'
import { onDocReads, readersOf, recordRead } from '@/lib/docReads'
import { motion, useMotionValue } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  FileDown,
  FileText,
  Loader2,
  GraduationCap,
  MoreHorizontal,
  Pencil,
  Printer,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react'
import Avatar, { AvatarStack } from '@/components/shared/Avatar'
import BookmarkButton from '@/components/shared/BookmarkButton'
import DragPerson from '@/components/shared/DragPerson'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AppIcon } from '@/lib/icons'
import { useAuthStore } from '@/auth/useAuthStore'
import { useApiConfigStore } from '@/stores/useApiConfigStore'
import { roleCanDocAction } from '@/lib/roleAccess'
import { gasAction } from '@/features/hiring/shared'
import { personById } from '@/lib/people-lookup'
import { TINT_BG, TINT_FG } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import type { Doc, DocBlock, Person } from '@/engine/types'
import { openFile, toEmbedUrl } from '@/stores/useFileViewerStore'
import { share } from '@/stores/useShareStore'
import FeedbackThumbs from '@/components/shared/FeedbackThumbs'
import type { CollectionCfg, ReaderCfg } from './types'
import { courseMinutes, fmtMinutes, isCourse, modulesOf } from './utils'
import { CoverArt, bookmarkableCover } from './covers'
import { Block } from './Block'
import { CourseModulesAside, TocRail } from './ReaderAsides'

export function Reader({
  doc,
  docs,
  collections,
  readerCfg,
  docKind = 'doc',
  courseChecked,
  onToggleModule,
  coursePct,
  onBack,
  onOpen,
  onEditDoc,
  onDeleteDoc,
}: {
  doc: Doc
  docs: Doc[]
  collections: CollectionCfg[]
  readerCfg: ReaderCfg
  /** what family this document belongs to, for feedback records */
  docKind?: string
  courseChecked: string[]
  onToggleModule: (moduleId: string) => void
  coursePct: number
  onBack: () => void
  onOpen: (id: string) => void
  /** Library management, passed down only when the role may use it. */
  onEditDoc?: (d: Doc) => void
  onDeleteDoc?: (d: Doc) => void
}) {
  // Memoised by document: `doc.body.filter(...)` returned a NEW array on every render, and the scroll effect below…
  const toc = useMemo(
    () => doc.body.filter((b): b is Extract<DocBlock, { kind: 'h2' | 'h3' }> => b.kind === 'h2' || b.kind === 'h3'),
    [doc.body],
  )
  // The document as text — what Share copies, e-mails and prints.
  const [makingPdf, setMakingPdf] = useState(false)
  const makePdf = async () => {
    if (!readerCfg.pdfAction) return
    setMakingPdf(true)
    const tab = window.open('', '_blank')
    try {
      const r = await gasAction<{ name: string; url?: string; download_url?: string; folder: string; kept?: boolean;
        b64?: string; mime?: string }>(
        readerCfg.pdfAction,
        { client_key: doc.id, title: doc.title },
      )
      // a PDF the server keeps arrives as its bytes; one filed in Drive as its link
      let href = r.download_url || r.url || ''
      if (r.kept && r.b64) {
        const raw = atob(r.b64)
        const bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
        href = URL.createObjectURL(new Blob([bytes], { type: r.mime || 'application/pdf' }))
      }
      if (tab) tab.location.href = href
      toast({
        type: 'success',
        title: 'Filed as PDF',
        body: r.kept ? `${r.name} — kept in “${r.folder}” on the platform's server.`
                     : `${r.name} — kept in “${r.folder}” on the platform's Drive.`,
      })
    } catch (e) {
      tab?.close()
      toast({
        type: 'danger',
        title: 'The PDF was not made',
        body: e instanceof Error ? e.message : 'The backend did not answer.',
      })
    } finally {
      setMakingPdf(false)
    }
  }

  /** The document as text — what Share copies, e-mails and prints. */
  const plainText = useMemo(
    () =>
      doc.body
        .map((b) => (b.kind === 'h2' || b.kind === 'h3' ? `\n${b.text}\n${'-'.repeat(b.text.length)}` : (b as { text?: string }).text ?? ''))
        .filter(Boolean)
        .join('\n'),
    [doc.body],
  )
  // documents imported as a link/PDF carry the file they point at
  const fileUrl = String((doc as Doc & { fileUrl?: string }).fileUrl ?? '')
  const embed = toEmbedUrl(fileUrl)
  const [activeId, setActiveId] = useState<string>(toc[0]?.id ?? '')
  const [helpful, setHelpful] = useState<'up' | 'down' | null>(null)
  const role = useAuthStore((s) => s.user?.role)
  const canPrint = roleCanDocAction(role, 'print')
  const canEditDoc = roleCanDocAction(role, 'edit')
  const canDeleteDoc = roleCanDocAction(role, 'delete')

  // A thumb is only worth collecting if you can say WHO, WHEN and on WHAT — a counter alone tells you a doc is…
  const vote = (value: 'up' | 'down') => {
    setHelpful(value)
    if (useApiConfigStore.getState().driver !== 'apps-script') return
    void gasAction('docFeedback', {
      doc_id: doc.id,
      doc_title: doc.title,
      collection: doc.collection,
      vote: value,
    }).catch(() => {})
  }
  const authors = doc.authorIds.map((id) => personById(id)).filter((a): a is Person => Boolean(a))
  const collection = collections.find((c) => c.id === doc.collection)
  const progress = useMotionValue(0)
  // scroll-spy lockout: after a TOC click the smooth scroll would otherwise highlight every section it passes…
  const spyLock = useRef(0)

  const idx = docs.findIndex((d) => d.id === doc.id)
  const prev = idx > 0 ? docs[idx - 1] : undefined
  const next = idx >= 0 && idx < docs.length - 1 ? docs[idx + 1] : undefined
  // Who has ACTUALLY opened this document (lib/docReads) — the count and the faces used to be derived from a hash…
  const [reads, setReads] = useState(() => readersOf(doc.title))
  useEffect(() => {
    setReads(readersOf(doc.title))
    const off = onDocReads(() => setReads(readersOf(doc.title)))
    void recordRead(doc.title)
    return off
  }, [doc.title])
  const readBy = reads.length
  const readers = reads.map((r) => ({ name: r.name }))
  const course = isCourse(doc)
  const modules = modulesOf(doc)

  // Opening a document starts it at the top — ONCE, when the document changes.
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [doc.id])

  // reading-progress hairline + scroll-spy over the main scroll container.
  useEffect(() => {
    const scroller = document.getElementById('main-scroll')
    if (!scroller) return
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight
      progress.set(max > 0 ? Math.min(1, scroller.scrollTop / max) : 0)
      if (Date.now() < spyLock.current) return
      let current = toc[0]?.id ?? ''
      for (const t of toc) {
        const el = document.getElementById(t.id)
        if (el && el.getBoundingClientRect().top < 140) current = t.id
      }
      setActiveId(current)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [toc, progress])

  const jumpTo = (id: string) => {
    spyLock.current = Date.now() + 700
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/knowledge/docs#${doc.id}`)
    } catch {
      /* clipboard unavailable in some contexts — toast anyway (demo) */
    }
    toast({ type: 'success', title: 'Link copied', body: doc.title })
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.16 }}>
      {/* print stylesheet (reader-mounted only): article only, white bg, no rails/progress */}
      <style>{`@media print {
        body { overflow: visible !important; background: white !important; }
        aside, header, .doc-no-print { display: none !important; }
        #main-scroll { overflow: visible !important; }
        #main-scroll > div { padding: 0 !important; }
      }`}</style>

      {/* reading-progress hairline (reader only) */}
      <motion.div
        className="doc-no-print fixed left-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] z-10 h-0.5 origin-left bg-primary"
        style={{ scaleX: progress }}
        aria-hidden
      />

      {/* top row */}
      <div className="doc-no-print mb-5 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="group flex items-center gap-1.5 text-[13px] font-medium text-text-2 transition-colors duration-150 hover:text-text-1"
        >
          <ArrowLeft size={15} className="transition-transform duration-150 group-hover:-translate-x-1" />
          All documents
        </button>
        <div className="flex items-center gap-1">
          <BookmarkButton
            bookmark={{
              type: 'document',
              refId: doc.id,
              title: doc.title,
              subtitle: collection?.label ?? 'Document',
              avatar: bookmarkableCover(doc.cover),
              tint: collection?.tint ?? 'blue',
              href: `/app/knowledge/docs#${doc.id}`,
            }}
          />
          {/* A rating belongs where the reader already is — the footer thumbs
              are only seen by whoever reaches the end. */}
          <FeedbackThumbs
            itemKind={docKind}
            itemId={doc.id}
            itemTitle={doc.title}
            collection={doc.collection}
            size={15}
          />
          <button
            aria-label="Share"
            title="Share"
            onClick={() =>
              share({
                title: doc.title,
                subtitle: collection?.label ?? 'Document',
                url: fileUrl || undefined,
                text: plainText,
                icon: 'file-text',
              })
            }
            className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
          >
            <Share2 size={16} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="More actions"
                className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            {/* Who gets Print / Edit / Delete is per role (lib/roleAccess.ts
                → ROLE_DOC_ACTIONS): a new hire reading the Welcome Packet is
                not offered Delete on a company policy. */}
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem onClick={copyLink}>
                <Share2 size={14} className="mr-2 text-text-3" /> Copy link
              </DropdownMenuItem>
              {readerCfg.allowPrint !== false && canPrint && (
                <DropdownMenuItem onClick={() => window.print()}>
                  <Printer size={14} className="mr-2 text-text-3" /> Print
                </DropdownMenuItem>
              )}
              {/* SAVE AS PDF — the platform files the
                  document in its own folder and hands back the link, so the
                  copy a house manager carries is one the workspace also has.
                  Only pages that declare the action grow the item. */}
              {readerCfg.pdfAction && (
                <DropdownMenuItem disabled={makingPdf} onClick={() => void makePdf()}>
                  {makingPdf
                    ? <Loader2 size={14} className="mr-2 animate-spin text-text-3" />
                    : <FileDown size={14} className="mr-2 text-text-3" />}
                  {makingPdf ? 'Filing the PDF…' : 'Save as PDF'}
                </DropdownMenuItem>
              )}
              {canEditDoc && onEditDoc && (
                <DropdownMenuItem onClick={() => onEditDoc(doc)} aria-label="Edit" title="Edit">
                  <Pencil size={14} className="text-text-3" />
                </DropdownMenuItem>
              )}
              {canDeleteDoc && onDeleteDoc && (
                <DropdownMenuItem onClick={() => onDeleteDoc(doc)} className="text-danger">
                  <Trash2 size={14} className="mr-2" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* THE RAIL CAN STAND ON THE LEFT — in ISP Library the right-hand
          "ON THIS PAGE" section belongs on the left instead.
          A page asks for it — `reader.tocSide: 'left'` — rather
          than every library being moved on one library's account. */}
      <div className={cn('flex gap-8', readerCfg.tocSide === 'left' && 'flex-row-reverse justify-end')}>
        <div className="min-w-0 w-full max-w-[760px] flex-1">
          {/* hero cover */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          >
            <CoverArt cover={doc.cover} iconSize={40} className="aspect-[5/2] max-h-[260px] w-full rounded-lg" />
          </motion.div>

          {/* overlap title block */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE_OUT_EXPO, delay: 0.06 }}
            className="relative z-10 mx-3 -mt-12 rounded-lg border border-border bg-surface p-6 shadow-1 sm:mx-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              {collection && (
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', TINT_BG[collection.tint], TINT_FG[collection.tint])}>
                  <AppIcon name={collection.icon} size={12} />
                  {collection.label}
                </span>
              )}
              {course && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary-strong">
                  <GraduationCap size={12} />
                  Course · {modules.length} modules · ~{fmtMinutes(courseMinutes(doc))}
                </span>
              )}
              {course && coursePct > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-text-2">
                  {coursePct}% complete
                </span>
              )}
            </div>
            <h1 className="mt-3 font-display text-[28px] font-extrabold leading-9 tracking-[-0.015em] text-text-1">
              {doc.title}
            </h1>
            {readerCfg.showMeta !== false && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
                {authors[0] && (
                  // the byline drags as the FIRST author — the line shows every name, but a focus slot holds one…
                  <DragPerson
                    name={authors[0].name}
                    id={authors[0].id}
                    avatar={authors[0].avatar}
                    subtitle={authors[0].role}
                    className="items-center gap-2.5"
                  >
                    <Avatar src={authors[0].avatar} name={authors[0].name} size="sm" />
                    <span className="text-[13px] font-medium text-text-1">
                      {authors.map((a) => a.name).join(', ')}
                      <span className="text-text-3"> · {authors[0].role}</span>
                    </span>
                  </DragPerson>
                )}
                <span className="text-[12px] text-text-3">
                  Updated {ohioDayYear(doc.updatedAt)} · {doc.readMinutes} min read
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {/* each reader's face drags on its own — AvatarStack wraps them */}
                  {readBy > 0 && <AvatarStack people={readers} max={3} />}
                  <span className="text-[12px] text-text-3">
                    {readBy === 0 ? (
                      'First to read this'
                    ) : readBy === 1 ? (
                      <>
                        Read by <DragPerson name={readers[0].name}>{readers[0].name}</DragPerson>
                      </>
                    ) : (
                      `Read by ${readBy}`
                    )}
                  </span>
                </span>
              </div>
            )}
          </motion.div>

          {/* A linked document (imported PDF or Google Doc) IS the file: it is
              framed here, inside the platform, with the way out in its own
              header. The blocks below stay as the description. */}
          {fileUrl && (
            <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface-2">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <FileText size={14} className="text-text-3" />
                <span className="clamp-1 flex-1 text-[12px] font-semibold text-text-2">{doc.title}</span>
                <button
                  type="button"
                  onClick={() => openFile({ title: doc.title, subtitle: 'Library document', url: fileUrl })}
                  className="rounded-sm px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-surface-3"
                >
                  Full screen
                </button>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm px-2 py-1 text-[11px] font-semibold text-text-2 transition-colors hover:bg-surface-3"
                >
                  New tab
                </a>
              </div>
              {embed.embeddable ? (
                <iframe src={embed.src} title={doc.title} className="h-[70vh] w-full border-0" />
              ) : (
                <p className="px-4 py-6 text-center text-[12.5px] text-text-2">
                  This host blocks embedding — open it in a new tab.
                </p>
              )}
            </div>
          )}

          {/* article body */}
          <div className="mt-8 space-y-4 pb-10">
            {doc.body.map((b, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: EASE_OUT_EXPO, delay: 0.12 + Math.min(i, 10) * 0.035 }}
              >
                <Block b={b} />
              </motion.div>
            ))}
          </div>

          {/* helpful + prev/next */}
          <div className="doc-no-print border-t border-border py-6">
            <div className="flex items-center gap-3">
              {helpful ? (
                <p className="text-[13px] font-medium text-text-2">Thanks for the feedback!</p>
              ) : (
                <p className="text-[13px] font-medium text-text-2">Was this helpful?</p>
              )}
              <button
                aria-label="Helpful"
                onClick={() => vote('up')}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-sm border transition-all duration-150',
                  helpful === 'up'
                    ? 'border-transparent bg-primary-soft text-primary-strong'
                    : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                  helpful === 'down' && 'opacity-40',
                )}
              >
                <ThumbsUp size={14} />
              </button>
              <button
                aria-label="Not helpful"
                onClick={() => vote('down')}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-sm border transition-all duration-150',
                  helpful === 'down'
                    ? 'border-transparent bg-primary-soft text-primary-strong'
                    : 'border-border text-text-3 hover:bg-surface-2 hover:text-text-1',
                  helpful === 'up' && 'opacity-40',
                )}
              >
                <ThumbsDown size={14} />
              </button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {prev ? (
                <button
                  onClick={() => onOpen(prev.id)}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-2"
                >
                  <ArrowLeft size={16} className="shrink-0 text-text-3 transition-transform duration-150 group-hover:-translate-x-0.5" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Previous</span>
                    <span className="clamp-1 block text-[13px] font-medium text-text-1">{prev.title}</span>
                  </span>
                </button>
              ) : (
                <span />
              )}
              {next && (
                <button
                  onClick={() => onOpen(next.id)}
                  className="group flex items-center justify-end gap-3 rounded-lg border border-border bg-surface p-4 text-right transition-all duration-150 hover:-translate-y-0.5 hover:shadow-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Next</span>
                    <span className="clamp-1 block text-[13px] font-medium text-text-1">{next.title}</span>
                  </span>
                  <ArrowRight size={16} className="shrink-0 text-text-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* course module sidebar (numbered, checkable — progress persisted per user) */}
        {course && (
          <CourseModulesAside
            modules={modules}
            courseChecked={courseChecked}
            onToggleModule={onToggleModule}
            coursePct={coursePct}
            jumpTo={jumpTo}
          />
        )}

        {/* sticky TOC rail with scroll-spy (non-course docs) */}
        {!course && readerCfg.showToc !== false && toc.length > 0 && (
          <TocRail toc={toc} activeId={activeId} jumpTo={jumpTo} />
        )}
      </div>
    </motion.div>
  )
}
