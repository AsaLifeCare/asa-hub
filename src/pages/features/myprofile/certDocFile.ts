// The document behind a ledger row, for the eye: its bytes through certDocFile (the caller's own record, the…
// No Drive link is opened and nothing is shared.
import { useEffect, useState } from 'react'
import { gasAction } from '@/features/hiring/shared'

export type CertDocAnswer = { id: string; name: string; mime: string; size: number; b64: string }

/** How the eye draws a document: a PDF framed, a picture drawn, or not at all (''). */
export type DocShape = 'pdf' | 'image' | ''

export type CertDoc = { src: string; mime: string; shape: DocShape; name: string; size: number; revoke: () => void }

const PDF_TYPE = 'application/pdf'
const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif'])

/** The one list of types the eye draws — ComplianceDocs.gs CERT_DOC_TYPES. */
export function docShapeOf(mime: unknown): DocShape {
  const m = String(mime ?? '').trim().toLowerCase()
  if (m === PDF_TYPE) return 'pdf'
  return PICTURE_TYPES.has(m) ? 'image' : ''
}

/** The answer's bytes as a Blob of its own type — null for a type the eye never draws. */
export function blobOf(answer: Pick<CertDocAnswer, 'b64' | 'mime'>): Blob | null {
  if (!docShapeOf(answer.mime)) return null
  const bin = atob(String(answer.b64 ?? ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: String(answer.mime).trim().toLowerCase() })
}

const noop = () => {}

/** Reads one ledger row's file and holds it as a blob URL until `revoke`; a type the eye never draws gets no URL. */
export async function openCertDoc(id: string): Promise<CertDoc> {
  const got = await gasAction<CertDocAnswer>('certDocFile', { id })
  if (!got || typeof got.b64 !== 'string' || !got.b64) throw new Error('the document came back without its file')
  const base = { mime: String(got.mime || ''), name: String(got.name || ''), size: Number(got.size) || 0 }
  const blob = blobOf(got)
  if (!blob) return { ...base, src: '', shape: '', revoke: noop }
  const src = URL.createObjectURL(blob)
  let held = true
  return {
    ...base, src, shape: docShapeOf(got.mime),
    revoke: () => {
      if (!held) return
      held = false
      URL.revokeObjectURL(src)
    },
  }
}

export type CertDocState = { status: 'loading' | 'ready' | 'failed'; doc: CertDoc | null; error: string }

const OPENING: CertDocState = { status: 'loading', doc: null, error: '' }

/** The document for as long as the component that asked is mounted; the blob URL is revoked when it unmounts. */
export function useCertDoc(id: string): CertDocState {
  const [slot, setSlot] = useState<{ id: string; state: CertDocState }>({ id, state: OPENING })
  useEffect(() => {
    let live = true
    let held: CertDoc | null = null
    openCertDoc(id).then((doc) => {
      if (!live) {
        doc.revoke()
        return
      }
      held = doc
      setSlot({ id, state: { status: 'ready', doc, error: '' } })
    }).catch((err: unknown) => {
      if (live) setSlot({ id, state: { status: 'failed', doc: null, error: err instanceof Error ? err.message : String(err) } })
    })
    return () => {
      live = false
      held?.revoke()
    }
  }, [id])
  return slot.id === id ? slot.state : OPENING
}
