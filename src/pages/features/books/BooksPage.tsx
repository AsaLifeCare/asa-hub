// BOOKS — the company's small library.
// A BOOKS app: free-source books, chosen around the work this company does.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Download, ExternalLink, FileText, Loader2, RefreshCw, Search, Sparkles, Upload, X } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { api } from '@/lib/api'
import { MAX_UPLOAD_BYTES, fileToBase64, gasAction, inferMime } from '@/features/hiring/shared'
import { useCan } from '@/auth/permissions'
import { openFile } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'
import { invalidate } from '@/lib/apiCache'
import { cn } from '@/lib/utils'

type Book = {
  id: string
  title?: string
  author?: string
  subject?: string
  licence?: string
  source?: string
  home?: string
  summary?: string
  why?: string
  driveUrl?: string
  fileSize?: string
  fetchNote?: string
}

/** A licence in two words, for the chip; the full text stays on the card. */
const licenceShort = (raw?: string): string => {
  const v = String(raw ?? '')
  if (/public domain/i.test(v)) return 'Public domain'
  const cc = v.match(/CC[\s-]?BY[A-Z\-\s.]*/i)
  return cc ? cc[0].trim() : (v || 'Licence not recorded')
}

const SUBJECT_TINT: Record<string, string> = {
  Caregiving: 'bg-tint-mint text-tint-fg-mint',
  Dementia: 'bg-tint-lavender text-tint-fg-lavender',
  'Developmental disability': 'bg-tint-blue text-tint-fg-blue',
  'Trauma & behaviour': 'bg-tint-pink text-tint-fg-pink',
  Nutrition: 'bg-tint-amber text-tint-fg-amber',
  'Clinical grounding': 'bg-tint-peach text-tint-fg-peach',
}

/** what the reader panel holds while a scrape/convert is in flight or done */
type Reading = { book: Book; paragraphs: string[] | null; via: string; error: string }

// ────────────────────────────────────────────────────────────────────────── SECTIONS OUT OF PLAIN TEXT — sections…
type BookSection = { idx: number; label: string }

