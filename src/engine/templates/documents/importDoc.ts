// Import a document from a file somebody already has.
// The Import button used to be a toast saying "disabled in demo", which is the worst kind of button: it looks like…
import type { Doc, DocBlock } from '@/engine/types'

export const IMPORT_ACCEPT = '.md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf'

/** Kebab id for a heading, unique within the document. */
function headingId(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'section'
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

/** Markdown (or plain text) → the reader's blocks. */
export function parseMarkdown(source: string): { blocks: DocBlock[]; firstHeading: string } {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: DocBlock[] = []
  const taken = new Set<string>()
  let firstHeading = ''
  let para: string[] = []
  let bullets: string[] = []

  const flushPara = () => {
    if (!para.length) return
    blocks.push({ kind: 'p', text: para.join(' ').trim() })
    para = []
  }
  const flushList = () => {
    if (!bullets.length) return
    for (const item of bullets) blocks.push({ kind: 'p', text: `• ${item}` })
    bullets = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)

    if (heading) {
      flushPara()
      flushList()
      const text = heading[2].trim()
      if (!firstHeading) firstHeading = text
      // h1 becomes the document title; everything deeper is h2/h3 so the reader's table of contents stays two…
      const kind = heading[1].length <= 2 ? 'h2' : 'h3'
      blocks.push({ kind, id: headingId(text, taken), text })
      continue
    }
    if (bullet) {
      flushPara()
      bullets.push(bullet[1].trim())
      continue
    }
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()

  if (blocks.length === 0) blocks.push({ kind: 'p', text: 'This document is empty.' })
  // A reader with no heading has no table of contents — give it one.
  if (!blocks.some((b) => b.kind === 'h2')) {
    blocks.unshift({ kind: 'h2', id: 'overview', text: 'Overview' })
  }
  return { blocks, firstHeading }
}

/** Build a Doc from an imported file. */
export function docFromFile({
  filename,
  source,
  collection,
  cover,
  authorId,
}: {
  filename: string
  source: string
  collection: string
  cover: string
  authorId: string
}): Doc {
  const { blocks, firstHeading } = parseMarkdown(source)
  const words = source.trim() ? source.trim().split(/\s+/).length : 0
  const firstPara = blocks.find((b): b is Extract<DocBlock, { kind: 'p' }> => b.kind === 'p')
  const title = firstHeading || filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Imported document'
  return {
    id: `d-imp-${Date.now().toString(36)}`,
    title,
    excerpt: (firstPara?.text ?? '').slice(0, 140) || 'Imported document.',
    collection,
    cover,
    authorIds: [authorId],
    updatedAt: new Date().toISOString(),
    readMinutes: Math.max(1, Math.round(words / 200) || 1),
    body: blocks,
  }
}

// Build a Doc that POINTS AT a file instead of containing it — a Google Doc, a Drive PDF, a policy that already…
export function docFromLink({
  title,
  url,
  collection,
  cover,
  authorId,
  note,
}: {
  title: string
  url: string
  collection: string
  cover: string
  authorId: string
  note?: string
}): Doc & { fileUrl: string } {
  return {
    id: `d-lnk-${Date.now().toString(36)}`,
    title: title.trim() || 'Linked document',
    excerpt: note ?? 'Opens inside the platform.',
    collection,
    cover,
    authorIds: [authorId],
    updatedAt: new Date().toISOString(),
    readMinutes: 1,
    fileUrl: url.trim(),
    body: [
      { kind: 'h2', id: 'about', text: 'About this document' },
      { kind: 'p', text: note ?? 'This document is stored as a file and opens inside the platform.' },
    ],
  }
}

/** Read a File as base64 (no data: prefix) for the Apps Script upload lane. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}
