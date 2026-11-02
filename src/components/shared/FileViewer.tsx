// FileViewer — documents open inside the platform, everywhere.
// A near-full-screen sheet with the file framed in it and the three things someone actually wants next: share, open…
import { useEffect, useState } from 'react'
import { Download, ExternalLink, Share2, X } from 'lucide-react'
import { AppIcon } from '@/lib/icons'
import { useFileViewerStore, toEmbedUrl, type FilePayload } from '@/stores/useFileViewerStore'
import { share } from '@/stores/useShareStore'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'

/** A saved blob is named after the document, not the blob's random id. */
export function downloadName(title: string): string {
  return String(title || 'document').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document'
}

export default function FileViewer() {
  const file = useFileViewerStore((s) => s.file)
  const closeFile = useFileViewerStore((s) => s.closeFile)
  return <FileViewerView file={file} closeFile={closeFile} />
}

/** The viewer itself, given the file: the store-free half, so it can be drawn on its own. */
export function FileViewerView({ file, closeFile }: { file: FilePayload | null; closeFile: () => void }) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => setLoaded(false), [file?.url])

  useEffect(() => {
    if (!file) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeFile()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [file, closeFile])

  if (!file) return null
  const { src, embeddable } = toEmbedUrl(file.url)
  const local = /^blob:/i.test(file.url)

  const btnCls =
    'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-text-1 transition-colors hover:bg-surface-2'

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/55 backdrop-blur-[2px]" onClick={closeFile}>
      <div
        className="mx-auto flex h-full w-full max-w-[1100px] flex-col p-3 md:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl" style={{ height: '100%' }}>
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
              style={{ background: TINT_BG_VAR.blue, color: TINT_VAR.blue }}
            >
              <AppIcon name={file.icon ?? 'file-text'} size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="clamp-1 font-display text-[14px] font-semibold text-text-1">{file.title}</p>
              {file.subtitle && <p className="clamp-1 text-[11px] text-text-3">{file.subtitle}</p>}
            </div>
            {/* bytes read through a door live only in this tab: a blob link is dead for anyone else */}
            {!local && (
              <button
                type="button"
                className={btnCls}
                onClick={() => share({ title: file.title, subtitle: file.subtitle, url: file.url, text: file.text, icon: file.icon })}
              >
                <Share2 size={14} /> <span className="max-sm:hidden">Share</span>
              </button>
            )}
            <a className={btnCls} href={file.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> <span className="max-sm:hidden">Open in new tab</span>
            </a>
            <a className={btnCls} href={file.url} download={local ? downloadName(file.title) : true} target="_blank" rel="noopener noreferrer">
              <Download size={14} /> <span className="max-sm:hidden">Download</span>
            </a>
            <button
              type="button"
              aria-label="Close"
              onClick={closeFile}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <X size={17} />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 bg-surface-2">
            {embeddable ? (
              <>
                {!loaded && (
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="text-[12px] text-text-3">Loading document…</span>
                  </div>
                )}
                <iframe
                  src={src}
                  title={file.title}
                  onLoad={() => setLoaded(true)}
                  className={cn('h-full w-full border-0 transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
                  allow="autoplay"
                />
              </>
            ) : (
              <div className="grid h-full place-items-center px-6 text-center">
                <div className="max-w-[380px]">
                  <p className="font-display text-[14px] font-semibold text-text-1">This host won't display inside the platform</p>
                  <p className="mt-1 text-[12px] leading-5 text-text-2">
                    The site holding this file blocks being embedded. Everything else still works — open it in a tab, or
                    share the link from here.
                  </p>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary hover:bg-primary-hover"
                  >
                    <ExternalLink size={14} /> Open in a new tab
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
