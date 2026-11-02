// In-platform file viewer (global).
// A PDF, a signed contract or a Google Doc opens INSIDE the platform first — leaving for a new tab is a choice the…
import { create } from 'zustand'

export type FilePayload = {
  title: string
  subtitle?: string
  /** the file's own URL (Drive link, https PDF, blob URL…) */
  url: string
  /** shown in the share sheet and the print sheet */
  text?: string
  /** lucide icon for the header tile */
  icon?: string
}

type FileViewerState = {
  file: FilePayload | null
  openFile: (f: FilePayload) => void
  closeFile: () => void
}

export const useFileViewerStore = create<FileViewerState>((set) => ({
  file: null,
  openFile: (file) => set({ file }),
  closeFile: () => set({ file: null }),
}))

/** Imperative helper — usable from event handlers outside React components. */
export const openFile = (f: FilePayload) => useFileViewerStore.getState().openFile(f)

// Rewrite a link into something an iframe can actually render.
export function toEmbedUrl(raw: string): { src: string; embeddable: boolean } {
  const url = String(raw || '').trim()
  if (!url) return { src: '', embeddable: false }

  // https://drive.google.com/file/d/<ID>/view?usp=…  →  /preview
  const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/)
  if (driveFile) return { src: `https://drive.google.com/file/d/${driveFile[1]}/preview`, embeddable: true }

  // https://drive.google.com/open?id=<ID>  and  ?id=<ID> forms
  const driveId = url.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([^&#]+)/)
  if (driveId) return { src: `https://drive.google.com/file/d/${driveId[1]}/preview`, embeddable: true }

  // Docs / Sheets / Slides / Forms — /edit and /view both become /preview
  const gdoc = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/?#]+)/)
  if (gdoc) return { src: `https://docs.google.com/${gdoc[1]}/d/${gdoc[2]}/preview`, embeddable: true }

  // Google Maps — it opens contained inside the platform.
  if (/maps\.google\.[a-z.]+|google\.[a-z.]+\/maps/.test(url)) {
    let q = ''
    try {
      const u = new URL(url)
      q = u.searchParams.get('query') || u.searchParams.get('q') || ''
    } catch { q = '' }
    if (q) return { src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, embeddable: true }
  }

  // Dropbox Sign / HelloSign signed copies are served as framable PDFs
  if (/\.pdf($|[?#])/i.test(url) || /^blob:/i.test(url) || /^data:application\/pdf/i.test(url)) {
    return { src: url, embeddable: true }
  }

  // Same-origin anything (our own uploads) frames fine
  if (typeof window !== 'undefined' && url.startsWith(window.location.origin)) return { src: url, embeddable: true }
  if (url.startsWith('/')) return { src: url, embeddable: true }

  return { src: url, embeddable: false }
}