const SECTION_WORD_RE = /^(CHAPTER|PART|BOOK|SECTION|LESSON|UNIT|MODULE|APPENDIX|PREFACE|INTRODUCTION|CONTENTS|GLOSSARY|INDEX|FOREWORD|CONCLUSION|SUMMARY|REFERENCES|ACKNOWLEDGE?MENTS)\b[\s\S]{0,80}$/i
const NUMBERED_RE = /^\d{1,3}[.)]\s+\S/
const ROMAN_RE = /^[IVXLCDM]{1,7}\.?$/
// letters, no internal period — "Cleanliness." matches, a sentence cannot
const TOPIC_RE = /^[A-Z][A-Za-z'’\-,;: ]{1,70}[.:]?$/

function isAllCapsHeading(p: string): boolean {
  if (p.length > 90) return false
  const letters = p.replace(/[^A-Za-z]/g, '')
  return letters.length >= 4 && p === p.toUpperCase() && /[A-Z]/.test(p)
}

function deriveSections(paragraphs: string[], title: string, author: string): BookSection[] {
  const out: BookSection[] = []
  const titleCore = title.trim().toLowerCase()
  const authorCore = author.trim().toLowerCase()
  paragraphs.forEach((raw, i) => {
    const p = raw.trim()
    if (!p || p.startsWith('… (the text continues')) return
    // the opening paragraphs often echo the cover — a rail entry for the book's own title points nowhere useful
    if (i < 2 && (p.toLowerCase() === titleCore || p.toLowerCase() === authorCore)) return
    const words = p.split(/\s+/).length
    const isHead =
      SECTION_WORD_RE.test(p) ||
      isAllCapsHeading(p) ||
      (NUMBERED_RE.test(p) && p.length <= 90) ||
      ROMAN_RE.test(p) ||
      (TOPIC_RE.test(p) && words <= 8)
    if (isHead) out.push({ idx: i, label: p.length > 64 ? p.slice(0, 61) + '…' : p })
  })
  if (out.length >= 3) return out
  const pages: BookSection[] = []
  paragraphs.forEach((p, i) => {
    const m = /\[Pg\s*(\d+)\]/.exec(p)
    if (m && (pages.length === 0 || pages[pages.length - 1].idx !== i)) pages.push({ idx: i, label: `Page ${m[1]}` })
  })
  return pages.length >= 3 ? pages : out
}

export default function BooksPage() {
  const canManage = useCan('apps.manage')
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'' | 'seed' | 'fetch' | 'mine' | 'harvest'>('')
  const [q, setQ] = useState('')
  const [reading, setReading] = useState<Reading | null>(null)
  /** the guaranteed door: which book the hidden file input is picking for */
  const uploadFor = useRef<Book | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadingId, setUploadingId] = useState('')

  /* the derived section rail for whatever is open in the reader */
  const sections = useMemo(
    () => (reading?.paragraphs && reading.paragraphs.length
      ? deriveSections(reading.paragraphs, reading.book.title || '', reading.book.author || '')
      : []),
    [reading],
  )
  const sectionIdx = useMemo(() => new Set(sections.map((x) => x.idx)), [sections])
  const showRail = sections.length >= 2

  // READ INSIDE THE PLATFORM — the reading happens here, not on somebody else's site.
  const readHere = (b: Book) => {
    if (b.driveUrl) {
      openFile({ title: b.title || 'Untitled', subtitle: b.author || b.subject, url: b.driveUrl, icon: 'book-open' })
      return
    }
    setReading({ book: b, paragraphs: null, via: '', error: '' })
    gasAction<{ title: string; author: string; via: string; paragraphs: string[] }>('booksRead', { id: b.id })
      .then((d) => setReading((prev) => prev && prev.book.id === b.id
        ? { ...prev, paragraphs: d.paragraphs ?? [], via: d.via ?? '' }
        : prev))
      .catch((e) => setReading((prev) => prev && prev.book.id === b.id
        ? { ...prev, error: e instanceof Error ? e.message : 'The source could not be read.' }
        : prev))
  }

  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setReading(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

  const load = useCallback(async () => {
    try {
      const rows = await api.list<Book>('books')
      setBooks(Array.isArray(rows) ? rows : [])
    } catch {
      /* the empty state says it better than a toast would */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const seed = async () => {
    setBusy('seed')
    try {
      const r = await gasAction<{ added: number; updated: number; total: number }>('booksSeed', {})
      invalidate('books')
      await load()
      toast({
        type: 'success',
        title: `${r.added} added, ${r.updated} refreshed`,
        body: 'Every title is public domain or Creative Commons, with its licence on the row.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'The shelf was not filled', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  const fetchFiles = async () => {
    setBusy('fetch')
    try {
      const r = await gasAction<{ fetched: number; failed: number; skipped: number; stopped_early?: boolean; folder?: string }>('booksFetch', {})
      invalidate('books')
      await load()
      toast({
        type: r.fetched ? 'success' : 'warning',
        title: `${r.fetched} brought in${r.failed ? `, ${r.failed} refused` : ''}`,
        body: r.stopped_early
          ? 'The run stopped at its time limit — press it again to continue.'
          : r.failed
            ? 'A publisher that refuses machine downloads is noted on the card; its Source link still opens.'
            : 'They are in the platform’s Books folder, with an index document beside them.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was downloaded', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  /** The model proposes; the trusted-publisher gate disposes (Books.gs). */
  const mine = async () => {
    setBusy('mine')
    try {
      const r = await gasAction<{ added: number; refused: number; refused_named?: string[]; via?: string }>('booksMine', {})
      invalidate('books')
      await load()
      toast({
        type: r.added ? 'success' : 'info',
        title: r.added ? `${r.added} new title${r.added === 1 ? '' : 's'} on the shelf` : 'Nothing new survived the gate',
        body: r.refused
          ? `${r.refused} suggestion${r.refused === 1 ? '' : 's'} refused — untrusted publisher or already here. Press "Bring the files in" to download the new ones.`
          : 'Suggested by the model, kept only from provably-free publishers.',
      })
    } catch (e) {
      toast({ type: 'danger', title: 'The mining run failed', body: e instanceof Error ? e.message : 'Is an AI key configured?' })
    } finally {
      setBusy('')
    }
  }

  // HARVEST FROM GOOGLE'S SIDE.
  const harvest = async () => {
    setBusy('harvest')
    try {
      const r = await gasAction<{ harvested: string[]; failed: { title: string; why: string }[]; remaining: number }>('booksHarvest', {})
      invalidate('books')
      await load()
      const failedLine = r.failed.length
        ? r.failed.map((f) => `${f.title}: ${f.why}`).join(' · ')
        : ''
      toast({
        type: r.harvested.length ? 'success' : r.failed.length ? 'warning' : 'info',
        title: r.harvested.length
          ? `${r.harvested.length} book${r.harvested.length === 1 ? '' : 's'} stored for reading`
          : 'Nothing new could be stored',
        body: [
          r.harvested.length ? `Stored: ${r.harvested.join(' · ')}.` : '',
          failedLine ? `Refused — ${failedLine}.` : '',
          r.remaining > 0 ? `${r.remaining} still missing — press again to continue, or upload their files.` : 'Every book now has a stored copy.',
        ].filter(Boolean).join(' '),
      })
    } catch (e) {
      toast({ type: 'danger', title: 'The harvest run failed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy('')
    }
  }

  /** the hidden input's other half: send the picked file through the door */
  const onFilePicked = async (file: File | null) => {
    const book = uploadFor.current
    uploadFor.current = null
    if (!file || !book) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ type: 'danger', title: 'Too large', body: 'Up to 15MB — a bigger book belongs in Drive by hand.' })
      return
    }
    setUploadingId(book.id)
    try {
      const r = await gasAction<{ saved: string; paragraphs: number; note?: string }>('booksFileUpload', {
        id: book.id,
        base64: await fileToBase64(file),
        filename: file.name,
        mime: inferMime(file),
      })
      invalidate('books')
      await load()
      toast({
        type: r.note ? 'warning' : 'success',
        title: `${book.title || 'The book'} is on the shelf`,
        body: r.note || `Held on the platform and stored for reading — ${r.paragraphs} paragraphs.`,
      })
    } catch (e) {
      toast({ type: 'danger', title: 'The upload failed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setUploadingId('')
    }
  }

  const query = q.trim().toLowerCase()
  const shown = useMemo(() => books.filter((b) => !query || [b.title, b.author, b.subject, b.summary, b.why]
    .some((v) => String(v ?? '').toLowerCase().includes(query))), [books, query])

  const shelves = useMemo(() => {
    const by = new Map<string, Book[]>()
    for (const b of shown) {
      const s = String(b.subject ?? '').trim() || 'General'
      by.set(s, [...(by.get(s) ?? []), b])
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shown])

  const onPlatform = books.filter((b) => b.driveUrl).length

  return (
    <div>
      {/* the guaranteed door's hidden half — one input serves every card */}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.html,.htm,application/pdf,text/html"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ''
          void onFilePicked(f)
        }}
      />
      <PageHeader
        title="Books"
        subtitle="Free, properly licensed reading for the work we actually do."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5">
              <Search size={14} className="shrink-0 text-text-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search the shelf…"
                className="h-9 w-[190px] bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
              />
            </div>
            {canManage && (
              <>
                <button
                  onClick={() => void seed()}
                  disabled={!!busy}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  {busy === 'seed' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Fill the shelf
                </button>
                <button
                  onClick={() => void mine()}
                  disabled={!!busy}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  {busy === 'mine' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Mine more (AI)
                </button>
                <button
                  onClick={() => void harvest()}
                  disabled={!!busy}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-text-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  {busy === 'harvest' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  Harvest texts
                </button>
                <button
                  onClick={() => void fetchFiles()}
                  disabled={!!busy}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy === 'fetch' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Bring the files in
                </button>
              </>
            )}
          </div>
        }
      />

      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 size={14} className="animate-spin" /> Opening the shelf…
        </p>
      ) : books.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="The shelf is empty"
            body={canManage
              ? 'Press "Fill the shelf" — the catalogue is public-domain and Creative Commons titles about caregiving, dementia, developmental disability, trauma and nutrition.'
              : 'An admin fills this from the platform’s catalogue. Nothing is missing on your side.'}
          />
        </div>
      ) : (
        <>
          <p className="mt-4 text-[12.5px] text-text-3">
            {books.length} {books.length === 1 ? 'title' : 'titles'} · {onPlatform} held on the platform ·
            every one free to read and to share, with its licence printed below it.
          </p>

          {shelves.map(([subject, list]) => (
            <section key={subject} className="mt-6">
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-text-1">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', SUBJECT_TINT[subject] ?? 'bg-surface-2 text-text-2')}>
                  {subject}
                </span>
                <span className="text-[11.5px] font-medium text-text-3">{list.length}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((b) => (
                  <article key={b.id} className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-1 transition-shadow hover:shadow-2">
                    <div className="flex items-start gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-peach text-tint-fg-peach">
                        <BookOpen size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[13.5px] font-bold leading-5 text-text-1">{b.title || 'Untitled'}</h3>
                        <p className="mt-0.5 text-[11.5px] text-text-3">{b.author}</p>
                      </div>
                    </div>

                    {b.summary && <p className="mt-3 text-[12.5px] leading-5 text-text-2">{b.summary}</p>}
                    {b.why && (
                      <p className="mt-2 border-l-2 border-border pl-2.5 text-[12px] leading-5 text-text-3">
                        <span className="font-semibold text-text-2">Why it is here — </span>{b.why}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span
                        title={b.licence}
                        className="rounded-full bg-tint-mint px-2 py-0.5 text-[10.5px] font-semibold text-tint-fg-mint"
                      >
                        {licenceShort(b.licence)}
                      </span>
                      {b.fileSize && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-medium text-text-3">{b.fileSize}</span>
                      )}
                    </div>

                    {b.fetchNote && (
                      <p className="mt-2 rounded-md bg-tint-amber px-2.5 py-1.5 text-[11.5px] leading-4 text-tint-fg-amber">
                        Not held on the platform — {b.fetchNote} Open it at the source instead.
                      </p>
                    )}

                    <div className="mt-auto flex items-center gap-1.5 pt-3">
                      <button
                        onClick={() => readHere(b)}
                        className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary-hover"
                      >
                        <BookOpen size={13} /> Read here
                      </button>
                      <a
                        href={b.home || b.source}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2"
                      >
                        <ExternalLink size={13} /> Source
                      </a>
                      {canManage && !b.driveUrl && (
                        <button
                          onClick={() => { uploadFor.current = b; fileRef.current?.click() }}
                          disabled={uploadingId === b.id}
                          title="Upload the publisher's PDF or HTML — the door that works when every network wall is up"
                          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-semibold text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1 disabled:opacity-50"
                        >
                          {uploadingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                          Upload the file
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {/* ── THE READER — the article inside the platform, set for reading:
             one measured column, generous leading, nothing else on screen ── */}
      {reading && (
        <div className="fixed inset-0 z-[70] flex justify-center overflow-y-auto bg-black/40 px-3 py-6" onClick={() => setReading(null)}>
          <div
            className="h-fit min-h-[60vh] w-full max-w-[1160px] rounded-xl border border-border bg-surface shadow-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start gap-3 rounded-t-xl border-b border-border bg-surface px-6 py-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint-peach text-tint-fg-peach">
                <BookOpen size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold leading-5 text-text-1">{reading.book.title || 'Untitled'}</h2>
                <p className="mt-0.5 text-[12px] text-text-3">
                  {reading.book.author}
                  {reading.via === 'scrape' && ' · read from the publisher’s page'}
                  {reading.via === 'pdf' && ' · converted from the publisher’s PDF'}
                </p>
              </div>
              <a
                href={reading.book.home || reading.book.source}
                target="_blank"
                rel="noreferrer"
                title="Open at the source"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <ExternalLink size={15} />
              </a>
              <button
                onClick={() => setReading(null)}
                aria-label="Close the reader"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 sm:px-10 sm:py-7">
              {reading.error ? (
                <div className="py-10 text-center">
                  <p className="text-[13.5px] text-text-2">{reading.error}</p>
                  <a
                    href={reading.book.home || reading.book.source}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3.5 text-[13px] font-semibold text-text-1 hover:bg-surface-2"
                  >
                    <ExternalLink size={14} /> Open it at the source
                  </a>
                </div>
              ) : reading.paragraphs === null ? (
                <p className="flex items-center justify-center gap-2 py-16 text-[13.5px] text-text-3">
                  <Loader2 size={15} className="animate-spin" /> Bringing the text in…
                </p>
              ) : (
                // sections on the LEFT, the text stretched into what used to be dead space on the right.
                <div className={showRail ? 'lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8' : ''}>
                  {showRail && (
                    <nav className="hidden lg:block">
                      <div className="scroll-thin sticky top-[84px] max-h-[calc(100vh-170px)] overflow-y-auto pr-1.5">
                        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">Sections</p>
                        {sections.map((x) => (
                          <button
                            key={x.idx}
                            onClick={() => document.getElementById('bk-p-' + x.idx)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className="block w-full truncate rounded-md px-2 py-1 text-left text-[12.5px] leading-5 text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                            title={x.label}
                          >
                            {x.label}
                          </button>
                        ))}
                      </div>
                    </nav>
                  )}
                  <div className={showRail ? 'min-w-0 space-y-4' : 'mx-auto max-w-[76ch] space-y-4'}>
                    {reading.paragraphs.map((p, i) => (
                      sectionIdx.has(i) ? (
                        <p key={i} id={'bk-p-' + i} className="scroll-mt-24 pt-3 text-[17px] font-bold leading-6 text-text-1 first:pt-0">{p}</p>
                      ) : (
                        <p key={i} id={'bk-p-' + i} className="scroll-mt-24 text-[15px] leading-[1.85] text-text-1">{p}</p>
                      )
                    ))}
                    <p className="border-t border-border pt-4 text-[12px] text-text-3">
                      Read on the platform · the original lives at{' '}
                      <a href={reading.book.home || reading.book.source} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">the source</a>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
