// VIEWING A DOCUMENT, THE PLATFORM'S WAY: in the centre, large, inside the platform — the one FileViewer mounted in…
// The bytes come through an authenticated door and become a blob URL on the platform's own origin; that URL is…
import { useCallback, useEffect, useRef, useState } from 'react'
import { blobOf } from '@/pages/features/myprofile/certDocFile'
import { openFile, useFileViewerStore } from '@/stores/useFileViewerStore'
import { toast } from '@/stores/useToastStore'

/** What a bytes door answers: the file's type and its bytes as base64. */
export type DocBytes = { mime: string; b64: string; name?: string }

export type PlatformDocMeta = { title: string; subtitle?: string; icon?: string }

export const DOC_NOT_SHOWN = "This file's type is not shown inside the platform."
export const DOC_FAILED_TITLE = 'The document could not be opened'

let held = ''
let watching = false
let asked = 0

/** The viewer moved off the held URL (closed, or another file opened): its bytes are let go. */
function watchViewer(): void {
  if (watching) return
  watching = true
  useFileViewerStore.subscribe((s) => {
    if (held && s.file?.url !== held) {
      URL.revokeObjectURL(held)
      held = ''
    }
  })
}

// A document's bytes in the centred viewer.
export async function openPlatformDoc(bytes: DocBytes | Promise<DocBytes>, meta: PlatformDocMeta): Promise<boolean> {
  const ticket = ++asked
  let got: DocBytes
  try {
    got = await bytes
  } catch (err) {
    if (ticket !== asked) return false
    throw err
  }
  if (ticket !== asked) return false
  if (!got || typeof got.b64 !== 'string' || !got.b64) throw new Error('the document came back without its file')
  const blob = blobOf(got)
  if (!blob) throw new Error(DOC_NOT_SHOWN)
  const url = URL.createObjectURL(blob)
  watchViewer()
  openFile({ title: meta.title, subtitle: meta.subtitle, icon: meta.icon ?? 'file-text', url })
  held = url
  return true
}

export type PlatformDocOpener = {
  /** the key of the ask whose bytes are on their way; '' when none */
  opening: string
  open: (key: string, read: () => Promise<DocBytes>, meta: PlatformDocMeta) => void
}

/** A row's click: the row shows it is opening, and a failure is a toast — never a silent nothing. */
export function usePlatformDoc(refusal: (error: string) => string = (e) => e): PlatformDocOpener {
  const [opening, setOpening] = useState('')
  const live = useRef(true)
  const words = useRef(refusal)
  useEffect(() => {
    words.current = refusal
  })
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const open = useCallback((key: string, read: () => Promise<DocBytes>, meta: PlatformDocMeta) => {
    setOpening(key)
    let bytes: Promise<DocBytes>
    try {
      bytes = read()
    } catch (err) {
      bytes = Promise.reject(err)
    }
    openPlatformDoc(bytes, meta)
      .catch((err: unknown) => {
        toast({ type: 'danger', title: DOC_FAILED_TITLE, body: words.current(err instanceof Error ? err.message : String(err)) })
      })
      .finally(() => {
        if (live.current) setOpening((o) => (o === key ? '' : o))
      })
  }, [])
  return { opening, open }
}
